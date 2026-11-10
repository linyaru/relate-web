// cookbook:browser cases for `:::embed-question`, embed your own question
// (src/lib/docs/elements/embed-question.ts, ADR-0050): it goes live with the
// download size on its button and fetches nothing, starts no worker and no
// engine before the press; then, after one press (the model's files come
// from the Hugging Face hub at the pinned revision, so this case needs the
// network), the vectors this tab makes for the recipe's two stored
// questions agree with the committed ones: cosine similarity at least
// AGREEMENT_MIN_COSINE with the vectors in the recipe's data block (the
// committed float16 vectors rounded to four decimals), the same five
// sections in the same order as those vectors rank by cosine in plain
// JavaScript (the recipe's `context` step returns them grouped by page,
// each row a page with its sections in order), and for the step's own
// question the step's recorded rows, every cell the same and every score
// within 0.0002. The engine bar's Reset brings the
// recording back and keeps the model; Unload puts the download button back.

import { AGREEMENT_MIN_COSINE, DOWNLOAD_BYTES, megabytes, SIZES } from '../../src/lib/docs/elements/_embed-question-model.ts';
import { scenario, type BrowserCases } from './_kit.ts';

/** Bring the element live: `h` the host, `root` the pane, and its parts. */
const UP = `
  const h = await live('embed-question');
  if (!h) return { log: [], failures: ['the element did not go live (state ' + (host('embed-question') || {}).dataset?.state + ')'] };
  const root = h.querySelector('.embed-question');
  const q = (s) => root.querySelector(s);
  const said = q('.eq-said');
  const bar = document.getElementById('engineBar');
  const rows = () => [...q('.eq-table tbody').rows].map((r) => [...r.cells].map((c) => c.textContent));
`;

/** "From this tab's run of step vector with your question's vector on relate 0.16.1, 0.8 ms in the engine." */
const LIVE_LINE = String.raw`/^From this tab's run of step \S+ with your question's vector on relate \d+\.\d+\.\d+, (?:<0\.1|\d+(?:\.\d)?) ms in the engine\.$/`;

export default {
  element: 'embed-question',
  cases: [
    {
      name: 'goes live with the download size and fetches nothing before the press',
      scenario: scenario(`
        ${UP}
        const log = [], failures = [];
        const wide = innerWidth >= 720;
        expect(log, failures, 'the static form hides', h.querySelector('.element-static').hidden);
        const label = q('.eq-download').textContent;
        expect(log, failures, 'the button states the download size', label === ${JSON.stringify(`Download the model (${SIZES.total})`)}, label);
        expect(log, failures, 'the static form states the same size', h.querySelector('.element-static').textContent.includes(${JSON.stringify(`downloads ${SIZES.total}`)}));
        expect(log, failures, 'the note names both sources and the sizes', /huggingface\\.co/.test(q('.eq-note').textContent) && q('.eq-note').textContent.includes(${JSON.stringify(SIZES.weights)}) && q('.eq-note').textContent.includes(${JSON.stringify(SIZES.runtime)}), q('.eq-note').textContent);
        expect(log, failures, (wide ? 'a wide screen' : 'a narrow screen') + "'s note fits it", wide ? /desktop browser/.test(q('.eq-note').textContent) : /On a phone it is the same download/.test(q('.eq-note').textContent), q('.eq-note').textContent);
        expect(log, failures, 'the question box holds the stored question', q('.eq-question input').value.length > 0, q('.eq-question input').value);
        expect(log, failures, 'the table shows the recording', /^Recorded: step /.test(q('.eq-table caption').textContent) && rows().length > 0, q('.eq-table caption').textContent);
        expect(log, failures, 'the status names the recording', /^Recorded on relate [\\d.]+ when the page was built\\./.test(said.textContent), said.textContent);
        expect(log, failures, 'the statement sent swaps only the first line', /^WITH \\{\\w+: vector\\(\\$embedding, 384, FLOAT32\\)\\} AS \\w+\\n/.test(q('.eq-statement code').textContent), q('.eq-statement code').textContent.split('\\n')[0]);
        const fetched = performance.getEntriesByType('resource').map((e) => e.name);
        expect(log, failures, 'nothing came from the hub', !fetched.some((u) => /huggingface\\.co|\\.hf\\.co/.test(u)));
        expect(log, failures, 'no runtime or model worker loaded', !fetched.some((u) => /ort-wasm|embed-question-worker|onnx/.test(u)), fetched.filter((u) => /ort|onnx|worker/.test(u)).join(', '));
        expect(log, failures, 'no engine has started', !engineLoaded() && !bar.dataset.status, bar.dataset.status);
        expect(log, failures, 'Embed and search waits for the model', q('.eq-ask').hidden && q('.eq-unload').hidden);
        return { log: [innerWidth + ' px, ' + label + '; ' + log.filter((l) => l.startsWith('FAIL')).length + ' failed'], failures };
      `),
    },
    {
      name: "the tab's vectors agree with the committed ones, then Reset and Unload",
      scenario: scenario(`
        ${UP}
        const log = [], failures = [];
        const data = await (await fetch(location.pathname.replace(/\\/?$/, '/') + 'data/docs.json')).json();
        const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y); };
        const f32 = (v) => Float32Array.from(v);
        const title = Object.fromEntries(data.pages.map((p) => [p.id, p.title]));
        const sections = data.sections.map((s) => ({ page: s.page, heading: s.heading, id: s.id, e: f32(s.e) }));
        // The five sections the vector ranks first, grouped by page in the order the step returns them: "<page title> | <heading>, <heading>".
        const topFive = (v) => {
          const top = sections.map((s) => ({ ...s, c: cos(f32(v), s.e) })).sort((a, b) => b.c - a.c || (a.id < b.id ? -1 : 1)).slice(0, 5);
          const pages = [];
          for (const s of top) (pages.find((p) => p.page === s.page) || pages[pages.push({ page: s.page, headings: [] }) - 1]).headings.push(s.heading);
          return pages.map((p) => title[p.page] + ' | ' + p.headings.join(', '));
        };
        const columns = () => [...q('.eq-table thead tr').cells].map((c) => c.textContent);
        q('.eq-download').click();
        await until(() => q('.eq-progress progress').value > 0, 120000);
        expect(log, failures, 'the download shows its progress against the stated size', !q('.eq-progress').hidden && q('.eq-progress span').textContent.endsWith(${JSON.stringify(` of ${megabytes(DOWNLOAD_BYTES)}`)}), q('.eq-progress span').textContent);
        q('.eq-unload').click();
        await wait(300);
        expect(log, failures, 'Unload during the download stops it and puts the button back', root.dataset.state === 'idle' && !q('.eq-download').hidden && q('.eq-unload').hidden && q('.eq-progress').hidden && /unloaded/.test(said.textContent), root.dataset.state + ' / ' + said.textContent);
        q('.eq-download').click();
        await until(() => root.dataset.state !== 'busy', 600000);
        expect(log, failures, 'the model loads, every file matching its pinned size and SHA-256', root.dataset.state === 'ready', said.textContent);
        if (root.dataset.state !== 'ready') return { log: [said.textContent], failures };
        expect(log, failures, 'the page\\'s engine did not start for the download', !bar.dataset.status, bar.dataset.status);
        const recorded = rows();
        const stored = q('.eq-question input').value;
        expect(log, failures, "the step's own question is one of the data's questions", data.questions.some((x) => x.q === stored), stored);
        const out = [];
        for (const question of data.questions) {
          q('.eq-question input').value = question.q;
          q('.eq-ask').click();
          await wait(50);
          await until(() => root.dataset.state !== 'busy', 120000);
          const last = root.embedQuestion;
          const c = last.vector ? cos(last.vector, question.e) : NaN;
          out.push(c.toFixed(7));
          expect(log, failures, '"' + question.q + '": cosine with the committed vector at least ${AGREEMENT_MIN_COSINE}', c >= ${AGREEMENT_MIN_COSINE}, String(c) + ' / ' + said.textContent);
          expect(log, failures, '"' + question.q + '": a vector of 384 numbers of length 1', last.vector && last.vector.length === 384 && Math.abs(Math.hypot(...last.vector) - 1) < 1e-5);
          const liveTop = (last.rows || []).map((r) => r.page + ' | ' + (r.sections || []).join(', '));
          const refTop = topFive(question.e);
          expect(log, failures, '"' + question.q + '": the engine returns the five sections the committed vector ranks first, in order, grouped by page', liveTop.length === refTop.length && liveTop.every((k, i) => k === refTop[i]), liveTop.join('; ') + ' vs ' + refTop.join('; '));
          expect(log, failures, '"' + question.q + '": the element reports the agreement it measured', last.cosine !== null && last.cosine >= ${AGREEMENT_MIN_COSINE} && /cosine similarity with the one this tab made is \\d\\.\\d{6}, at least/.test(q('.eq-agreement').textContent), q('.eq-agreement').textContent);
          expect(log, failures, '"' + question.q + '": the status is the live line', ${LIVE_LINE}.test(said.textContent), said.textContent);
          if (question.q === stored) {
            const now = rows();
            const score = columns().indexOf('score');
            const same = score >= 0 && now.length === recorded.length && now.every((r, i) => r.every((cell, j) => (j === score ? Math.abs(Number(cell) - Number(recorded[i][j])) <= 0.0002 : cell === recorded[i][j])));
            expect(log, failures, 'for the stored question, the step\\'s recorded rows, every cell the same and each score within 0.0002', same, JSON.stringify(now) + ' vs ' + JSON.stringify(recorded));
          }
        }
        q('.eq-question input').value = 'keep an agent from changing my data';
        q('.eq-ask').click();
        await wait(50);
        await until(() => root.dataset.state !== 'busy', 120000);
        expect(log, failures, 'a question with no stored vector searches with the tab\\'s vector alone', rows().length > 0 && /stores no vector for this question/.test(q('.eq-agreement').textContent), q('.eq-agreement').textContent + ' / ' + said.textContent);
        bar.querySelector('[data-action=reset]').click();
        await until(() => /^Recorded: step /.test(q('.eq-table caption').textContent), 10000);
        expect(log, failures, "the engine bar's Reset brings the recording back and keeps the model", /^Recorded: step /.test(q('.eq-table caption').textContent) && root.dataset.state === 'ready' && !q('.eq-agreement').textContent, q('.eq-table caption').textContent);
        q('.eq-unload').click();
        expect(log, failures, 'Unload puts the download button back', root.dataset.state === 'idle' && !q('.eq-download').hidden && q('.eq-ask').hidden && /unloaded/.test(said.textContent), said.textContent);
        return { log: ['cosine ' + out.join(', ')], failures };
      `),
    },
  ],
} satisfies BrowserCases;
