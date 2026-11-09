// `:::embed-question`, embed your own question (DOCS-PLAN.md §7.3, ADR-0049;
// the build side and the static form are src/lib/docs/elements/embed-question.ts).
// Live, it shows a question box holding the step's stored question, a
// button that names the download size, the statement it will send, and the
// step's recording. Nothing downloads until the reader presses the button:
// then a worker (_embed-question-worker.ts) fetches bge-small-en-v1.5's
// half-precision weights and tokenizer from the Hugging Face hub at the
// pinned revision and the ONNX runtime from this site, checks each file's
// size and SHA-256, and loads them. "Embed and search" embeds the question in
// that worker and runs the step on the page's database with its first line
// replaced (`withVector`), so the reader's vector takes the stored one's
// place and every other line runs as written. Where the page stores a vector
// for the same text, the element reads it back and prints the cosine
// similarity of the two. Unload, and leaving the page, terminate the worker,
// which hands its memory back; the engine bar's Reset puts the recording back
// and keeps the model.
//
// The button and its size stay at every width; a narrow screen's note says
// the download is the same there. Nothing animates.

import { engineMs, liveLine, recordedLine, versions } from '../../../lib/docs/elements/_wording.ts';
import {
  AGREEMENT_MIN_COSINE,
  bindingOf,
  cosine,
  DOWNLOAD_BYTES,
  MAX_QUESTION_CHARS,
  megabytes,
  SIZES,
  storedVector,
  vectorValues,
  withVector,
} from '../../../lib/docs/elements/_embed-question-model.ts';
import type { CellHandle, ElementContext, Envelope, PageApi } from '../element-api.ts';
// `?inline`: the styles ride in this lazy chunk (a plain import would put them on every docs page).
import styles from './embed-question.css?inline';

/** At least this wide, the note speaks to a desktop browser; narrower, to a phone. */
const WIDE_PX = 720;

type FromWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'vector'; id: number; vector: number[]; tokens: number }
  | { type: 'error'; id?: number; message: string };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  parent?.append(node);
  return node;
}

/** The id of the cell before `id`, so a run first runs the steps the search needs and not the search itself. */
function before(page: PageApi, id: string): string | null {
  const cells = page.cells();
  const i = cells.findIndex((c) => c.id === id);
  return i > 0 ? cells[i - 1].id : null;
}

/** The step's parameters as the reader has them now (an object), or {}. */
function paramsOf(cell: CellHandle): Record<string, unknown> {
  try {
    const v = JSON.parse(cell.params() ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

export async function mount(ctx: ElementContext) {
  const { page, live, attrs } = ctx;
  ctx.adoptStyles(styles);
  const cell = page.cell(attrs.cell ?? '');
  if (!cell) throw new Error(`embed question: the page has no cell ${attrs.cell}`);
  const binding = bindingOf(cell.authoredCode());
  if (typeof binding === 'string') throw new Error(`embed question: cell ${cell.id}: ${binding}`);
  const statement = withVector(cell.authoredCode(), binding);
  const storedQuestion = String(paramsOf(cell).q ?? '');
  const recorded = (await cell.recorded()).envelope as Pick<Envelope, 'columns' | 'rows' | 'error'> | null;
  const wide = matchMedia(`(min-width: ${WIDE_PX}px)`).matches;

  // ---------------------------------------------------------------- the pane
  const root = el('div', { class: 'embed-question' });
  el('p', {
    class: 'eq-note',
    text:
      `The model is ${SIZES.total}: its weights (${SIZES.weights}) and tokenizer (${SIZES.tokenizer}) from huggingface.co, each checked against its SHA-256, and the ONNX runtime (${SIZES.runtime}) from this site. ` +
      (wide ? 'It is meant for a desktop browser. ' : 'On a phone it is the same download, meant for a desktop browser. ') +
      'Your question is embedded in this tab and never sent anywhere; the page stores nothing in your browser.',
  }, root);
  const form = el('form', { class: 'eq-form' }, root);
  const label = el('label', { class: 'eq-question' }, form);
  el('span', { text: 'Question' }, label);
  const input = el('input', { type: 'text', maxlength: String(MAX_QUESTION_CHARS), autocomplete: 'off', spellcheck: 'false' }, label);
  input.value = storedQuestion;
  const bar = el('div', { class: 'eq-bar' }, form);
  const download = el('button', { type: 'button', class: 'btn eq-download', text: `Download the model (${SIZES.total})` }, bar);
  download.setAttribute('aria-label', `Download the model: ${SIZES.total}, from huggingface.co and this site`);
  const ask = el('button', { type: 'submit', class: 'btn eq-ask', text: 'Embed and search' }, bar);
  ask.hidden = true;
  const unload = el('button', { type: 'button', class: 'btn eq-unload', text: 'Unload' }, bar);
  unload.setAttribute('aria-label', 'Unload the model and return its memory');
  unload.hidden = true;
  const progressRow = el('div', { class: 'eq-progress' }, root);
  const progress = el('progress', { max: String(DOWNLOAD_BYTES), value: '0' }, progressRow);
  progress.setAttribute('aria-label', 'Download');
  const progressText = el('span', {}, progressRow);
  progressRow.hidden = true;

  const said = el('p', { class: 'eq-said', role: 'status' }, root);
  const details = el('details', { class: 'eq-statement' }, root);
  el('summary', { text: 'The statement sent' }, details);
  el('code', { text: statement }, el('pre', {}, details));
  const table = el('table', { class: 'eq-table' }, root);
  const caption = el('caption', {}, table);
  const head = table.createTHead();
  const body = table.createTBody();
  const agreement = el('p', { class: 'eq-agreement' }, root);

  const fill = (env: Pick<Envelope, 'columns' | 'rows'> | null, text: string) => {
    caption.textContent = text;
    const columns = env?.columns ?? [];
    head.replaceChildren();
    body.replaceChildren();
    const tr = head.insertRow();
    for (const c of columns) el('th', { scope: 'col', text: c }, tr);
    for (const row of env?.rows ?? []) {
      const r = body.insertRow();
      for (const c of columns) el('td', typeof row[c] === 'number' ? { text: show(row[c]), class: 'eq-num' } : { text: show(row[c]) }, r);
    }
  };
  const showRecording = () => {
    fill(recorded, `Recorded: step ${cell.id} for the stored question "${storedQuestion}"`);
    agreement.textContent = '';
  };
  showRecording();
  said.textContent = `${recordedLine(versions(page).recorded)} The table shows step ${cell.id}'s recording.`;
  live.replaceChildren(root);
  ctx.showLive();

  // ---------------------------------------------------------------- state
  let worker: Worker | null = null;
  let ready = false;
  let busy = false;
  let nextId = 1;
  /** Bumped by every unload: a download or a search that started before one is dropped, and says nothing. */
  let generation = 0;
  /** Rejects the download in progress, if any (Unload during a download). */
  let abortLoad: ((err: Error) => void) | null = null;
  const waiting = new Map<number, { resolve: (v: { vector: number[]; tokens: number }) => void; reject: (e: Error) => void }>();
  /** For a browser case: the last vector this tab made, the text it embedded, and the rows it found. */
  const last: { text: string | null; vector: number[] | null; rows: Record<string, unknown>[] | null; cosine: number | null } = { text: null, vector: null, rows: null, cosine: null };
  Object.defineProperty(root, 'embedQuestion', { value: last, configurable: true });

  const setState = () => {
    download.hidden = ready;
    download.disabled = busy;
    ask.hidden = !ready;
    ask.disabled = busy;
    unload.hidden = !worker;
    root.dataset.state = busy ? 'busy' : ready ? 'ready' : 'idle';
  };
  const stopWorker = () => {
    generation++;
    abortLoad?.(new Error('the model was unloaded'));
    abortLoad = null;
    worker?.terminate();
    worker = null;
    ready = false;
    for (const w of waiting.values()) w.reject(new Error('the model was unloaded'));
    waiting.clear();
    progressRow.hidden = true;
  };

  const startWorker = () =>
    new Promise<void>((resolve, reject) => {
      const w = new Worker(new URL('./_embed-question-worker.ts', import.meta.url), { type: 'module', name: 'embed-question' });
      worker = w;
      abortLoad = reject;
      w.addEventListener('message', (event: MessageEvent<FromWorker>) => {
        if (w !== worker) return;
        const m = event.data;
        if (m.type === 'progress') {
          progress.value = m.loaded;
          progressText.textContent = `${megabytes(m.loaded)} of ${megabytes(m.total)}`;
        } else if (m.type === 'ready') {
          abortLoad = null;
          resolve();
        }
        else if (m.type === 'vector') {
          waiting.get(m.id)?.resolve({ vector: m.vector, tokens: m.tokens });
          waiting.delete(m.id);
        } else if (m.type === 'error') {
          if (m.id === undefined) reject(new Error(m.message));
          else {
            waiting.get(m.id)?.reject(new Error(m.message));
            waiting.delete(m.id);
          }
        }
      });
      w.addEventListener('error', (event) => {
        if (w !== worker) return;
        event.preventDefault();
        const err = new Error(event.message || 'the model worker failed to start');
        reject(err);
        for (const x of waiting.values()) x.reject(err);
        waiting.clear();
      });
      w.postMessage({ type: 'load' });
    });

  const embed = (text: string) =>
    new Promise<{ vector: number[]; tokens: number }>((resolve, reject) => {
      if (!worker) return reject(new Error('the model is not loaded'));
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ type: 'embed', id, text });
    });

  download.addEventListener('click', async () => {
    if (busy || ready) return;
    const gen = generation;
    busy = true;
    progress.value = 0;
    progressText.textContent = `0 of ${SIZES.total}`;
    progressRow.hidden = false;
    said.textContent = `Downloading the model: ${SIZES.total}…`;
    setState();
    try {
      await startWorker();
      ready = true;
      progressRow.hidden = true;
      said.textContent = 'The model is loaded in this tab, its files checked against their SHA-256. Type a question and press Embed and search.';
    } catch (err) {
      // Unloaded mid-download: Unload has reset the controls and said so.
      if (gen !== generation) return;
      stopWorker();
      said.textContent = `The model did not load: ${(err as Error)?.message ?? String(err)}`;
    }
    busy = false;
    setState();
  });

  const search = async () => {
    if (busy || !ready) return;
    const text = input.value.trim();
    if (!text) {
      said.textContent = 'Type a question first.';
      return;
    }
    const gen = generation;
    busy = true;
    setState();
    said.textContent = 'Embedding your question in this tab…';
    try {
      const { vector } = await embed(text);
      last.text = text;
      last.vector = vector;
      last.rows = null;
      last.cosine = null;
      said.textContent = `Running step ${cell.id} with your question's vector…`;
      const params = JSON.stringify({ ...paramsOf(cell), q: text, embedding: vector });
      const r = await page.run(statement, params, { upTo: before(page, cell.id) });
      if (gen !== generation) return;
      if (r.error) {
        said.textContent = `The search failed: ${r.error}`;
        return;
      }
      const env = r.envelopes.at(-1) ?? null;
      last.rows = env?.rows ?? [];
      fill(env, `This tab: step ${cell.id} for "${text}"`);
      said.textContent = liveLine({ version: versions(page).live, ms: engineMs(r.envelopes), of: `step ${cell.id} with your question's vector` });
      const back = await page.run(storedVector(binding), JSON.stringify({ q: text }), { upTo: null });
      if (gen !== generation) return;
      const stored = vectorValues(back.envelopes.at(-1)?.rows?.[0]?.v);
      if (back.error || !stored) {
        agreement.textContent = 'The page stores no vector for this question, so the search used only the one this tab made.';
      } else {
        const c = cosine(vector, stored);
        last.cosine = c;
        agreement.textContent =
          `The page also stores a vector for this question. Its cosine similarity with the one this tab made is ${c.toFixed(6)}` +
          (c >= AGREEMENT_MIN_COSINE ? `, at least ${AGREEMENT_MIN_COSINE}: the same model, revision and pooling.` : `, under ${AGREEMENT_MIN_COSINE}: not the vector the page's model makes.`);
      }
    } catch (err) {
      if (gen === generation) said.textContent = `Could not finish: ${(err as Error)?.message ?? String(err)}`;
    } finally {
      // After an unload, Unload has reset the controls; a later download owns them now.
      if (gen === generation) {
        busy = false;
        setState();
      }
    }
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!ready) {
      said.textContent = `Download the model first (${SIZES.total}).`;
      return;
    }
    void search();
  });
  unload.addEventListener('click', () => {
    stopWorker();
    busy = false;
    setState();
    said.textContent = 'The model is unloaded and its memory is back with the tab.';
  });

  // The engine bar's Reset empties the page's database: the recording comes back; the model stays loaded.
  const offReset = page.onReset(() => {
    showRecording();
    last.rows = null;
    said.textContent = `The page was reset. ${recordedLine(versions(page).recorded)} The table shows step ${cell.id}'s recording.`;
  });
  setState();
  return () => {
    offReset();
    stopWorker();
  };
}
