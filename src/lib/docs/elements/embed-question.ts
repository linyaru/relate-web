// `:::embed-question{cell=<vector search step>}`: embed a question of the
// reader's own in the browser (DOCS-PLAN.md §7.3 "In-browser embeddings",
// ADR-0049). The step names a stored vector by the question text (its first
// line is `MATCH (question:Question {text: $q})`) and searches a vector
// index with it. Live, behind a button that states the download size, the
// element fetches bge-small-en-v1.5 at the revision the page's vectors were
// made with (weights and tokenizer from the Hugging Face hub, the ONNX
// runtime from this site), checks each file's SHA-256, embeds the reader's
// question in a worker in the tab, and runs the step with its first line
// replaced by `WITH {embedding: vector($embedding, 384, FLOAT32)} AS
// question`, so every other line is the step as written. The pins and the
// rewrite are `_embed-question-model.ts`; the browser module is
// src/scripts/docs/elements/embed-question.ts.
//
// The static form says what the button downloads and from where (sizes
// measured from the pinned files), shows the line the element swaps in, and
// holds the step's recorded result for the page's stored question. It
// carries no timing (ADR-0044): the only number besides the recording is
// the download size the button states.

import { markdownTable } from '../element-kit.ts';
import type { ElementInput, ElementSpec } from '../elements.ts';
import { bindingOf, EMBED_MODEL, HUB_ORIGIN, MAX_QUESTION_CHARS, SIZES, vectorLine, type Binding } from './_embed-question-model.ts';

const ATTRIBUTES = new Set(['id', 'cell']);

/** The step's parameters as an object, or null when it takes none or they do not read. */
function paramsOf(input: ElementInput, cellId: string): Record<string, unknown> | null {
  const cell = input.cells.find((c) => c.id === cellId);
  const text = cell?.params ? input.dataBlocks[cell.params] : undefined;
  if (text === undefined) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const cellValue = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

export default {
  live: 'a button that states the download size fetches the model\'s weights and tokenizer from huggingface.co and the ONNX runtime from this site, checks each file\'s SHA-256, embeds the question you type in your browser (the question is never sent anywhere), and runs the step\'s vector search with that vector in place of the stored one on the page\'s database in your browser; nothing downloads before the press.',
  validate(input) {
    const out: string[] = [];
    const a = input.attributes;
    for (const k of Object.keys(a)) if (!ATTRIBUTES.has(k)) out.push(`takes \`cell=<step>\` and \`id\`, not \`${k}\``);
    if (!a.cell) return [...out, 'needs `cell=<step>`, the vector search to run with the reader\'s question'];
    const cell = input.cells.find((c) => c.id === a.cell);
    if (!cell) return [...out, `\`cell\` names \`${a.cell}\`, which is not a cell on the page`];
    if (cell.expectError) out.push(`\`cell\` names \`${a.cell}\`, which is expected to fail`);
    const b = bindingOf(cell.code);
    if (typeof b === 'string') out.push(`cell \`${a.cell}\` cannot take the reader's vector: ${b}`);
    const params = paramsOf(input, a.cell);
    if (!params) out.push(`cell \`${a.cell}\` takes no parameters block; it needs \`q\`, the stored question it searches with`);
    else if (typeof params.q !== 'string' || !params.q.trim()) out.push(`cell \`${a.cell}\`'s parameters give no question \`q\``);
    else if (params.q.length > MAX_QUESTION_CHARS) out.push(`cell \`${a.cell}\`'s question is longer than ${MAX_QUESTION_CHARS} characters`);
    const env = input.recordings[a.cell]?.envelope as { rows?: unknown[]; error?: string | null } | undefined;
    if (env && !env.error && !env.rows?.length) out.push(`cell \`${a.cell}\`'s recording has no rows: the stored question finds nothing to show`);
    return out;
  },
  staticForm(input) {
    const id = input.attributes.cell;
    const cell = input.cells.find((c) => c.id === id)!;
    const b = bindingOf(cell.code) as Binding;
    const q = String(paramsOf(input, id)?.q ?? '');
    const hub = HUB_ORIGIN.replace(/^https:\/\//, '');
    const intro = [
      `The element embeds a typed question with the model that made these vectors: [bge-small-en-v1.5](${HUB_ORIGIN}/${EMBED_MODEL.onnx}/tree/${EMBED_MODEL.revision}) at revision \`${EMBED_MODEL.revision.slice(0, 7)}\`, with ${EMBED_MODEL.pooling.toUpperCase()} pooling, normalized, as its half-precision ONNX weights.`,
      `The button downloads ${SIZES.total}: the weights (${SIZES.weights}) and the tokenizer (${SIZES.tokenizer}) from ${hub}, and the ONNX runtime (${SIZES.runtime}) from this site.`,
      'Nothing downloads before the press, and each file is checked against its SHA-256 before it is used.',
      `The question, at most ${MAX_QUESTION_CHARS} characters, is embedded in the browser tab and never sent anywhere.`,
    ].join(' ');
    const swap = `Step \`${id}\` then runs with its first line, \`${b.line}\`, replaced by \`${vectorLine(b)}\`, so \`${b.variable}.${b.property}\` is the typed question's vector and every other line runs as written.`;
    const env = input.recordings[id]?.envelope as { columns?: string[]; rows?: Record<string, unknown>[] } | undefined;
    const columns = env?.columns ?? [];
    const table = markdownTable(columns.length ? columns : ['result'], (env?.rows ?? []).map((r) => (columns.length ? columns.map((c) => cellValue(r[c])) : [JSON.stringify(r)])));
    const recorded = `Step \`${id}\`'s recorded result, for the stored question "${q}":`;
    return { text: `${intro}\n\n${swap}\n\n${recorded}\n\n${table}` };
  },
} satisfies ElementSpec;
