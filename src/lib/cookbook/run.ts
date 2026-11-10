// Running recipes through the engine: the WASM build in public/wasm, loaded
// in Node. One in-memory database per recipe; cells in document order
// through `executeScript` (the engine's own script runner, ADR-0131) with
// their data blocks as parameters, each result rendered by the bundle's
// `renderResult` (the renderer the recordings were made with), stopping at
// the first cell that goes other than its recipe says (cells.ts).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { surprise } from './cells.ts';
import { expandNode, type Graph, type RunStatement } from './graph-model.ts';
import { projectRoot } from './load.ts';
import { dataBlock, MAX_RESULT_ROWS, type Recipe, type Recording } from './recipe.ts';
import { lastEnvelope } from './result-view.ts';

/** The site's WASM bundle. */
export const WASM_DIR = join(projectRoot(), 'public/wasm');

interface Db {
  executeScript(script: string, params?: string | null): string[];
  free(): void;
}

/** The parts of the bundle (`relate.js`) the runner uses. */
export interface Engine {
  RelateDb: new () => Db;
  renderResult(envelopes: string[]): string;
}

/** Load and instantiate the bundle in `wasmDir`. */
export async function loadEngine(wasmDir = WASM_DIR): Promise<Engine> {
  // The engine is loaded from public/wasm at run time and never bundled.
  const mod = await import(/* @vite-ignore */ pathToFileURL(join(wasmDir, 'relate.js')).href);
  mod.initSync({ module: readFileSync(join(wasmDir, 'relate_bg.wasm')) });
  if (typeof mod.renderResult !== 'function' || typeof mod.RelateDb?.prototype?.executeScript !== 'function') {
    throw new Error(`${wasmDir}: the bundle has no executeScript / renderResult; rebuild it`);
  }
  return mod as Engine;
}

export interface CellRun {
  id: string;
  /** The engine's wire JSON text, one per statement run. */
  envelopes: string[];
  recording: Recording;
}

export interface RecipeRun {
  cells: CellRun[];
  /** Why the run ended before the last cell, or null. */
  stopped: string | null;
}

export { lastEnvelope };

/**
 * Run `recipe`'s cells in order on a fresh in-memory database. Each cell
 * that goes as its recipe says is checked with the graph view's expansion
 * against the database as it stands then (see `expandProblem`); what that
 * finds goes in `expandProblems`.
 */
export async function runRecipe(engine: Engine, recipe: Recipe): Promise<RecipeRun & { expandProblems: string[] }> {
  const db = new engine.RelateDb();
  const run: RunStatement = (code, params) => {
    const envelopes = db.executeScript(code, params);
    return { envelopes, recording: JSON.parse(engine.renderResult(envelopes)) };
  };
  const expandProblems: string[] = [];
  try {
    const cells: CellRun[] = [];
    for (const cell of recipe.cells) {
      const params = cell.params === null ? null : (dataBlock(recipe, cell.params)?.text ?? null);
      if (cell.params !== null && params === null) {
        return { cells, stopped: `cell \`${cell.id}\`: no \`json data=${cell.params}\` block`, expandProblems };
      }
      const envelopes = db.executeScript(cell.code, params);
      const recording = JSON.parse(engine.renderResult(envelopes)) as Recording & { graph?: Graph | null };
      cells.push({ id: cell.id, envelopes, recording });
      // The engine runs nothing for a blank or comment-only script.
      if (envelopes.length === 0) return { cells, stopped: `cell \`${cell.id}\` has no statements`, expandProblems };
      const stopped = surprise(cell, lastEnvelope(envelopes));
      if (stopped) return { cells, stopped, expandProblems };
      const problem = await expandProblem(cell.id, run, recording.graph ?? null);
      if (problem) expandProblems.push(problem);
    }
    return { cells, stopped: null, expandProblems };
  } finally {
    db.free();
  }
}

/**
 * How expanding a node of a step's graph result (the graph view's
 * double-click, ADR-0151) goes other than it should, run right after the
 * step, or null. It expands the graph's first node and expects every
 * relationship of that node the step recorded, unless the expansion hit its
 * limit.
 */
export async function expandProblem(cellId: string, run: RunStatement, graph: Graph | null): Promise<string | null> {
  const node = graph?.nodes[0];
  if (!graph || !node) return null;
  let found;
  try {
    found = await expandNode(run, node.id, graph.nodes.map((n) => n.id));
  } catch (err) {
    return `cell \`${cellId}\`: expanding node ${node.id} in the graph view failed: ${(err as Error).message}`;
  }
  const got = new Set(found.rels.map((r) => r.id));
  const missing = graph.rels
    .filter((r) => (r.start_node === node.id || r.end_node === node.id) && !got.has(r.id))
    .map((r) => r.id);
  if (missing.length === 0 || found.truncated) return null;
  return `cell \`${cellId}\`: expanding node ${node.id} in the graph view missed its relationship(s) ${missing.join(', ')}`;
}

/**
 * Problems with a run that do not depend on the recorded output: a cell that
 * went other than its recipe says (and the cells it kept from running), or an
 * oversized result.
 */
export function checkRun(recipe: Recipe, run: RecipeRun): string[] {
  const errs: string[] = run.stopped ? [run.stopped] : [];
  const skipped = recipe.cells.length - run.cells.length;
  if (skipped > 0) errs.push(`the ${skipped} cell(s) after it did not run`);
  for (const cell of run.cells) {
    for (const env of cell.envelopes) {
      const rows = (JSON.parse(env) as { rows?: unknown[] }).rows;
      const n = Array.isArray(rows) ? rows.length : 0;
      if (n > MAX_RESULT_ROWS) {
        errs.push(`cell \`${cell.id}\` returns ${n} rows; add a LIMIT (max ${MAX_RESULT_ROWS})`);
      }
    }
  }
  return errs;
}

/** How each cell's result differs from its recording: one problem per cell, both texts shown. */
export function resultProblems(recipe: Recipe, run: RecipeRun): string[] {
  const problems: string[] = [];
  for (const { id, recording } of run.cells) {
    const cell = recipe.cells.find((c) => c.id === id)!;
    if (!cell.result) {
      problems.push(`cell \`${id}\` has no result block; run \`npm run cookbook:record\``);
    } else if (cell.result.kind !== recording.kind || cell.result.text !== recording.text) {
      problems.push(
        `cell \`${id}\` result differs from its recording\n` +
          `--- recorded (${cell.result.kind})\n${cell.result.text}\n--- actual (${recording.kind})\n${recording.text}`,
      );
    }
  }
  return problems;
}
