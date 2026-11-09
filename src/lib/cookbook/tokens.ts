// The site's colour tokens, read from src/styles/base.css, for what CSS
// cannot colour: the recipe diagrams, which are pre-rendered SVGs. base.css
// stays the one source; this replaces the Relate repository's
// scripts/cookbook/lib/tokens.mjs (the old palette).
//
// Night is base.css's `:root` block (the default theme). Day is its
// `:root[data-theme="light"]` block over Night, since tokens the light block
// does not set are the same in both themes. `var(--x)` references are resolved
// after the merge, so an alias follows the theme it is read in.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { projectRoot } from './load.ts';

export type Tokens = Record<string, string>;

/** The `--name: value` declarations of the first CSS block whose selector is exactly `selector`. */
export function blockTokens(css: string, selector: string): Tokens {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = text.search(new RegExp(`(^|[}\\s])${selector.replace(/[[\]"().]/g, '\\$&')}\\s*\\{`));
  if (at < 0) throw new Error(`base.css has no ${selector} block`);
  const open = text.indexOf('{', at);
  const body = text.slice(open + 1, text.indexOf('}', open));
  const tokens: Tokens = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

/** `tokens` with every `var(--x)` replaced by the value of `--x`. */
export function resolveTokens(tokens: Tokens): Tokens {
  const out: Tokens = {};
  const value = (name: string, seen: Set<string>): string => {
    const raw = tokens[name];
    if (raw === undefined) throw new Error(`token ${name} is not defined`);
    if (seen.has(name)) throw new Error(`token ${name} refers to itself`);
    return raw.replace(/var\((--[\w-]+)\)/g, (_, ref: string) => value(ref, new Set([...seen, name])));
  };
  for (const name of Object.keys(tokens)) out[name] = value(name, new Set());
  return out;
}

/** The site's tokens, per theme, from `css` (base.css's text). */
export function themeTokens(css: string): { light: Tokens; dark: Tokens } {
  const dark = blockTokens(css, ':root');
  const light = { ...dark, ...blockTokens(css, ':root[data-theme="light"]') };
  return { light: resolveTokens(light), dark: resolveTokens(dark) };
}

/** The site's tokens, per theme, read from src/styles/base.css. */
export const siteTokens = () => themeTokens(readFileSync(join(projectRoot(), 'src/styles/base.css'), 'utf8'));

/** A `#RRGGBB` colour's channels. */
function channels(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`${hex} is not a #RRGGBB colour`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number];
}

/** `share` (0…1) of `color` over `base`, both #RRGGBB: what `color-mix()` gives in sRGB. */
export function mix(color: string, base: string, share: number): string {
  const [a, b] = [channels(color), channels(base)];
  return `#${a
    .map((c, i) => Math.round(c * share + b[i] * (1 - share)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}
