import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diagramColors } from './diagram-theme.ts';
import { blockTokens, mix, resolveTokens, siteTokens, themeTokens } from './tokens.ts';

const CSS = `
/* a comment with :root { --nope: #000; } in it */
:root {
  --bg: #F2EAD4;   /* Cream */
  --fg: #181414;
  --accent: #0A6190;
  --code-bg: #181414;
  --ring: var(--accent);
}
[data-theme="dark"] {
  --bg: #002B43;
  --fg: #F2EAD4;
  --accent: #8FE3E8;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #111111; } }
`;

test('blockTokens reads one block, ignoring comments and look-alike selectors', () => {
  assert.deepEqual(blockTokens(CSS, ':root'), {
    '--bg': '#F2EAD4',
    '--fg': '#181414',
    '--accent': '#0A6190',
    '--code-bg': '#181414',
    '--ring': 'var(--accent)',
  });
  assert.equal(blockTokens(CSS, '[data-theme="dark"]')['--bg'], '#002B43');
  assert.throws(() => blockTokens(CSS, '.missing'), /no \.missing block/);
});

test('themeTokens layers dark over light and resolves var() in each theme', () => {
  const { light, dark } = themeTokens(CSS);
  assert.equal(light['--ring'], '#0A6190');
  assert.equal(dark['--ring'], '#8FE3E8');
  assert.equal(dark['--code-bg'], '#181414');
  assert.throws(() => resolveTokens({ '--a': 'var(--b)', '--b': 'var(--a)' }), /refers to itself/);
  assert.throws(() => resolveTokens({ '--a': 'var(--missing)' }), /--missing is not defined/);
});

test('mix blends in sRGB like color-mix()', () => {
  assert.equal(mix('#FFFFFF', '#000000', 0.5), '#808080');
  assert.equal(mix('#0A6190', '#0A6190', 0.3), '#0A6190');
  assert.throws(() => mix('red', '#000000', 0.5), /not a #RRGGBB/);
});

test('the site tokens and diagram colours come from base.css', () => {
  const tokens = siteTokens();
  for (const theme of ['light', 'dark'] as const) {
    for (const name of ['--bg', '--bg-alt', '--bg-inset', '--fg', '--fg-muted', '--fg-faint', '--border', '--border-strong', '--accent', '--success', '--danger']) {
      assert.match(tokens[theme][name] ?? '', /^#[0-9A-F]{6}$/i, `${theme} ${name}`);
    }
  }
  const light = diagramColors('light');
  const dark = diagramColors('dark');
  assert.equal(light.surface, tokens.light['--bg-alt']);
  assert.equal(dark.surface, tokens.dark['--bg-alt']);
  assert.equal(light.labelText, dark.labelText);
  assert.notEqual(light.flow.accent.fill, dark.flow.accent.fill);
});
