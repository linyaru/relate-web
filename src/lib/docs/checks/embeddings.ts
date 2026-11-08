// The embeddings staleness check (DOCS-PLAN.md §8 item 3e): the committed
// artifact src/content/docs/_data/embeddings.json against the docs graph, by
// content hash only. No model, no network, no secret: the vectors are
// written by `npm run docs:embeddings` (the authoring-only package in
// scripts/embeddings/), and this check only asks whether they are current.
//
//   embeddings-artifact  the file is missing, unreadable, not format 1, or was
//                        made with another model, dimension or encoding
//   embeddings-stale     a section has no vector, or its vector's SHA-256 is not
//                        that of the text it would embed now (sectionInputs in
//                        src/lib/docs/graph.ts); one finding per page
//   embeddings-orphan    a vector for a section the graph no longer has
//   embeddings-vector    a vector that does not decode to 384 finite floats
//   embeddings-query     a recipe question (RECIPE_QUESTIONS) with no vector or
//                        a stale one, or a query vector no question uses
//   embeddings-recipe    the `docs` data block of the cookbook recipe "Query
//                        the relate docs" differs from the subset the graph
//                        gives now (recipeData), or the subset cannot be built
//
// Every rule is an error: a stale vector leaves its section out of the seed's
// vector index, so the hybrid search silently stops finding it. The remedy in
// every message is the command to run. DOCS_EMBEDDINGS_SEVERITY=warning (or
// off) lowers them all, for a local edit in progress; CI never sets it.

import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { ROOT, type PageFile } from '../content.ts';
import {
  artifactMatchesModel,
  buildGraph,
  decodeVector,
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
  EMBEDDINGS_COMMAND,
  EMBEDDINGS_FILE,
  graphInput,
  readEmbeddings,
  recipeData,
  recipeDataBlock,
  RECIPE_FILE,
  RECIPE_QUESTIONS,
  sectionInputs,
  sha256Hex,
  type DocsGraph,
  type EmbeddingsArtifact,
} from '../graph.ts';
import type { Report, Severity } from './graph.ts';

export const EMBEDDINGS_RULES = [
  'embeddings-artifact',
  'embeddings-stale',
  'embeddings-orphan',
  'embeddings-vector',
  'embeddings-query',
  'embeddings-recipe',
] as const;
export type EmbeddingsRule = (typeof EMBEDDINGS_RULES)[number];

export interface EmbeddingsSite {
  pages: PageFile[];
}

export interface EmbeddingsCheckOptions {
  /** The graph to check; built from `site.pages` when absent. */
  graph?: DocsGraph;
  /** The artifact to check (null: none); read from EMBEDDINGS_FILE when absent. */
  artifact?: EmbeddingsArtifact | null;
  /** The recipe's source (null: no recipe); read from RECIPE_FILE when absent. */
  recipe?: string | null;
  severity?: Severity | 'off';
}

export interface EmbeddingsCheckStats {
  sections: number;
  current: number;
  stale: number;
  orphans: number;
}

const run = `run \`${EMBEDDINGS_COMMAND}\` (after \`npm ci --prefix scripts/embeddings\`; the first run downloads the model)`;
const runForce = `run \`${EMBEDDINGS_COMMAND} -- --force\` (after \`npm ci --prefix scripts/embeddings\`)`;

/** The severity after the option and DOCS_EMBEDDINGS_SEVERITY. */
export function embeddingsSeverity(option?: Severity | 'off', env = process.env.DOCS_EMBEDDINGS_SEVERITY ?? ''): Severity | 'off' {
  const v = env.trim();
  if (v === '') return option ?? 'error';
  if (v !== 'error' && v !== 'warning' && v !== 'off') throw new Error(`DOCS_EMBEDDINGS_SEVERITY: "${v}" is not error, warning or off`);
  return v;
}

/** Checks the embeddings artifact and the recipe's data block against the docs graph. */
export function checkEmbeddings(site: EmbeddingsSite, report: Report, options: EmbeddingsCheckOptions = {}): EmbeddingsCheckStats {
  const severity = embeddingsSeverity(options.severity);
  const stats: EmbeddingsCheckStats = { sections: 0, current: 0, stale: 0, orphans: 0 };
  if (severity === 'off') return stats;
  const emit = (rule: EmbeddingsRule, file: string, message: string) => report(file, null, severity, rule, message);
  const artifactFile = relative(ROOT, EMBEDDINGS_FILE);

  let artifact: EmbeddingsArtifact | null;
  try {
    artifact = options.artifact !== undefined ? options.artifact : readEmbeddings();
  } catch (e) {
    emit('embeddings-artifact', artifactFile, `${(e as Error).message}`);
    return stats;
  }
  const graph = options.graph ?? buildGraph({ ...graphInput(site.pages), embeddings: artifact });
  const inputs = sectionInputs(graph);
  stats.sections = inputs.length;
  if (!artifact) {
    emit('embeddings-artifact', artifactFile, `missing: the docs graph's ${inputs.length} sections have no vectors; ${run}`);
    return stats;
  }
  if (!artifactMatchesModel(artifact)) {
    emit(
      'embeddings-artifact',
      artifactFile,
      `made with ${JSON.stringify(artifact.model?.onnx ?? artifact.model?.id ?? null)} at ${artifact.dimension} dimensions (${artifact.encoding}); the docs graph expects ${EMBEDDING_MODEL.onnx}@${EMBEDDING_MODEL.revision.slice(0, 12)} (${EMBEDDING_MODEL.pooling} pooling) at ${EMBEDDING_DIMENSION}: every vector is stale; ${runForce}`,
    );
    return stats;
  }

  // Sections: missing or stale, grouped by page.
  const fileOf = new Map(site.pages.map((p) => [p.id, relative(ROOT, p.file)]));
  const byId = new Map(artifact.sections.map((e) => [e.id, e]));
  const stalePerPage = new Map<string, string[]>();
  for (const s of inputs) {
    const e = byId.get(s.id);
    if (e && e.sha256 === s.sha256) {
      stats.current++;
      continue;
    }
    stats.stale++;
    const page = s.id.slice(0, s.id.indexOf('#'));
    const anchor = s.id.slice(s.id.indexOf('#') + 1);
    const what = `${anchor ? `#${anchor}` : 'the opening text'}${e ? ' (text changed)' : ' (no vector)'}`;
    stalePerPage.set(page, [...(stalePerPage.get(page) ?? []), what]);
  }
  for (const [page, list] of [...stalePerPage].sort(([a], [b]) => (a < b ? -1 : 1))) {
    emit('embeddings-stale', fileOf.get(page) ?? page, `${list.length} section(s) have no current vector: ${list.join(', ')}; ${run}`);
  }
  const sectionIds = new Set(inputs.map((s) => s.id));
  const orphans = artifact.sections.filter((e) => !sectionIds.has(e.id)).map((e) => e.id);
  stats.orphans = orphans.length;
  if (orphans.length) emit('embeddings-orphan', artifactFile, `${orphans.length} vector(s) for sections the docs graph no longer has: ${orphans.join(', ')}; ${run}`);
  for (const e of [...artifact.sections, ...artifact.queries]) {
    const v = decodeVector(e.vector);
    if (v.length !== EMBEDDING_DIMENSION || !v.every(Number.isFinite)) {
      emit('embeddings-vector', artifactFile, `the vector of ${JSON.stringify(e.id)} decodes to ${v.length} values${v.every(Number.isFinite) ? '' : ', not all finite'}, not ${EMBEDDING_DIMENSION} finite floats; ${runForce}`);
    }
  }

  // The recipe's questions.
  const queries = new Map(artifact.queries.map((q) => [q.id, q]));
  for (const q of RECIPE_QUESTIONS) {
    const e = queries.get(q);
    if (!e || e.sha256 !== sha256Hex(q)) emit('embeddings-query', artifactFile, `the recipe question ${JSON.stringify(q)} has ${e ? 'a stale vector' : 'no vector'}; ${run}`);
  }
  const unused = artifact.queries.filter((q) => !(RECIPE_QUESTIONS as readonly string[]).includes(q.id)).map((q) => JSON.stringify(q.id));
  if (unused.length) emit('embeddings-query', artifactFile, `query vector(s) no recipe question uses: ${unused.join(', ')}; ${run}`);

  // The recipe's data block.
  const recipeFile = relative(ROOT, RECIPE_FILE);
  const source = options.recipe !== undefined ? options.recipe : existsSync(RECIPE_FILE) ? readFileSync(RECIPE_FILE, 'utf8') : null;
  if (source === null) {
    emit('embeddings-recipe', recipeFile, 'the cookbook recipe "Query the relate docs" is missing');
    return stats;
  }
  let want: string;
  try {
    want = recipeData(graph, artifact);
  } catch (e) {
    emit('embeddings-recipe', recipeFile, `its \`docs\` data block cannot be built: ${(e as Error).message}`);
    return stats;
  }
  const have = recipeDataBlock(source);
  if (have === null) emit('embeddings-recipe', recipeFile, 'the recipe has no ```json data=docs block');
  else if (have !== want) {
    const at = [...have].findIndex((c, i) => c !== want[i]);
    const line = have.slice(0, at).split('\n').length;
    emit(
      'embeddings-recipe',
      recipeFile,
      `its \`docs\` data block differs from the docs graph's subset (first at line ${line} of the block: ${JSON.stringify(have.split('\n')[line - 1]?.slice(0, 80) ?? '')} where the graph gives ${JSON.stringify(want.split('\n')[line - 1]?.slice(0, 80) ?? '')}); ${run}, then COOKBOOK_ONLY=query-the-relate-docs npm run cookbook:record`,
    );
  }
  return stats;
}
