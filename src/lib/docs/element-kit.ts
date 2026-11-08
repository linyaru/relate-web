// What an element's `staticForm` (src/lib/docs/elements/<name>.ts) draws
// with: the site's colours per theme, the force layout the schema diagrams
// and the cells' static graph forms use (d3-force, a devDependency: it runs
// at record time only and never ships), the text measure those drawings
// use, and a frame that makes an inert, labelled SVG. Node only.
//
// A picture is drawn twice, light and dark, from the tokens in base.css
// (`bothThemes`), never with hard-coded colours, and passes the inert-SVG
// check the build applies to every inlined drawing (diagrams.ts inertSvg).

import { diagramColors, type DiagramColors } from '../cookbook/diagram-theme.ts';
import type { Theme } from '../cookbook/diagrams.ts';
import { esc } from '../cookbook/result-view.ts';
import { siteTokens, mix, type Tokens } from '../cookbook/tokens.ts';
import type { StaticForm } from './elements.ts';

export * as d3 from 'd3-force';
export { layoutSchema } from '../cookbook/schema-layout.ts';
export { drawSchema } from '../cookbook/schema-draw.ts';
export { caption, labelColor } from '../cookbook/graph-model.ts';
export { NEUTRAL, outline, PALETTE } from '../cookbook/palette.ts';
export { drawResultGraph, measure } from './checks/cells.ts';
export { diagramColors, esc, mix, siteTokens, type DiagramColors, type Theme, type Tokens };

/** The site's font stack, as the other drawings name it. */
export const FONT = '"Public Sans",system-ui,sans-serif';

/**
 * An SVG document around `body`: `id` is unique on the page (scope `style`
 * rules with `#${id}`), `title` is its accessible name and `desc` says in
 * words what it shows. Width follows the column up to `width` px.
 */
export function svgFrame({ id, width, height, title, desc, style = '', body }: { id: string; width: number; height: number; title: string; desc: string; style?: string; body: string }): string {
  return (
    `<svg id="${esc(id)}" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width: ${Math.ceil(width)}px;" ` +
    `viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" role="img" aria-labelledby="${esc(id)}-title ${esc(id)}-desc">` +
    `<title id="${esc(id)}-title">${esc(title)}</title><desc id="${esc(id)}-desc">${esc(desc)}</desc>` +
    `<style>#${esc(id)}{font-family:${FONT}}${style}</style>${body}</svg>`
  );
}

/** Draw a picture once per theme with that theme's colours: the two SVGs a static form returns. */
export function bothThemes(draw: (theme: Theme, colors: DiagramColors) => string): Required<Pick<StaticForm, 'svgLight' | 'svgDark'>> {
  const tokens = siteTokens();
  return { svgLight: draw('light', diagramColors('light', tokens)), svgDark: draw('dark', diagramColors('dark', tokens)) };
}

/** A GFM table, cells escaped for markdown (pipes and newlines). */
export function markdownTable(columns: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`| ${columns.map(cell).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}
