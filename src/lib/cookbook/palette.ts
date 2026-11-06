// Node label colours, shared by the graph view and the recipe diagrams
// (ADR-0135): the palette Neo4j's graph tools (Bloom, NVL) draw labels in, in
// their order. Every colour reads with dark text in either theme. These are
// data colours for the graph canvas and SVGs, not page tokens.

/** The palette by name, in the tools' order. */
export const PALETTE_BY_NAME = {
  yellow: '#FFDF81',
  lilac: '#C990C0',
  orange: '#F79767',
  cyan: '#56C7E4',
  red: '#F16767',
  beige: '#D8C7AE',
  green: '#8DCC92',
  pink: '#ECB4C9',
  blue: '#4D8DDA',
  amber: '#FFC354',
  rose: '#DA7294',
  teal: '#579380',
} as const;

/** The palette in order: a diagram's class `lN` is entry N. */
export const PALETTE: readonly string[] = Object.values(PALETTE_BY_NAME);

/** A node's colour when it has no label colour. */
export const NEUTRAL = '#A5ABB6';

/** The outline of a node filled with `fill` (#RRGGBB): the same hue, darker. */
export function outline(fill: string): string {
  const dark = [1, 3, 5].map((i) => Math.round(parseInt(fill.slice(i, i + 2), 16) * 0.78));
  return `#${dark
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}
