// cookbook:browser cases for `:::graph-diff` (src/lib/docs/elements/graph-diff.ts),
// on the migration-rehearsal recipe (ADR-0050): it goes live on the recorded
// diff without starting an engine, and its legend, table and graph view agree
// with a diff the case works out itself from the page's recordings of the
// before and after cells (nodes matched by the key property); each status
// has its symbol, word, width and token colour in the view; a table row,
// chosen with the keyboard, marks its element and dims the rest, and Escape
// clears it; Compare runs the page's cells on a separate database, leaving
// the page's engine unstarted and its cells on their recordings, and comes
// to the recorded diff; an edit to a cell between the two (a property set on
// one node) shows in the next diff as that node changed; the engine bar's
// Reset puts the recorded diff back.

import { scenario, type BrowserCases, type BrowserTab, type Outcome } from './_kit.ts';

/** Bring the element live: `h` the host, `root` its pane and its parts, `attrs` its directive. */
const UP = `
  const h = await live('graph-diff');
  if (!h) return { log: [], failures: ['the element did not go live (state ' + (host('graph-diff') || {}).dataset?.state + ')'] };
  const root = h.querySelector('.graph-diff');
  const q = (s) => root.querySelector(s);
  const said = q('.gd-said');
  const attrs = JSON.parse(h.dataset.attrs);
  const bar = document.getElementById('engineBar');
  const viewOf = () => q('.gd-frame').networkView;
  /** The legend's counts: {status: [nodes, relationships]}. */
  const legend = () => Object.fromEntries([...root.querySelectorAll('.gd-key')].map((li) => [li.dataset.status, (li.querySelector('.gd-count').textContent.match(/\\d[\\d,]*/g) || []).map((n) => Number(n.replace(/,/g, '')))]));
  /** The table's rows: [{status, kind, element, what}]. */
  const tableRows = () => [...root.querySelectorAll('.gd-table tbody tr[data-status]')].map((tr) => ({ status: tr.dataset.status, kind: tr.dataset.kind, element: tr.querySelector('.gd-pick').textContent, what: tr.querySelector('.gd-what').textContent }));
  /**
   * The diff worked out here from two results' rows, matching nodes by the
   * key property and relationships by type and the key of each end:
   * {status: [nodes, relationships]}, as the legend counts them.
   */
  const expectDiff = (beforeRows, afterRows) => {
    const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
    const state = (rows) => {
      const nodes = new Map(), rels = new Map(), byId = new Map();
      const walk = (v) => {
        if (Array.isArray(v)) return v.forEach(walk);
        if (!v || typeof v !== 'object') return;
        if (v.kind === 'node') { byId.set(v.id, v); return; }
        if (v.kind === 'relationship') { rels.set(v.id, v); return; }
        Object.values(v).forEach(walk);
      };
      walk(rows);
      for (const n of byId.values()) nodes.set(canon(n.properties[attrs.key]), canon([[...n.labels].sort(), n.properties]));
      const keyed = new Map();
      for (const r of rels.values()) keyed.set(canon(byId.get(r.start_node).properties[attrs.key]) + '|' + r.type + '|' + canon(byId.get(r.end_node).properties[attrs.key]), canon(r.properties));
      return { nodes, rels: keyed };
    };
    const a = state(beforeRows), b = state(afterRows);
    const count = (x, y) => {
      const out = { removed: 0, added: 0, changed: 0, unchanged: 0 };
      for (const k of new Set([...x.keys(), ...y.keys()])) out[!x.has(k) ? 'added' : !y.has(k) ? 'removed' : x.get(k) === y.get(k) ? 'unchanged' : 'changed']++;
      return out;
    };
    const n = count(a.nodes, b.nodes), r = count(a.rels, b.rels);
    return Object.fromEntries(['removed', 'added', 'changed', 'unchanged'].map((s) => [s, [n[s], r[s]]]));
  };
  const recordedExpect = async () => expectDiff((await recordedOf(attrs.before)).envelope.rows, (await recordedOf(attrs.after)).envelope.rows);
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const compareAndWait = async () => {
    q('.gd-compare').click();
    await wait(50);
    await until(() => root.dataset.state === 'idle', 120000);
  };
`;

/** "From this tab's run of the page's cells up to …, on a separate database on relate 0.16.1, 12.3 ms in the engine." */
const LIVE_LINE = String.raw`/^From this tab's run of the page's cells up to [\w-]+, on a separate database on relate \d+\.\d+\.\d+, (?:<0\.1|\d+(?:\.\d)?) ms in the engine\./`;

export default {
  element: 'graph-diff',
  cases: [
    {
      name: 'goes live on the recorded diff, which matches the page\'s recordings, without an engine',
      scenario: scenario(`
        ${UP}
        const log = [], failures = [];
        expect(log, failures, 'the static form hides', h.querySelector('.element-static').hidden);
        expect(log, failures, 'no engine has started', !engineLoaded() && !bar.dataset.status, bar.dataset.status);
        expect(log, failures, 'the status names the recording', /^Recorded on relate [\\d.]+ when the page was built\\. The view compares the recordings of cells /.test(said.textContent), said.textContent);
        const want = await recordedExpect();
        const got = legend();
        expect(log, failures, 'the legend counts what the recordings differ by', same(got, want), JSON.stringify(got) + ' vs ' + JSON.stringify(want));
        const rows = tableRows();
        const changes = want.removed[0] + want.added[0] + want.changed[0] + want.removed[1] + want.added[1] + want.changed[1];
        expect(log, failures, 'the table has a row per change', rows.length === changes && /as recorded$/.test(q('.gd-table caption').textContent), rows.length + ' rows, ' + changes + ' changes');
        expect(log, failures, 'each row says its change in a symbol and a word', rows.every((r) => ({ removed: '− removed', added: '+ added', changed: '~ changed' })[r.status] === root.querySelector('tr[data-status="' + r.status + '"] .gd-change').textContent));
        expect(log, failures, 'the legend names each status by symbol and word', ['− removed', '+ added', '~ changed'].every((t) => [...root.querySelectorAll('.gd-key')].some((li) => (li.querySelector('.gd-symbol').textContent + ' ' + li.querySelector('.gd-word').textContent) === t)));
        const view = viewOf();
        const st = view && view.state();
        const total = (i) => Object.values(want).reduce((t, c) => t + c[i], 0);
        expect(log, failures, 'the view draws every node and relationship of both states', st && Object.keys(st.nodes).length === total(0) && Object.keys(st.rels).length === total(1), st && Object.keys(st.nodes).length + ' nodes, ' + Object.keys(st.rels).length + ' relationships');
        const css = getComputedStyle(document.documentElement);
        const token = (t) => css.getPropertyValue(t).trim().toLowerCase();
        const rel = (status) => { const tr = root.querySelector('.gd-table tr[data-kind="relationship"][data-status="' + status + '"]'); return tr && st.rels['r:' + tr.dataset.id]; };
        for (const [status, tok, width] of [['removed', '--danger', 2], ['added', '--success', 3], ['changed', '--rel', 2]]) {
          const r = rel(status);
          if (!r) { log.push('note ' + status + ': no relationship ' + status + ' on this placement'); continue; }
          expect(log, failures, 'a ' + status + ' relationship is drawn ' + width + ' wide in ' + tok, r.color.toLowerCase() === token(tok) && r.width === width, JSON.stringify(r));
        }
        const caps = [...root.querySelectorAll('.gd-table tr[data-kind="node"]')].map((tr) => tr.dataset.status);
        expect(log, failures, 'the view is described in words', /^The diff of cells .+ The table lists every change\\.$/.test(q('.gd-stage').getAttribute('aria-label')));
        return { log: [innerWidth + ' px: ' + rows.length + ' changes, ' + total(0) + ' nodes, ' + total(1) + ' relationships drawn; ' + caps.length + ' node rows'], failures };
      `),
    },
    {
      name: 'a table row, chosen with the keyboard, marks its element in the view; Escape clears',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const setup = await tab.evaluate<Outcome>(scenario(`
          ${UP}
          const b = root.querySelector('.gd-table tr[data-kind="relationship"] .gd-pick');
          if (!b) return { log: [], failures: ['no relationship row to choose'] };
          b.focus();
          return { log: [], failures: document.activeElement === b ? [] : ['could not focus a row button'] };
        `));
        if (setup.failures.length) return setup;
        await tab.press('Enter', 'Enter', 13);
        const marked = await tab.evaluate<Outcome>(scenario(`
          ${UP}
          const log = [], failures = [];
          const b = document.activeElement;
          const tr = b.closest('tr');
          expect(log, failures, 'Enter presses the row', b.getAttribute('aria-pressed') === 'true', b.getAttribute('aria-pressed'));
          const st = viewOf().state();
          const id = 'r:' + tr.dataset.id;
          const others = Object.entries(st.rels).filter(([k]) => k !== id);
          expect(log, failures, 'its relationship keeps its colour, the others dim', st.rels[id].color !== st.dimmed && others.length > 0 && others.every(([, r]) => r.color === st.dimmed));
          const big = Object.values(st.nodes).filter((n) => n.size > 20);
          expect(log, failures, 'its two end nodes are drawn larger, the rest dim', big.length === 2 && Object.values(st.nodes).filter((n) => n.color === st.dimmed).length === Object.keys(st.nodes).length - 2, big.length + ' larger');
          expect(log, failures, 'the choice is said in words', /^Marked in the view: /.test(q('.gd-picked').textContent), q('.gd-picked').textContent);
          return { log, failures };
        `));
        await tab.press('Escape', 'Escape', 27);
        const cleared = await tab.evaluate<Outcome>(scenario(`
          ${UP}
          const log = [], failures = [];
          const st = viewOf().state();
          expect(log, failures, 'Escape clears the mark', !root.querySelector('.gd-pick[aria-pressed="true"]') && Object.values(st.rels).every((r) => r.color !== st.dimmed) && !q('.gd-picked').textContent);
          return { log, failures };
        `));
        const failures = [...marked.failures, ...cleared.failures];
        return { log: [`${marked.log.length + cleared.log.length - failures.length} of ${marked.log.length + cleared.log.length} checks`, ...marked.log, ...cleared.log], failures };
      },
    },
    {
      name: 'Compare runs the page\'s cells on a separate database and comes to the recorded diff',
      scenario: scenario(`
        ${UP}
        const log = [], failures = [];
        const want = await recordedExpect();
        await compareAndWait();
        expect(log, failures, 'the status is the live line', ${LIVE_LINE}.test(said.textContent) && !/With your edit/.test(said.textContent), said.textContent);
        expect(log, failures, 'the live diff is the recorded one', same(legend(), want), JSON.stringify(legend()));
        expect(log, failures, 'the table says it is from this tab', /from this tab's run$/.test(q('.gd-table caption').textContent), q('.gd-table caption').textContent);
        expect(log, failures, "the page's engine never started", !bar.dataset.status, bar.dataset.status);
        expect(log, failures, "the page's cells keep their recordings", [...document.querySelectorAll('cypher-cell')].every((x) => !x.classList.contains('is-live')));
        return { log: [said.textContent.split(',').slice(-1)[0].trim()], failures };
      `),
    },
    {
      name: 'an edit to a cell between the two shows in the next diff; Reset puts the recording back',
      scenario: scenario(`
        ${UP}
        const log = [], failures = [];
        const cells = [...document.querySelectorAll('cypher-cell')];
        const at = (id) => cells.findIndex((c) => c.dataset.cell === id);
        const between = cells[at(attrs.before) + 1];
        if (!between || at(attrs.before) + 1 >= at(attrs.after)) return { log: ['no cell between the two; nothing to edit'], failures: [] };
        // A node that the recorded diff keeps unchanged: setting a property on it must make it changed.
        const nodesOf = (rows) => { const found = []; const walk = (v) => { if (Array.isArray(v)) return v.forEach(walk); if (!v || typeof v !== 'object') return; if (v.kind === 'node') found.push(v); else Object.values(v).forEach(walk); }; walk(rows); return found; };
        const was = new Map(nodesOf((await recordedOf(attrs.before)).envelope.rows).map((n) => [JSON.stringify(n.properties[attrs.key]), JSON.stringify(n.properties)]));
        const keep = nodesOf((await recordedOf(attrs.after)).envelope.rows).filter((n) => was.get(JSON.stringify(n.properties[attrs.key])) === JSON.stringify(n.properties)).at(-1);
        if (!keep) return { log: ['no unchanged node to edit'], failures: [] };
        const key = keep.properties[attrs.key];
        const want = await recordedExpect();
        between.querySelector('[data-action=edit]').click();
        const editor = between.querySelector('.cell-editor');
        const probe = 'MATCH (n) WHERE n.' + attrs.key + ' = ' + JSON.stringify(key) + ' SET n.gd_probe = 1;\\n';
        editor.value = probe + editor.value;
        await compareAndWait();
        const got = legend();
        const changedRow = tableRows().find((r) => r.kind === 'node' && /gd_probe added: 1/.test(r.what));
        expect(log, failures, 'the edited cell ran: its node is changed', !!changedRow, JSON.stringify(tableRows().filter((r) => r.kind === 'node')));
        expect(log, failures, 'one node more is changed than recorded', got.changed[0] === want.changed[0] + 1 && got.unchanged[0] === want.unchanged[0] - 1, JSON.stringify(got) + ' vs ' + JSON.stringify(want));
        expect(log, failures, 'the status names the edit', new RegExp('With your edit to cell ' + between.dataset.cell + '\\\\.$').test(said.textContent), said.textContent);
        between.querySelector('[data-action=edit]').click(); // Revert
        bar.querySelector('[data-action=reset]').click();
        await until(() => /as recorded$/.test(q('.gd-table caption').textContent), 10000);
        expect(log, failures, "the engine bar's Reset puts the recorded diff back", same(legend(), want) && /The page was reset\\. Recorded on/.test(said.textContent), said.textContent);
        return { log: [(changedRow ? changedRow.element : 'no changed row') + ' after editing ' + between.dataset.cell], failures };
      `),
    },
  ],
} satisfies BrowserCases;
