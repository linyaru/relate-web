// The recipe diagrams' colours, per theme, from the site's tokens
// (src/styles/base.css, read by tokens.ts). The data-model drawings
// (schema-draw.ts) and the mermaid diagrams (scripts/cookbook-diagrams) both
// draw with these, so diagrams follow the design system: change a token,
// render again (`--force`), and the diagrams change with it.

import { NEUTRAL } from './palette.ts';
import { mix, siteTokens, type Tokens } from './tokens.ts';

export type DiagramTheme = 'light' | 'dark';

export interface DiagramColors {
  /** What a diagram is drawn on: the `.diagram` figure's background in cookbook.css. */
  surface: string;
  fg: string;
  fgMuted: string;
  borderStrong: string;
  /** Fill of a mermaid node, and of a secondary shape. */
  node: string;
  secondary: string;
  /** Mermaid's lines, and its rules and grid. */
  line: string;
  rule: string;
  /** Relationship lines in a data model. */
  rel: string;
  /** Text on a label colour: the palette reads with dark text in either theme. */
  labelText: string;
  /** Flow classes: `accent` marks the step a diagram is about, `good` and `bad` outcomes. */
  flow: Record<'accent' | 'good' | 'bad', { stroke: string; fill: string }>;
}

/** How strongly a flow class tints its shape, over the surface. */
const TINT = 0.16;

/** The diagram colours of `theme`, from `tokens` (the site's, by default). */
export function diagramColors(theme: DiagramTheme, tokens: { light: Tokens; dark: Tokens } = siteTokens()): DiagramColors {
  const t = (name: string) => {
    const v = tokens[theme][`--${name}`];
    if (!v) throw new Error(`base.css has no --${name} token`);
    return v;
  };
  const surface = t('bg-alt');
  const flow = (token: string) => ({ stroke: t(token), fill: mix(t(token), surface, TINT) });
  // Where the themes differ beyond their tokens: dark draws lines and rules a
  // step stronger, and data-model lines in the faint text colour, where the
  // neutral grey would glare.
  const dark = theme === 'dark';
  return {
    surface,
    fg: t('fg'),
    fgMuted: t('fg-muted'),
    borderStrong: t('border-strong'),
    node: t('bg'),
    secondary: t('bg-inset'),
    line: dark ? t('fg-muted') : t('fg-faint'),
    rule: dark ? t('border-strong') : t('border'),
    rel: dark ? t('fg-faint') : NEUTRAL,
    labelText: tokens.light['--fg'],
    flow: { accent: flow('accent'), good: flow('success'), bad: flow('danger') },
  };
}
