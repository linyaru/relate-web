// cookbook:browser cases for `:::schema-live` (src/lib/docs/elements/schema-live.ts).
// The runner opens the first built page carrying it (get-started/first-graph);
// one case goes to guides/agents/model-agent-memory for a schema with
// indexes and constraints. What the drawing shows is checked against a
// query run outside the element, through the last cell on the page (edited,
// then its own Run), never against numbers typed here.

import { scenario, type BrowserCases, type BrowserTab, type Outcome } from './_kit.ts';

/** In the page: the host live, its button and status, and a press that waits for the drawing. */
const HOST = `
  const h = await live('schema-live');
  if (!h) return { log: [], failures: ['the element did not go live'] };
  const L = h.querySelector('.element-live');
  const button = L.querySelector('button');
  const status = L.querySelector('.ls-status');
  const drawn = () => until(() => !button.disabled && /labels and \\d+ relationships\\.$|failed|Could not|no row/.test(status.textContent), 120000);
  // Whether the engine started: the page fetches the engine's worker script, and the bar records the version it reports.
  // (The kit's engineLoaded() looks for the wasm files, which the worker fetches on its own timeline, so the page never sees them.)
  const engineUp = () => !!document.getElementById('engineBar')?.dataset.engineVersion || performance.getEntriesByType('resource').some((e) => /\\/_astro\\/worker-[\\w-]+\\.js/.test(e.name));
  const nodes = () => [...L.querySelectorAll('.ls-art g.node')];
  const labelsDrawn = () => nodes().map((g) => g.querySelector('text').textContent);
  const typesDrawn = () => [...new Set([...L.querySelectorAll('.ls-art text.type')].map((t) => t.textContent))].sort();
  /** The labels and relationship types in the database, from the last cell's own Run with its code replaced (the cell runs the cells before it first). */
  const asked = async () => {
    const c = [...document.querySelectorAll('cypher-cell:not([data-expect-error])')].pop();
    c.querySelector('[data-action=edit]').click();
    const ed = c.querySelector('.cell-editor');
    ed.value = "MATCH (n) UNWIND labels(n) AS name RETURN DISTINCT 'label' AS kind, name UNION MATCH ()-[r]->() RETURN DISTINCT 'type' AS kind, type(r) AS name";
    // Blank the label first: a cell that already ran says Live before this run starts.
    c.querySelector('.out-label').textContent = '';
    c.querySelector('[data-action=run]').click();
    await until(() => c.classList.contains('is-live') && !c.classList.contains('is-running') && /Live/.test(c.querySelector('.out-label').textContent), 60000);
    const head = [...c.querySelectorAll('.out-table thead th')].map((th) => th.textContent.trim());
    const rows = [...c.querySelectorAll('.out-table tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim().replace(/^"|"$/g, '')));
    const of = (kind) => rows.filter((r) => r[head.indexOf('kind')] === kind).map((r) => r[head.indexOf('name')]).sort();
    return { labels: of('label'), types: of('type'), said: c.dataset.cell + ': ' + c.querySelector('.out-label').textContent + ' [' + head.join('|') + '] ' + rows.length + ' rows' };
  };
`;

export default {
  element: 'schema-live',
  cases: [
    {
      name: 'draws the labels the database reports once the cells run',
      scenario: scenario(`
        const log = [], failures = [];
        ${HOST}
        expect(log, failures, 'nothing runs before the button', !engineUp() && nodes().length === 0);
        button.click();
        await drawn();
        expect(log, failures, 'the procedure ran on the engine', engineUp() && /^From this tab's run of CALL db\\.schema\\.visualization\\(\\) on relate [\\d.]+/.test(status.textContent), status.textContent);
        const said = Number((/ (\\d+) labels and/.exec(status.textContent) || [])[1]);
        const rows = L.querySelectorAll('.ls-scroll tbody tr').length;
        expect(log, failures, 'one circle and one table row per label', said > 0 && nodes().length === said && rows === said, nodes().length + ' circles, ' + rows + ' rows, ' + said + ' reported');
        // The cells up to \`cell\` (all without it) ran first, and no other.
        const upTo = JSON.parse(h.dataset.attrs || '{}').cell;
        const cells = [...document.querySelectorAll('cypher-cell:not([data-expect-error])')];
        const last = upTo ? cells.findIndex((c) => c.dataset.cell === upTo) : cells.length - 1;
        const ran = cells.map((c) => c.classList.contains('is-live'));
        expect(log, failures, 'the cells up to ' + (upTo || 'the last') + ' ran first, and no later one', ran.every((r, i) => r === (i <= last)), cells.filter((c, i) => ran[i]).map((c) => c.dataset.cell).join(', '));
        // The figure the element sits under: its labels keep their colours in the live drawing.
        const fig = [...document.querySelectorAll('figure.diagram')].filter((f) => f.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
        const figLabels = fig ? [...fig.querySelector('svg').querySelectorAll('g.node')].map((g) => [g.querySelector('text').textContent, g.querySelector('circle').getAttribute('fill')]) : [];
        const same = figLabels.filter(([l, fill]) => { const n = nodes().find((g) => g.querySelector('text').textContent === l); return n && n.querySelector('circle').getAttribute('fill') === fill; });
        expect(log, failures, "each label the figure draws has the figure's colour", figLabels.length > 0 && same.length === figLabels.length, same.length + ' of ' + figLabels.length);
        expect(log, failures, 'it says how the database compares with the figure', !L.querySelector('.ls-diff').hidden && L.querySelector('.ls-diff').textContent.length > 20);
        const drawnLabels = labelsDrawn().sort(), drawnTypes = typesDrawn();
        const db = await asked();
        expect(log, failures, 'the labels drawn are the labels a separate query finds', db.labels.length > 0 && db.labels.join() === drawnLabels.join(), db.labels.join(',') + ' vs ' + drawnLabels.join(',') + ' (' + db.said + ')');
        expect(log, failures, 'the relationship types drawn are the types a separate query finds', db.types.join() === drawnTypes.join(), db.types.join(',') + ' vs ' + drawnTypes.join(','));
        return { log: [said + ' labels: ' + labelsDrawn().join(', ') + '; ' + L.querySelector('.ls-diff').textContent], failures };
      `),
    },
    {
      name: 'Space on the focused button draws; Reset clears; drawing again runs the cells again',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const ready = await tab.evaluate<Outcome>(scenario(`${HOST} button.focus(); return { log: [], failures: document.activeElement === button ? [] : ['the button does not take focus'] };`));
        if (ready.failures.length) return ready;
        // A real key press: the space bar activates a focused button on key up.
        await tab.press(' ', 'Space', 32);
        return tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            ${HOST}
            await until(() => button.disabled || nodes().length, 5000);
            await drawn();
            const first = nodes().length;
            expect(log, failures, 'the space bar draws it', first > 0, status.textContent);
            const bar = document.getElementById('engineBar');
            bar.querySelector('[data-action=reset]').click();
            await until(() => /Reset/.test(status.textContent), 15000);
            expect(log, failures, 'Reset clears the drawing', nodes().length === 0 && L.querySelector('.ls-figure').hidden);
            button.click();
            await drawn();
            expect(log, failures, 'drawing again after Reset gives the same labels', nodes().length === first, nodes().length + ' vs ' + first);
            return { log: [first + ' labels, cleared, ' + nodes().length + ' again'], failures };
          `),
        );
      },
    },
    {
      name: 'a schema with indexes and constraints lists them per label',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await tab.navigate('/docs/guides/agents/model-agent-memory/');
        return tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            ${HOST}
            button.click();
            await drawn();
            const rows = [...L.querySelectorAll('.ls-scroll tbody tr')].map((r) => [...r.children].map((c) => c.textContent));
            const said = Number((/ (\\d+) labels and/.exec(status.textContent) || [])[1]);
            expect(log, failures, 'one circle per label the engine reports', said > 0 && nodes().length === said, nodes().length + ' of ' + said);
            const constrained = rows.filter((r) => r[2] !== 'none');
            expect(log, failures, 'constraints are listed by name', constrained.length > 0 && constrained.every((r) => /: type='/.test(r[2])), constrained.map((r) => r[0]).join(', '));
            expect(log, failures, 'indexes are listed by property', rows.some((r) => r[1] !== 'none'), rows.map((r) => r[0] + ':' + r[1]).join('; '));
            const drawnLabels = labelsDrawn().sort(), drawnTypes = typesDrawn();
            const db = await asked();
            expect(log, failures, 'the labels and types drawn are those a separate query finds', db.labels.join() === drawnLabels.join() && db.types.join() === drawnTypes.join(), db.labels.join(',') + ' / ' + db.types.join(',') + ' (' + db.said + ')');
            const svg = L.querySelector('.ls-art svg');
            expect(log, failures, 'the drawing is labelled', !!svg && svg.getAttribute('role') === 'img' && !!svg.querySelector('title')?.textContent);
            return { log: [said + ' labels; constrained: ' + constrained.map((r) => r[0]).join(', ') + '; ' + L.querySelector('.ls-diff').textContent], failures };
          `),
        );
      },
    },
  ],
} satisfies BrowserCases;
