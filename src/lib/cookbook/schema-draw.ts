// Drawing a laid-out data model (ADR-0135) as an SVG for the site, in its
// colours for each theme (diagram-theme.ts). Ported from the Relate
// repository's lib/schema-draw.mjs. The drawing itself is schema-svg.ts,
// which has no Node imports so the browser can share it; this module adds
// the theme's colours, which diagram-theme.ts reads from base.css.

import { diagramColors, type DiagramColors, type DiagramTheme } from './diagram-theme.ts';
import type { SchemaLayout } from './schema-layout.ts';
import { drawSchemaSvg } from './schema-svg.ts';

/**
 * The SVG of a laid-out data model (`layoutSchema`) for `theme`: `id` must be
 * unique on the page; `title` names the diagram. `colors` defaults to the
 * site's for that theme.
 */
export function drawSchema(
  layout: SchemaLayout,
  { id, theme, title, colors = diagramColors(theme) }: { id: string; theme: DiagramTheme; title: string; colors?: DiagramColors },
): string {
  return drawSchemaSvg(layout, { id, title, colors });
}
