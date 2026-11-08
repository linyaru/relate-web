// What every interactive element says about where a number came from, and
// how it prints a duration: one wording for the family (DOCS-PLAN.md §7.1,
// "numbers are the engine's"), so a reader moving between elements reads the
// same phrase for the same state. Free of Node and DOM imports: the element
// modules import it in the browser and the unit tests in Node.
//
// The place is always "this tab": the page's one engine and database live in
// the reader's tab (DOCS-PLAN.md §7.2). A recording is labelled with the relate
// version it was recorded on; a live result with the version that ran it.

/**
 * The step of the timer behind the engine's timings in a docs page. A page
 * that is not cross-origin isolated (GitHub Pages sends no COOP/COEP headers)
 * gets a coarsened `performance.now()`, which ticks in 0.1 ms steps, so a
 * second decimal would claim a precision no reading has.
 */
export const TIMER_STEP_MS = 0.1;

/** Said once where timings are drawn, so a reader knows why a phase can read <0.1. */
export const TIMER_NOTE = 'Times are rounded to 0.1 ms, the step of the browser timer the engine reads.';

/**
 * A duration in milliseconds as every element prints it: one decimal (the
 * timer's step), '<0.1' below the step, whole milliseconds from 100 up, and
 * '-' when there is no number.
 */
export function formatMs(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '-';
  if (n < TIMER_STEP_MS / 2) return '<0.1';
  if (n >= 100) return String(Math.round(n));
  return n.toFixed(1);
}

/** "Recorded on relate 0.16.1 when the page was built.": what a recording is, before anything has run. */
export function recordedLine(version: string | null | undefined): string {
  return `Recorded${version ? ` on relate ${version}` : ''} when the page was built.`;
}

/**
 * "From this tab's run on relate 0.16.1, 0.8 ms in the engine.": what a
 * live result is. `of` names what ran ("cell explain-before"); `ms` is the
 * engine's own time (an envelope's elapsed_ms, or their sum), left out when
 * the element has none to show.
 */
export function liveLine({ version, ms, of }: { version: string | null | undefined; ms?: number | null; of?: string }): string {
  const time = typeof ms === 'number' && Number.isFinite(ms) ? `, ${formatMs(ms)} ms in the engine` : '';
  return `From this tab's run${of ? ` of ${of}` : ''}${version ? ` on relate ${version}` : ''}${time}.`;
}

/** The engine's time for a run: the sum of its envelopes' elapsed_ms (a script runs one envelope per statement). */
export function engineMs(envelopes: readonly { elapsed_ms?: unknown }[]): number | null {
  const times = envelopes.map((e) => e.elapsed_ms).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return times.length ? times.reduce((a, b) => a + b, 0) : null;
}

/** The part of the element API the versions come from (src/scripts/docs/element-api.ts PageApi). */
interface VersionSource {
  status: { bar: { dataset: Record<string, string | undefined> } };
  engine(): { version: string | null } | null;
}

/**
 * The relate versions a page's element names: `recorded`, the one the page's
 * recordings were verified on (the engine bar's data-verified, from the
 * build); `live`, the engine running in this tab, or null before it starts.
 */
export function versions(page: VersionSource): { recorded: string | null; live: string | null } {
  return { recorded: page.status.bar.dataset.verified ?? null, live: page.engine()?.version ?? null };
}
