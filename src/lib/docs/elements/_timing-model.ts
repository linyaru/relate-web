// The phase timing bar's model (the `timing` cell word and the engine bar's
// "Show timing", src/scripts/docs/elements/timing.ts): the parse, plan and
// execute milliseconds an envelope carries, as the segments of a stacked bar.
// Free of Node imports, because the browser module imports it. A recording
// carries no timings (src/lib/docs/checks/cells.ts strips them, so a recorded
// result never drifts), so `phases` is null for one and the bar says so.

import { formatMs } from './_wording.ts';

export interface Phases {
  parse: number;
  plan: number;
  execute: number;
  /** The engine's own elapsed time for the statement, which the three phases add up to within a rounding. */
  elapsed: number;
}

const ms = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** An envelope's phase timings, or null when it has none (a recording) or one is not a non-negative number. */
export function phases(envelope: unknown): Phases | null {
  if (!envelope || typeof envelope !== 'object') return null;
  const e = envelope as Record<string, unknown>;
  const [parse, plan, execute, elapsed] = [ms(e.parse_ms), ms(e.plan_ms), ms(e.execute_ms), ms(e.elapsed_ms)];
  if (parse === null || plan === null || execute === null || elapsed === null) return null;
  return { parse, plan, execute, elapsed };
}

// The bar prints milliseconds the way every element does (_wording.ts): one
// decimal, the step of the browser's timer.
export { formatMs };

export interface Segment {
  phase: 'parse' | 'plan' | 'execute';
  ms: number;
  /** Width as a percentage of the bar's full scale. */
  percent: number;
}

/**
 * The bar's three segments. `scale` is the milliseconds the full width
 * stands for (the longest statement of the run, so statements of one run
 * compare); a non-zero phase keeps a sliver so it stays visible.
 */
export function segments(p: Phases, scale = p.parse + p.plan + p.execute): Segment[] {
  const full = scale > 0 ? scale : 1;
  return (['parse', 'plan', 'execute'] as const).map((phase) => {
    const v = p[phase];
    return { phase, ms: v, percent: v > 0 ? Math.max(0.5, (v / full) * 100) : 0 };
  });
}

/** One line of text for the bar: what a screen reader hears and what shows beside it. */
export const sentence = (p: Phases): string =>
  `parse ${formatMs(p.parse)} ms, plan ${formatMs(p.plan)} ms, execute ${formatMs(p.execute)} ms; ${formatMs(p.elapsed)} ms elapsed`;
