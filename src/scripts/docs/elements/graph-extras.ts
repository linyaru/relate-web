// The graph view extras' cell words (`layout=`, `caption=`, `highlight=path`
// on a ```cypher run fence; src/lib/cookbook/cells.ts CELL_WORDS): the
// features themselves live in the one graph module
// (src/scripts/cookbook/graph.ts) and work on every graph view; this module
// hands a cell's words to each view the cell draws (`view.configure`), so a
// view drawn before the words reached it still takes them, and gives a view
// its result's paths when the cell runtime drew it without its envelope
// (`view.setPaths`: the recording's, or the last run's). The cell's pane
// (`ctx.live`) says in words what the words did to the picture, inside the
// output's live region: the highlighted path is never told by colour alone.

import type { ElementContext } from '../element-api.ts';
import type { GraphView } from '../../cookbook/graph.ts';
import { viewDefaults } from '../../../lib/cookbook/graph-extras-model.ts';

export async function mount(ctx: ElementContext) {
  const { cell, page, live } = ctx;
  if (!cell) return;
  const defaults = viewDefaults(ctx.attrs);
  // Only the words the cell carries: a word it lacks leaves the view's own default.
  const words: Parameters<GraphView['configure']>[0] = {};
  if ('layout' in ctx.attrs) words.layout = defaults.layout;
  if ('caption' in ctx.attrs) words.caption = defaults.caption;
  if ('highlight' in ctx.attrs) words.highlight = defaults.highlight;

  // A run's envelope arrives (onResult) before the view the run draws.
  let lastRun: unknown = null;
  const offResult = page.onResult((r) => {
    if (r.cell.id === cell.id) lastRun = r.envelopes.at(-1) ?? null;
  });
  const offReset = page.onReset(() => {
    lastRun = null;
  });

  const note = Object.assign(document.createElement('p'), { className: 'graph-extras-note' });
  live.replaceChildren(note);

  // The sentence follows the view: it is rewritten after every change the
  // reader makes (layout, caption, highlight, pins), not only when a view comes.
  const describe = (view: GraphView) => {
    const s = view.state();
    const parts: string[] = [];
    if (s.layout !== 'force') parts.push(`Laid out ${s.layout === 'hierarchical' ? 'as a hierarchy, top down' : 'on a circle'}.`);
    if (s.highlight) {
      parts.push(`${s.paths === 1 ? 'The path is' : `The ${s.paths} paths are`} drawn on top: ${s.highlighted.nodes} nodes and ${s.highlighted.rels} relationships; the rest is dimmed.`);
    }
    if (s.caption) parts.push(`Nodes are captioned with their ${s.caption} property.`);
    note.textContent = parts.join(' ');
  };
  let offChange: (() => void) | null = null;
  // The view the cell shows now: a run or Reset can replace it (or drop it)
  // while the recording loads, and a replaced view is destroyed.
  let current: GraphView | null = null;

  const offGraph = cell.onGraph(async (view) => {
    offChange?.();
    offChange = null;
    current = view;
    if (!view) {
      note.textContent = '';
      return;
    }
    const envelope = cell.state() === 'recorded' ? (await cell.recorded()).envelope : lastRun;
    if (current !== view) return;
    view.setPaths(envelope);
    view.configure(words);
    describe(view);
    offChange = view.onChange(() => describe(view));
    live.dataset.ready = 'true';
  });
  return () => {
    offChange?.();
    offGraph();
    offResult();
    offReset();
  };
}
