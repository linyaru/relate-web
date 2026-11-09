// `:::row-counts`, the framework's example element (the build side, and what
// it shows, are in src/lib/docs/elements/row-counts.ts). Live: a table of the
// chosen cells' recorded rows beside the rows and milliseconds of their live
// runs (`page.onResult`, emptied on `page.onReset`), a button that counts the
// page's nodes on its database (`page.run`, which runs the cells first), and
// one that tries a write on a read-only database (`page.runReadOnly`).

import { engineMs, formatMs, liveLine, versions } from '../../../lib/docs/elements/_wording.ts';
import type { ElementContext, ElementRun } from '../element-api.ts';
// `?inline`: the styles ride in this lazy chunk and go on the page at mount
// (a plain CSS import would be hoisted into every docs page by the build).
import styles from './row-counts.css?inline';

const rowsOf = (run: { error?: string | null; rows?: unknown[] } | null | undefined) =>
  run?.error ? 'error' : Array.isArray(run?.rows) ? String(run.rows.length) : '0';

/** "1.2 ms (parse 0.3, plan <0.1, execute 0.9)": the engine's numbers from the run, never a recording's. */
function timing(run: ElementRun): string {
  const last = run.envelopes.at(-1);
  return last ? `${formatMs(engineMs(run.envelopes))} ms (parse ${formatMs(last.parse_ms)}, plan ${formatMs(last.plan_ms)}, execute ${formatMs(last.execute_ms)})` : '-';
}

export async function mount(ctx: ElementContext) {
  const { page, live, attrs } = ctx;
  ctx.adoptStyles(styles);
  const ids = attrs.cells ? attrs.cells.split(',').map((s) => s.trim()) : page.cells().map((c) => c.id);
  const cells = ids.flatMap((id) => page.cell(id) ?? []);
  const root = Object.assign(document.createElement('div'), { className: 'row-counts' });
  const table = document.createElement('table');
  table.innerHTML = '<caption>Rows per cell: recorded, and from the run in this tab</caption><thead><tr><th scope="col">Cell</th><th scope="col">Recorded</th><th scope="col">Live</th><th scope="col">Time</th><th scope="col"><span class="visually-hidden">Bar</span></th></tr></thead>';
  const body = table.createTBody();
  const rows = new Map<string, { live: HTMLElement; time: HTMLElement; bar: HTMLElement; recorded: number }>();
  for (const cell of cells) {
    const tr = body.insertRow();
    const recorded = rowsOf((await cell.recorded()).envelope as { rows?: unknown[] } | null);
    tr.innerHTML = `<th scope="row"><code></code></th><td class="num">${recorded}</td><td class="num live">-</td><td class="time">-</td><td><span class="bar"></span></td>`;
    tr.querySelector('code')!.textContent = cell.id;
    rows.set(cell.id, { live: tr.querySelector('.live')!, time: tr.querySelector('.time')!, bar: tr.querySelector('.bar')!, recorded: Number(recorded) || 0 });
  }
  const said = Object.assign(document.createElement('p'), { className: 'said' });
  said.setAttribute('role', 'status');
  const button = (label: string, aria: string) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: label });
    b.setAttribute('aria-label', aria);
    return b;
  };
  // Each accessible name starts with the button's visible text (WCAG 2.5.3, label in name).
  const count = button('Count nodes', "Count nodes in the page's database");
  const write = button('Try a read-only write', 'Try a read-only write: a CREATE on an empty read-only database');
  const actions = Object.assign(document.createElement('div'), { className: 'actions' });
  actions.append(count, write);
  root.append(table, actions, said);
  live.replaceChildren(root);

  const scale = () => Math.max(1, ...[...rows.values()].map((r) => Math.max(r.recorded, Number(r.live.textContent) || 0)));
  const offResult = page.onResult((r) => {
    const row = rows.get(r.cell.id);
    if (!row) return;
    row.live.textContent = rowsOf(r.envelopes.at(-1));
    row.time.textContent = timing(r);
    const max = scale();
    for (const x of rows.values()) x.bar.style.width = `${Math.round(((Number(x.live.textContent) || 0) / max) * 100)}%`;
  });
  const offReset = page.onReset(() => {
    for (const x of rows.values()) {
      x.live.textContent = '-';
      x.time.textContent = '-';
      x.bar.style.width = '0';
    }
    said.textContent = '';
  });
  const act = (b: HTMLButtonElement, task: () => Promise<string>) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      said.textContent = 'Running…';
      try {
        said.textContent = await task();
      } catch (err) {
        said.textContent = `Could not run: ${(err as Error).message}`;
      } finally {
        b.disabled = false;
      }
    });
  act(count, async () => {
    const run = await page.run('MATCH (n) RETURN count(n) AS nodes');
    if (run.error) return `The count failed: ${run.error}`;
    return `${liveLine({ version: versions(page).live, ms: run.envelopes[0].elapsed_ms })} ${run.envelopes[0].rows[0]?.nodes} nodes in the page's database.`;
  });
  act(write, async () => {
    const run = await page.runReadOnly("CREATE (:Probe {name: 'read-only'})");
    return run.error ? `Refused: ${run.error}` : 'The write went through, which a read-only database should refuse.';
  });
  ctx.showLive();
  return () => {
    offResult();
    offReset();
  };
}
