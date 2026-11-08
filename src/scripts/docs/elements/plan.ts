// `:::plan`, the query plan viewer (the build side and its static form are
// in src/lib/docs/elements/plan.ts). Live, it draws the bound cell's plan as
// an indented tree, recorded first and then from this tab's runs:
//   - EXPLAIN / PROFILE: PROFILE runs the statement on the page's database
//     (after the cells before it) and adds each operator's rows, own time
//     and database hits as bars on one scale across the panes shown;
//   - the index toggle creates the index (the `index` attribute, or the
//     remedy of the plan's 03C91 notification) on the page's database, plans
//     the statement without and with it side by side with what changed, and
//     drops it again when pressed off (an index a cell created stays: the
//     viewer drops only what it made);
//   - each notification with its remedy, its code linked to the errors
//     reference; the plan as the CLI's text table on request; and a PROFILE
//     as a speedscope file, the bytes `relate --mode speedscope` writes.
// Numbers are the engine's, from the run that produced them; the source line
// says whether a pane is the recording or this tab's run.

import type { ElementContext, ElementRun } from '../element-api.ts';
import {
  deltas,
  indexName,
  missingIndex,
  neverExecuted,
  noteHref,
  planText,
  preOrder,
  speedscope,
  splitStatement,
  summarize,
  WRITE_OPERATORS,
  type PlacedOp,
  type PlanDoc,
  type PlanNote,
} from '../../../lib/docs/elements/_plan-model.ts';
import { engineMs, formatMs, liveLine, recordedLine, versions } from '../../../lib/docs/elements/_wording.ts';
// `?inline`: the styles ride in this lazy chunk (a plain import would be hoisted into every docs page).
import styles from './plan.css?inline';

type Mode = 'EXPLAIN' | 'PROFILE';

interface Pane {
  title: string;
  plan: PlanDoc;
  notes: PlanNote[];
  /** Where the plan came from, for the reader: the recording, or this tab's run with its elapsed time. */
  source: string;
  /** The export file's name suffix. */
  slug: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...kids: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
};

const button = (label: string, aria: string) => {
  const b = el('button', { type: 'button', className: 'btn', textContent: label });
  b.setAttribute('aria-label', aria);
  return b;
};

/** Text with `backtick` spans as code (the notification remedies write statements that way). */
function withCode(text: string): (Node | string)[] {
  return text.split(/(`[^`]+`)/).map((part) => (part.startsWith('`') && part.endsWith('`') && part.length > 2 ? el('code', { textContent: part.slice(1, -1) }) : part));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function mount(ctx: ElementContext) {
  const { page, attrs, live } = ctx;
  ctx.adoptStyles(styles);
  const cell = page.cell(attrs.cell);
  if (!cell) throw new Error(`:::plan names cell \`${attrs.cell}\`, which is not on the page`);
  const compareCell = attrs.compare ? page.cell(attrs.compare) : null;

  const recordedSource = () => recordedLine(versions(page).recorded).replace(/^Recorded/, 'recorded').replace(/\.$/, '');
  const recordedPane = async (id: string, title: string): Promise<Pane | null> => {
    const env = (await page.cell(id)?.recorded())?.envelope as { plan?: PlanDoc | null; notifications?: PlanNote[] } | null;
    return env?.plan ? { title, plan: env.plan, notes: env.notifications ?? [], source: recordedSource(), slug: id } : null;
  };
  // The index the comparison is about: the `index` attribute, or the remedy of the bound cell's recorded 03C91 notification.
  const firstNotes = ((await cell.recorded()).envelope as { notifications?: PlanNote[] } | null)?.notifications ?? [];
  const indexStatement = attrs.index ?? missingIndex(firstNotes);
  const index = indexStatement ? indexName(indexStatement) : null;
  // Pane titles say what the two plans differ by, the way the page's prose does, not the cells' ids.
  const WITHOUT = 'Without the index';
  const WITH = index ? `With ${index}` : 'With the index';
  const titles: [string, string] = compareCell ? (index ? [WITHOUT, WITH] : [`Cell ${cell.id}`, `Cell ${compareCell.id}`]) : ['The plan', 'The plan'];
  const recordings = async () =>
    [await recordedPane(cell.id, titles[0]), compareCell ? await recordedPane(compareCell.id, titles[1]) : null].filter((p): p is Pane => !!p);

  let panes = await recordings();
  if (!panes.length) throw new Error(`:::plan: cell \`${cell.id}\` has no recorded plan`);
  let mode: Mode = 'EXPLAIN';
  /** The comparison is on: the index stays on the page's database until Drop or Reset, whatever cells run meanwhile. */
  let indexOn = false;
  /** The viewer itself created the index on the page's database (not a cell), so Drop may remove it. */
  let created = false;
  let asText = false;
  const urls: string[] = [];

  // ---- the frame
  const root = el('div', { className: 'plan-viewer' });
  const controls = el('div', { className: 'plan-controls' });
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Plan viewer controls');
  const explainB = button('EXPLAIN', 'EXPLAIN: plan the statement without running it');
  const profileB = button('PROFILE', "PROFILE: run the statement on the page's database and measure each operator");
  const modes = el('div', { className: 'plan-modes' }, explainB, profileB);
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Plan kind');
  const indexB = index ? button('Compare with the index', `Compare with the index: create ${index} on the page's database and plan with and without it`) : null;
  const textB = button('Plan as text', "Plan as text: the table relate --mode table prints");
  controls.append(modes, ...(indexB ? [indexB] : []), textB);
  const status = el('p', { className: 'plan-status' });
  status.setAttribute('role', 'status');
  const panesBox = el('div', { className: 'plan-panes' });
  const changes = el('div', { className: 'plan-changes' });
  const notesBox = el('div', { className: 'plan-notes' });
  root.append(controls, status, panesBox, changes, notesBox);
  live.replaceChildren(root);

  // ---- drawing
  /** The largest value of a measure over every pane, so bars compare across panes. */
  const scale = (pick: (p: PlacedOp) => number | undefined) =>
    Math.max(0, ...panes.flatMap((pane) => preOrder(pane.plan.root).map((p) => (p.op.actual && !neverExecuted(p) ? (pick(p) ?? 0) : 0))));

  function metricRow(label: string, value: number, max: number, text: string): HTMLElement {
    const bar = el('span', { className: 'plan-bar' });
    bar.style.width = `${max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0}%`;
    bar.setAttribute('aria-hidden', 'true');
    return el('div', { className: 'plan-metric' }, el('dt', { textContent: label }), el('dd', {}, el('span', { className: 'plan-track' }, bar), el('span', { className: 'plan-num', textContent: text })));
  }

  function opItem(p: PlacedOp, kids: Map<PlacedOp, PlacedOp[]>, max: { rows: number; time: number; hits: number }): HTMLLIElement {
    const { op } = p;
    const head = el('div', { className: 'plan-op-head' }, el('span', { className: 'plan-op-name', textContent: op.operator }), el('span', { className: 'plan-op-id', textContent: `Id ${p.id}` }));
    if (op.estimated_rows !== null && op.estimated_rows !== undefined) head.append(el('span', { className: 'plan-op-est', textContent: `estimated ${plural(op.estimated_rows, 'row')}` }));
    const row = el('div', { className: 'plan-op' }, head);
    if (op.details) row.append(el('code', { className: 'plan-op-details', textContent: op.details }));
    // The engine files these notifications under the operator, but their severity is its own (the three plan warnings are INFORMATION).
    // The word is the channel; the colour follows it, and only a WARNING or an ERROR takes --danger.
    for (const w of op.warnings ?? []) {
      const severity = w.severity ? `${w.severity.charAt(0)}${w.severity.slice(1).toLowerCase()}` : 'Notification';
      const level = /^(WARNING|ERROR)$/i.test(w.severity ?? '') ? 'is-warning' : 'is-information';
      row.append(el('p', { className: `plan-op-warn ${level}`, textContent: `${severity} ${w.gql_status}, ${w.title}` }));
    }
    if (op.actual) {
      const a = op.actual;
      if (neverExecuted(p)) row.append(el('p', { className: 'plan-op-never', textContent: 'Never executed: its input produced no rows.' }));
      else {
        const dl = el('dl', { className: 'plan-metrics' });
        dl.append(
          metricRow('Rows', a.rows ?? 0, max.rows, String(a.rows ?? 0)),
          metricRow('Time', a.time_ms ?? 0, max.time, `${formatMs(a.time_ms)} ms`),
          metricRow('Database hits', a.db_hits ?? 0, max.hits, String(a.db_hits ?? 0)),
        );
        row.append(dl);
      }
    } else if (panes.some((x) => x.plan.profiled)) {
      row.append(el('p', { className: 'plan-op-never', textContent: 'No measures: the engine recorded none for this operator.' }));
    }
    const li = el('li', {}, row);
    const children = kids.get(p) ?? [];
    if (children.length) li.append(el('ol', { className: 'plan-tree' }, ...children.map((c) => opItem(c, kids, max))));
    return li;
  }

  function tree(plan: PlanDoc, max: { rows: number; time: number; hits: number }): HTMLElement {
    const placed = preOrder(plan.root);
    // Parent of each operator: the nearest earlier one a level up (pre-order).
    const kids = new Map<PlacedOp, PlacedOp[]>();
    const stack: PlacedOp[] = [];
    for (const p of placed) {
      while (stack.length > p.depth) stack.pop();
      if (stack.length) kids.set(stack.at(-1)!, [...(kids.get(stack.at(-1)!) ?? []), p]);
      stack.push(p);
    }
    return el('ol', { className: 'plan-tree plan-root' }, opItem(placed[0], kids, max));
  }

  function exportLink(pane: Pane): HTMLElement | null {
    if (!pane.plan.profiled) return null;
    try {
      const text = speedscope(pane.plan, page.engine()?.version ?? 'unknown');
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      urls.push(url);
      const slug = location.pathname.replace(/^\/docs\/|\/$/g, '').replace(/\//g, '-') || 'docs';
      const a = el('a', { className: 'plan-export', href: url, textContent: 'Download the profile for speedscope' });
      a.download = `${slug}-${ctx.id}-${pane.slug}.speedscope.json`;
      a.setAttribute('aria-label', `Download the profile for speedscope: ${pane.title}, as relate --mode speedscope writes it`);
      // The file spans the top operator's own time. Under the browser's 0.1 ms timer step that is often 0, and speedscope then
      // draws nothing; the reader is told why rather than handed what looks like a broken file.
      if (Math.round((pane.plan.root.actual?.time_ms ?? 0) * 1e6) === 0) {
        return el(
          'div',
          { className: 'plan-export-box' },
          a,
          el('p', {
            className: 'plan-export-note',
            textContent: `Every interval in this file is 0 ns: the file spans the top operator's own time, which is under the browser timer's 0.1 ms step. relate --mode speedscope writes the same file for these measures.`,
          }),
        );
      }
      return a;
    } catch (err) {
      return el('p', { className: 'plan-export-refused', textContent: `No speedscope file: ${(err as Error).message}. The CLI refuses this profile the same way.` });
    }
  }

  function draw() {
    for (const u of urls.splice(0)) URL.revokeObjectURL(u);
    explainB.setAttribute('aria-pressed', String(mode === 'EXPLAIN'));
    profileB.setAttribute('aria-pressed', String(mode === 'PROFILE'));
    textB.setAttribute('aria-pressed', String(asText));
    if (indexB) {
      indexB.setAttribute('aria-pressed', String(indexOn));
      indexB.textContent = indexOn ? 'Drop the index' : 'Compare with the index';
      indexB.setAttribute('aria-label', indexOn ? `Drop the index: remove ${index} from the page's database` : `Compare with the index: create ${index} on the page's database and plan with and without it`);
    }
    const writes = panes.some((pane) => preOrder(pane.plan.root).some((p) => WRITE_OPERATORS.has(p.op.operator)));
    profileB.disabled = writes;
    profileB.title = writes ? 'PROFILE runs the statement, and this one writes; EXPLAIN only plans it' : '';
    const max = { rows: scale((p) => p.op.actual?.rows), time: scale((p) => p.op.actual?.time_ms), hits: scale((p) => p.op.actual?.db_hits) };
    panesBox.dataset.count = String(panes.length);
    panesBox.replaceChildren(
      ...panes.map((pane) => {
        const section = el('section', { className: 'plan-pane' });
        section.setAttribute('aria-label', pane.title);
        section.append(
          el('h4', { className: 'plan-pane-title', textContent: pane.title }),
          el('p', { className: 'plan-pane-source', textContent: `${pane.plan.profiled ? 'PROFILE' : 'EXPLAIN'}, ${pane.source}` }),
          asText ? el('pre', { className: 'plan-text' }, el('code', { textContent: planText(pane.plan, pane.notes) })) : tree(pane.plan, max),
        );
        const link = exportLink(pane);
        if (link) section.append(link);
        return section;
      }),
    );
    // What changed, when two plans of the statement show side by side.
    changes.replaceChildren();
    if (panes.length === 2) {
      const rows = deltas(summarize(panes[0].plan, panes[0].notes), summarize(panes[1].plan, panes[1].notes));
      const table = el('table');
      const what = `What changed from ${panes[0].title.charAt(0).toLowerCase()}${panes[0].title.slice(1)} to ${panes[1].title.charAt(0).toLowerCase()}${panes[1].title.slice(1)}`;
      // The caption stays for assistive technology; the visible title sits outside the scroll box, so it wraps at any width.
      table.append(el('caption', { className: 'visually-hidden', textContent: what }));
      const head = table.createTHead().insertRow();
      for (const h of ['Measure', panes[0].title, panes[1].title, 'Change']) head.append(el('th', { scope: 'col', textContent: h }));
      const body = table.createTBody();
      for (const r of rows) {
        const tr = body.insertRow();
        tr.append(el('th', { scope: 'row', textContent: r.measure }), el('td', { textContent: r.before }), el('td', { textContent: r.after }), el('td', { textContent: r.change }));
      }
      // On a narrow column the table scrolls inside its own box rather than breaking words letter by letter.
      const scroller = el('div', { className: 'plan-changes-scroll' }, table);
      scroller.tabIndex = 0;
      scroller.setAttribute('role', 'region');
      scroller.setAttribute('aria-label', 'What changed, scrollable');
      changes.append(el('p', { className: 'plan-changes-title', textContent: what }), scroller);
    }
    // Notifications: each with its remedy, its code linked to the reference.
    notesBox.replaceChildren(
      ...panes.map((pane) => {
        const label = panes.length > 1 ? `Notifications, ${pane.title.charAt(0).toLowerCase()}${pane.title.slice(1)}` : 'Notifications';
        if (!pane.notes.length) return el('p', { className: 'plan-notes-none', textContent: `${label}: none.` });
        const list = el('ul');
        for (const n of pane.notes) {
          const where = n.operator_id === null || n.operator_id === undefined ? '' : ` on operator ${n.operator_id}`;
          list.append(
            el(
              'li',
              {},
              el('a', { href: noteHref(n.gql_status) }, el('code', { textContent: n.gql_status }), ` ${n.title}`),
              ` (${n.severity.toLowerCase()})${where}: ${n.description}. `,
              el('span', { className: 'plan-remedy-label', textContent: 'Remedy: ' }),
              ...withCode(n.gql_status === '03C91' ? `\`${n.remedy}\`` : n.remedy),
            ),
          );
        }
        return el('div', {}, el('h4', { className: 'plan-notes-title', textContent: label }), list);
      }),
    );
  }

  // ---- running
  const controlsAll = [explainB, profileB, textB, ...(indexB ? [indexB] : [])];
  const statement = () => splitStatement(cell.code()) ?? { version: '', mode: 'EXPLAIN' as Mode, body: cell.code().trim().replace(/;\s*$/, '') };
  const planned = (m: Mode) => `${statement().version}${m} ${statement().body}`;
  /** "from this tab's run on relate 0.16.1, 0.3 ms in the engine": the planned statement's own time. */
  const source = (run: ElementRun, at = -1) => liveLine({ version: versions(page).live, ms: run.envelopes.at(at)?.elapsed_ms }).replace(/^From/, 'from').replace(/\.$/, '');
  /** The pane of the plan in `run`'s envelope `at` (the last, unless a statement follows the planned one). */
  const paneOf = (run: ElementRun, title: string, slug: string, at = -1): Pane => {
    const last = run.envelopes.at(at)!;
    if (!last.plan) throw new Error('the engine returned no plan');
    return { title, plan: last.plan as unknown as PlanDoc, notes: (last.notifications ?? []) as unknown as PlanNote[], source: source(run, at), slug };
  };
  const run = (code: string) => page.run(code, cell.params(), { upTo: cell.id });
  /**
   * A cell's pane title on a viewer that compares around an index: what the
   * database held when the cell planned, in the engine's words. The plan
   * carries the 03C91 notification for this index exactly when the index is
   * missing, so a reader who ran the cells in another order, or ran a cell
   * while the comparison holds the index, still reads a true title.
   */
  const cellTitle = (notes: PlanNote[], at: number) => {
    if (!compareCell || !index) return titles[at];
    return notes.some((n) => n.gql_status === '03C91' && indexName(n.remedy) === index) ? WITHOUT : WITH;
  };

  // While the viewer runs, the cells it runs first (upTo) report their own
  // results; those must not take over its panes or its mode mid-run.
  let acting = false;
  /**
   * Run `task` with the controls marked unavailable; the status line says how
   * it went. aria-disabled, not `disabled`: a disabled button loses focus,
   * and a keyboard reader would land on <body> after every run. The click
   * handlers ignore a press while `acting`.
   */
  async function act(task: () => Promise<string>) {
    if (acting) return;
    acting = true;
    for (const b of controlsAll) b.setAttribute('aria-disabled', 'true');
    status.textContent = 'Running…';
    try {
      status.textContent = await task();
    } catch (err) {
      status.textContent = `Could not run: ${(err as Error).message}`;
    } finally {
      acting = false;
      for (const b of controlsAll) b.removeAttribute('aria-disabled');
      draw();
    }
  }

  async function single(): Promise<string> {
    const r = await run(planned(mode));
    if (r.error) return `The engine refused the statement: ${r.error}`;
    panes = [paneOf(r, 'The plan', mode.toLowerCase())];
    return `${liveLine({ version: versions(page).live, ms: r.envelopes.at(-1)?.elapsed_ms })} ${mode}: ${plural(preOrder(panes[0].plan.root).length, 'operator')}, ${plural(panes[0].notes.length, 'notification')}.`;
  }

  /**
   * The plan without and with the index, side by side. `keep`: leave the
   * index on the page's database (the Compare button). Without it (EXPLAIN
   * or PROFILE pressed on a page whose viewer compares two plans) the
   * database ends as it started: an index the viewer created is dropped
   * again in the same run.
   */
  async function compare(keep = true): Promise<string> {
    const shown = await run('SHOW INDEXES YIELD name RETURN name');
    if (shown.error) return `Could not list the indexes: ${shown.error}`;
    const existed = shown.envelopes[0].rows.some((r) => r.name === index);
    const before = await run(existed ? `DROP INDEX ${index}; ${planned(mode)}` : planned(mode));
    if (before.error) return `The engine refused the statement: ${before.error}`;
    const restore = !keep && !existed;
    const after = await run(`${indexStatement}; ${planned(mode)}${restore ? `; DROP INDEX ${index}` : ''}`);
    if (after.error) {
      panes = [paneOf(before, WITHOUT, 'without-index')];
      return `Could not create the index: ${after.error}`;
    }
    panes = [paneOf(before, WITHOUT, 'without-index'), paneOf(after, WITH, 'with-index', restore ? -2 : -1)];
    if (keep) {
      indexOn = true;
      // An index a cell created stays the cell's, even though the viewer dropped and recreated it to plan without it.
      created = created || !existed;
    }
    const [b, a] = panes.map((p) => summarize(p.plan, p.notes));
    const how = b.operators.join(', ') === a.operators.join(', ') ? 'the plan did not change' : `${b.operators.at(-1)} became ${a.operators.at(-1)}`;
    const said = liveLine({ version: versions(page).live, ms: engineMs([before.envelopes.at(-1)!, after.envelopes.at(restore ? -2 : -1)!]) });
    if (!keep) {
      const was = created ? ` The viewer's comparison created ${index} and holds it.` : ` ${index} was on the page's database already (a cell created it), and is again.`;
      return `${said} ${mode} without and with ${index}: ${how}.${restore ? ` The viewer dropped ${index} again, so the page's database is as it was.` : was}`;
    }
    const cellMade = existed && !created;
    const then = cellMade ? ' Press Drop the index to end the comparison; the index stays, because a cell created it.' : ' Press Drop the index to remove it, or Reset.';
    return `${said} ${cellMade ? `${index} was on the page's database already (a cell created it); the viewer dropped it to plan without it, then created it again. ` : ''}With ${index} on the page's database, ${how}.${then}`;
  }

  /** End the comparison: drop the index when the viewer created it; an index a cell created stays on the page's database. */
  async function drop(): Promise<string> {
    if (!created) {
      const r = await run(planned(mode));
      if (r.error) return `The engine refused the statement: ${r.error}`;
      indexOn = false;
      panes = [paneOf(r, compareCell ? cellTitle((r.envelopes.at(-1)?.notifications ?? []) as unknown as PlanNote[], 0) : 'The plan', mode.toLowerCase())];
      return `${liveLine({ version: versions(page).live, ms: r.envelopes.at(-1)?.elapsed_ms })} The comparison is over. ${index} stays on the page's database, because a cell on the page created it; the plan is planned with it.`;
    }
    const r = await run(`DROP INDEX ${index} IF EXISTS; ${planned(mode)}`);
    if (r.error) return `Could not drop the index: ${r.error}`;
    indexOn = false;
    created = false;
    panes = [paneOf(r, WITHOUT, 'without-index')];
    return `${liveLine({ version: versions(page).live, ms: r.envelopes.at(-1)?.elapsed_ms })} Dropped ${index} from the page's database; the plan is planned without it.`;
  }

  // A viewer that compares two plans keeps comparing: EXPLAIN and PROFILE plan the statement without and with the index.
  const replan = () => act(() => (indexOn ? compare() : compareCell && index ? compare(false) : single()));
  explainB.addEventListener('click', () => {
    if (acting) return;
    mode = 'EXPLAIN';
    void replan();
  });
  profileB.addEventListener('click', () => {
    if (acting) return;
    mode = 'PROFILE';
    void replan();
  });
  indexB?.addEventListener('click', () => void act(() => (indexOn ? drop() : compare())));
  textB.addEventListener('click', () => {
    if (acting) return;
    asText = !asText;
    draw();
  });

  // A run of the bound cell (or the compare cell) is a plan too: it takes that cell's pane.
  const [recordedBefore, recordedAfter] = panes;
  const holding = () => (indexOn && created ? ` The viewer's comparison still holds ${index} on the page's database: press Drop the index, or Reset.` : '');
  const offResult = page.onResult((r) => {
    if (acting) return;
    // A cell that creates the index the comparison holds fails with IndexAlreadyExists; say whose index it is.
    if (index && indexOn && created && r.error && /IndexAlreadyExists/i.test(r.error) && r.cell.code().includes(index)) {
      status.textContent = `Cell ${r.cell.id} could not create ${index}: the viewer's comparison created it on the page's database. Press Drop the index, then run the cell again, or Reset.`;
      return;
    }
    const at = r.cell.id === cell.id ? 0 : compareCell && r.cell.id === compareCell.id ? 1 : -1;
    if (at < 0 || !r.envelopes.at(-1)?.plan) return;
    const title = cellTitle((r.envelopes.at(-1)?.notifications ?? []) as unknown as PlanNote[], at);
    const pane = paneOf(r, title, r.cell.id);
    // Around an index, the two panes are slots for what the database held: a cell's plan takes the slot its
    // title names, so the other pane (recorded, or from the comparison) still shows the other state. The
    // comparison itself (indexOn, and the index on the page's database) stays until Drop or Reset.
    const base = panes.length === 2 ? panes : [recordedBefore, recordedAfter];
    const slot = compareCell && index ? (title === WITHOUT ? 0 : 1) : at;
    panes = (compareCell ? (slot === 0 ? [pane, base[1] ?? recordedAfter] : [base[0] ?? recordedBefore, pane]) : [pane]).filter((p): p is Pane => !!p);
    mode = pane.plan.profiled ? 'PROFILE' : 'EXPLAIN';
    status.textContent = `${liveLine({ version: versions(page).live, ms: r.envelopes.at(-1)?.elapsed_ms, of: `cell ${r.cell.id}` })}${holding()}`;
    draw();
  });
  const offReset = page.onReset(async () => {
    panes = await recordings();
    mode = 'EXPLAIN';
    indexOn = false;
    created = false;
    status.textContent = `The page's database was reset. ${recordedLine(versions(page).recorded)}`;
    draw();
  });

  status.textContent = `${recordedLine(versions(page).recorded)} Nothing has run in this tab yet.`;
  draw();
  ctx.showLive();
  return () => {
    offResult();
    offReset();
    for (const u of urls.splice(0)) URL.revokeObjectURL(u);
  };
}
