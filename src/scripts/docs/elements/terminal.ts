// `:::terminal`, the agent-mode terminal (the build side, and what it shows
// without JavaScript, are in src/lib/docs/elements/terminal.ts). Live: one
// statement, editable or picked from presets, runs on an empty read-only
// database in the page's engine (`page.runReadOnly`, the database
// `relate --read-only` opens), and the pane prints what the relate CLI
// would: the table, the envelope, JSON Lines or TOON, the stderr lines, and
// the exit code. The CLI's bytes come from _terminal-render.ts, proven
// against the binary by src/lib/docs/terminal.test.ts; what only the CLI
// decides (the exit code, the error class, the harness row cap) comes from
// the recorded facts, labelled with the relate version they were recorded
// with. Until the reader runs something, the pane shows the cell's recording.
//
// A run's output can be far larger than a page can draw (relate prints
// 200,000 rows if asked): the pane draws the first MAX_LINES lines, and the
// first MAX_CHARS characters of a line, then says what it left out; the exit
// line and data-lines keep the true counts.

import facts from '../../../lib/docs/elements/_terminal-facts.json' with { type: 'json' };
import {
  commandLine,
  MODES,
  readEnvelope,
  recordedEnvelopeText,
  renderRun,
  splitStatements,
  type Envelope,
  type Mode,
  type RunOutput,
  type TerminalFacts,
} from '../../../lib/docs/elements/_terminal-render.ts';
import { engineMs, formatMs, liveLine, recordedLine, versions } from '../../../lib/docs/elements/_wording.ts';
import type { ElementContext } from '../element-api.ts';
// `?inline`: the styles ride in this lazy chunk (a plain import would be hoisted into every docs page).
import styles from './terminal.css?inline';

const FACTS = facts as TerminalFacts;

/** The most output lines the pane draws; relate prints them all. */
const MAX_LINES = 500;
/** The most characters of one line the pane draws (an envelope is one line however many rows it holds). */
const MAX_CHARS = 20_000;

const plural = (n: number, noun: string) => `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;

/** The presets: each is one of the statements src/lib/docs/elements/_terminal-record.ts records with the binary. */
const PRESETS: { label: string; statement: string }[] = [
  { label: `250 rows (the row cap under a harness)`, statement: 'UNWIND range(1, 250) AS x RETURN x' },
  { label: 'A syntax error', statement: 'MATCH (n RETURN n' },
  { label: 'A missing parameter', statement: 'MATCH (p:Person {name: $name}) RETURN p.role AS role' },
  { label: 'A write, refused read-only', statement: "CREATE (:Person {name: 'Bo'})" },
  { label: 'Several statements, one fails', statement: 'RETURN 1 AS a; RETRN 2; RETURN 3 AS c' },
];

const LABELS: Record<Mode, string> = { table: 'table', envelope: 'envelope', jsonl: 'jsonl', toon: 'toon' };

// Props are a plain record: a mapped Partial<HTMLElementTagNameMap[K]> across
// nested calls is a union too large for tsc to represent.
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
};


/**
 * What the pane draws from: a run's envelopes, parsed once, where they came
 * from, and the statement; `head` opens the status line (the shared wording)
 * and `tail` closes it. Each mode and cap is rendered once and kept.
 */
interface Shown {
  statement: string;
  envelopes: Envelope[];
  source: 'recorded' | 'live';
  head: string;
  tail: string;
  renders: Map<string, RunOutput>;
}

const shownFrom = (statement: string, texts: string[], source: Shown['source'], head: string, tail: string): Shown => ({
  statement,
  envelopes: texts.map(readEnvelope),
  source,
  head,
  tail,
  renders: new Map(),
});

/** What relate prints for `s` in `mode` with `cap`, rendered once per mode and cap. */
function view(s: Shown, mode: Mode, cap: number | null): RunOutput {
  const key = `${mode}|${cap}`;
  let out = s.renders.get(key);
  if (!out) {
    out = renderRun({ envelopes: s.envelopes, statements: splitStatements(s.statement).length, mode, cap }, FACTS);
    s.renders.set(key, out);
  }
  return out;
}

export async function mount(ctx: ElementContext) {
  const { page, live, attrs, id } = ctx;
  ctx.adoptStyles(styles);
  let gone = false;
  const cell = page.cell(attrs.cell ?? '');
  // The statement as authored, which the recording belongs to, not what a reader may have typed
  // into the cell before the terminal came into reach.
  const own = (cell?.authoredCode() ?? '').trim();
  let mode: Mode = (MODES as readonly string[]).includes(attrs.mode) ? (attrs.mode as Mode) : 'envelope';
  let harness = attrs.harness === 'on';

  // ---- the controls
  const pick = el('select', { id: `${id}-preset` });
  pick.append(el('option', { value: 'page', textContent: "This page's statement" }));
  for (const [i, p] of PRESETS.entries()) pick.append(el('option', { value: String(i), textContent: p.label }));
  pick.append(el('option', { value: 'edited', textContent: 'Your statement', disabled: true }));
  const input = el('textarea', { id: `${id}-input`, rows: 2, spellcheck: false, value: own });
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('aria-describedby', `${id}-hint`);
  const run = el('button', { type: 'button', className: 'btn primary term-run', textContent: 'Run' });
  run.setAttribute('aria-label', 'Run the statement on an empty read-only database in this tab');
  const toggle = el('input', { type: 'checkbox', checked: harness });
  const harnessLabel = el('label', { className: 'term-harness' }, toggle, 'Run as an agent harness ', el('code', { textContent: `${FACTS.harnessVariable}=1` }));
  const hint = el('span', { className: 'term-hint', id: `${id}-hint` }, el('kbd', { textContent: 'Ctrl' }), '+', el('kbd', { textContent: 'Enter' }), ' or ', el('kbd', { textContent: '⌘' }), '+', el('kbd', { textContent: 'Enter' }), ' runs it');

  // ---- the mode switch: tabs, or a select where the pane is narrow (CSS swaps them)
  const tabs = el('div', { className: 'term-tabs' });
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Output mode');
  const tabFor = new Map<Mode, HTMLButtonElement>();
  for (const m of MODES) {
    const b = el('button', { type: 'button', className: 'term-tab', id: `${id}-tab-${m}`, textContent: LABELS[m] });
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', `${id}-screen`);
    b.dataset.mode = m;
    tabFor.set(m, b);
    tabs.append(b);
  }
  const modePick = el('select', { id: `${id}-mode` });
  for (const m of MODES) modePick.append(el('option', { value: m, textContent: `--mode ${m}` }));
  const modeField = el('div', { className: 'term-pick' }, el('label', { htmlFor: `${id}-mode`, className: 'term-modes-label', textContent: 'Output mode' }), modePick);

  // ---- the output
  const screen = el('div', { className: 'term-screen', id: `${id}-screen`, tabIndex: 0 });
  screen.setAttribute('role', 'tabpanel');
  const exit = el('p', { className: 'term-exit' });
  const status = el('p', { className: 'term-status' });
  status.setAttribute('role', 'status');
  const about = el(
    'details',
    { className: 'term-about' },
    el('summary', { textContent: 'What this pane reproduces, and what it does not' }),
    el(
      'ul',
      {},
      el('li', { textContent: `The four modes are relate's own renderers, ported to this page; a unit test compares their bytes with the relate ${FACTS.version} binary's on the statements of its fixtures (the presets among them) and on every run recorded in the docs that this pane can show.` }),
      el('li', { textContent: `The engine here has no exit codes and no stderr. The exit code and the error's class come from its kind through the classes recorded in errors.json, and the row cap of ${FACTS.agentCap} from the run recorded under ${FACTS.harnessVariable}=1 in cli.json, all with relate ${FACTS.version}. The cap is the CLI's, applied to the engine's rows here; the engine itself returns every row.` }),
      el('li', { textContent: `Detection reads ${FACTS.harnessVariables.length} variables (${FACTS.harnessVariables.join(', ')}) and only when stdout is not a terminal; the toggle plays ${FACTS.harnessVariable}=1 with stdout piped.` }),
      el('li', { textContent: 'Not shown: timings (relate prints none in these modes; the line above the list gives this run\'s own), the plan relate prints for EXPLAIN and PROFILE, the note relate writes on stderr when a write changed nothing, and the did-you-mean line after a syntax error whose first word is close to a command name.' }),
      el('li', { textContent: 'The table is the width relate prints to a pipe; at a terminal relate wraps cells to fit. A date, time or duration inside a list or map shows quoted in the table, where relate prints it bare. Column widths follow the rules relate measures with for CJK, combining marks, flags and emoji with a skin tone or a presentation selector; other scripts are measured approximately. TOON here is relate\'s tabular form of it, not the whole TOON specification.' }),
      el('li', { textContent: 'Where the engine in this page words an error differently from the binary (one known case, a latitude out of range), the message and kind shown are the engine\'s, and the line under the output says so.' }),
      el('li', { textContent: `The pane draws the first ${MAX_LINES} lines of output and the first ${MAX_CHARS.toLocaleString('en-US')} characters of a line, and says how much it left out; relate prints it all, and the counts under the output are the full ones.` }),
    ),
  );

  const root = el(
    'div',
    { className: 'term' },
    el('div', { className: 'term-field' }, el('label', { htmlFor: `${id}-preset`, textContent: 'Statement' }), pick),
    el('div', { className: 'term-field' }, el('label', { htmlFor: `${id}-input`, className: 'visually-hidden', textContent: 'The statement to run' }), input),
    el('div', { className: 'term-actions' }, run, harnessLabel, hint),
    el('div', { className: 'term-modes' }, tabs, modeField),
    screen,
    exit,
    status,
    about,
  );
  live.replaceChildren(root);

  // ---- drawing
  let shown: Shown | null = null;
  const line = (fd: 0 | 1 | 2, text: string) => {
    const row = el('div', { className: fd === 0 ? 'term-line term-command' : 'term-line' });
    row.dataset.fd = String(fd);
    row.append(el('span', { className: 'term-fd', textContent: fd === 0 ? '$' : fd === 2 ? 'stderr' : '' }), el('span', { className: 'term-text', textContent: text }));
    return row;
  };
  /** A line of the pane's own, not relate's: what the pane left out. */
  const note = (text: string) => {
    const row = el('div', { className: 'term-line term-note' });
    row.append(el('span', { className: 'term-fd', textContent: 'pane' }), el('span', { className: 'term-text', textContent: text }));
    return row;
  };
  const draw = () => {
    for (const [m, b] of tabFor) {
      b.setAttribute('aria-selected', String(m === mode));
      b.tabIndex = m === mode ? 0 : -1;
    }
    modePick.value = mode;
    // One name that holds at every width (the tab it would point to is hidden where the pane is narrow).
    screen.setAttribute('aria-label', `Output of --mode ${mode}`);
    if (!shown) return;
    const cap = harness ? FACTS.agentCap : null;
    const command = line(0, commandLine(shown.statement, mode, harness ? FACTS.harnessVariable : null));
    let out: RunOutput;
    try {
      out = view(shown, mode, cap);
    } catch (err) {
      // Never leave another mode's output under this tab.
      screen.replaceChildren(command, note(`the pane could not draw this output: ${(err as Error).message}`));
      status.textContent = `${shown.head} The pane could not draw --mode ${mode}: ${(err as Error).message}`;
      return;
    }
    // Appended in a loop into a fragment: a spread would pass one argument per line.
    const frag = document.createDocumentFragment();
    frag.append(command);
    const drawn = Math.min(out.lines.length, MAX_LINES);
    let cut = 0;
    for (let i = 0; i < drawn; i++) {
      const l = out.lines[i];
      if (l.text.length > MAX_CHARS) {
        frag.append(line(l.fd, l.text.slice(0, MAX_CHARS)), note(`the pane cuts the line above here; relate prints ${plural(l.text.length - MAX_CHARS, 'more character')} of it`));
        cut++;
      } else frag.append(line(l.fd, l.text));
    }
    if (out.lines.length > drawn) frag.append(note(`the pane stops here; relate prints ${plural(out.lines.length - drawn, 'more line')}`));
    screen.replaceChildren(frag);
    screen.dataset.exit = String(out.exit);
    screen.dataset.lines = String(out.lines.length);
    screen.dataset.drawn = String(drawn);
    screen.dataset.cut = String(cut);
    // The rows the engine returned against the rows relate prints: what the cap did, in numbers.
    const counts = shown.envelopes.filter((e) => e.error === null && e.columns.length);
    const total = counts.reduce((n, e) => n + e.rows.length, 0);
    const printed = counts.reduce((n, e) => n + Math.min(e.rows.length, cap ?? Infinity), 0);
    screen.dataset.printed = String(printed);
    const code = FACTS.exitCodes.find((x) => x.exit === out.exit)?.code ?? String(out.exit);
    exit.replaceChildren(`exit ${out.exit} · `, el('code', { textContent: code }));
    if (out.error) {
      exit.append(` (kind `, el('code', { textContent: out.error.kind }), `, retryable `, el('code', { textContent: String(out.error.retryable) }), ')');
    }
    exit.append(`, as relate ${FACTS.version} returns it`);
    if (out.error?.matched) {
      // With the trailing slash the static hosts serve, as the build writes every docs link.
      exit.append(' · ', el('a', { href: `/docs/reference/errors/#${out.error.matched}`, textContent: out.error.matched }));
    } else if (out.error) {
      exit.append(' · no recorded message matches; its prefix names the kind');
    }
    const whence = shown.source === 'live' ? 'from the engine' : 'recorded';
    if (counts.length) exit.append(` · ${plural(total, 'row')} ${whence}, ${printed.toLocaleString('en-US')} printed${printed < total ? ` (the row cap of ${cap!.toLocaleString('en-US')})` : ''}`);
    if (out.gaps.length) exit.append(` · ${out.gaps.join('; ')}`);
    // The outcome goes into the live region too: the exit line is not one.
    const onStderr = out.lines.filter((l) => l.fd === 2).length;
    const outcome = `Exit ${out.exit}, ${code}${out.error ? ` (kind ${out.error.kind})` : ''}: ${plural(onStderr, 'line')} on stderr, ${(out.lines.length - onStderr).toLocaleString('en-US')} on stdout.`;
    status.textContent = `${shown.head} ${outcome}${shown.tail ? ` ${shown.tail}` : ''}`;
  };

  // ---- the recording first: the static form's numbers, until the reader runs something
  if (cell) {
    const { envelope } = await cell.recorded();
    if (envelope && !gone) {
      // The recording's version is the page's (the engine bar's data-verified), not the CLI facts' binary.
      shown = shownFrom(own, [recordedEnvelopeText(envelope)], 'recorded', recordedLine(versions(page).recorded), 'Run runs it in this tab.');
    }
  }

  const go = async () => {
    const statement = input.value.trim();
    if (!statement) {
      status.textContent = 'Nothing to run: the statement is empty.';
      return;
    }
    run.disabled = true;
    status.textContent = 'Running…';
    try {
      const r = await page.runReadOnly(statement);
      if (gone) return;
      const last = r.envelopes.at(-1);
      const engine = page.engine();
      const version = engine?.version ?? null;
      const split = last && !last.error ? ` The last statement's split: parse ${formatMs(last.parse_ms)}, plan ${formatMs(last.plan_ms)}, execute ${formatMs(last.execute_ms)} ms.` : '';
      const versionNote = version && version !== FACTS.version ? ` The engine in this tab reports ${version}; the CLI facts are relate ${FACTS.version}'s.` : '';
      const next = shownFrom(statement, r.text, 'live', liveLine({ version, ms: engineMs(r.envelopes) }), `${split}${versionNote}`.trim());
      // Rendered before it replaces what is shown: a run the pane cannot draw leaves the last one whole.
      view(next, mode, harness ? FACTS.agentCap : null);
      shown = next;
      screen.dataset.runs = String(Number(screen.dataset.runs ?? 0) + 1);
      draw();
    } catch (err) {
      status.textContent = `Could not run: ${(err as Error).message}`;
    } finally {
      run.disabled = false;
    }
  };

  // ---- interaction
  run.addEventListener('click', go);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void go();
    }
  });
  input.addEventListener('input', () => {
    pick.value = input.value.trim() === own ? 'page' : PRESETS.findIndex((p) => p.statement === input.value.trim()) >= 0 ? String(PRESETS.findIndex((p) => p.statement === input.value.trim())) : 'edited';
  });
  // Choosing a preset only fills the statement: arrowing through the list
  // fires a change per option, and each run would replace the last.
  pick.addEventListener('change', () => {
    input.value = pick.value === 'page' ? own : (PRESETS[Number(pick.value)]?.statement ?? input.value);
    status.textContent = 'Run runs the statement in this tab.';
  });
  toggle.addEventListener('change', () => {
    harness = toggle.checked;
    draw();
  });
  const choose = (m: Mode, focus = false) => {
    mode = m;
    draw();
    if (focus) tabFor.get(m)!.focus();
  };
  tabs.addEventListener('click', (e) => {
    const m = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]')?.dataset.mode as Mode | undefined;
    if (m) choose(m);
  });
  tabs.addEventListener('keydown', (e) => {
    const i = MODES.indexOf(mode);
    const next = e.key === 'ArrowRight' ? (i + 1) % MODES.length : e.key === 'ArrowLeft' ? (i + MODES.length - 1) % MODES.length : e.key === 'Home' ? 0 : e.key === 'End' ? MODES.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    choose(MODES[next], true);
  });
  modePick.addEventListener('change', () => choose(modePick.value as Mode));

  draw();
  if (!shown) status.textContent = 'Run runs the statement in this tab.';
  ctx.showLive();
  return () => {
    gone = true;
  };
}
