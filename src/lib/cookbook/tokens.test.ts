import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diagramColors } from './diagram-theme.ts';
import { blockTokens, mix, resolveTokens, siteTokens, themeTokens } from './tokens.ts';

const CSS = `
/* a comment with :root { --nope: #000; } in it */
:root {
  --surface-0: #101013;   /* Night */
  --ink: #F1F1F3;
  --brand: #8FE3E8;
  --term-bg: #101013;
  --bg: var(--surface-0);
  --ring: var(--brand);
}
:root[data-theme="light"] {
  --surface-0: #FAFAFA;
  --ink: #0A1114;
  --brand: #0A6190;
}
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { --surface-0: #EEEEEE; } }
`;

test('blockTokens reads one block, ignoring comments and look-alike selectors', () => {
  assert.deepEqual(blockTokens(CSS, ':root'), {
    '--surface-0': '#101013',
    '--ink': '#F1F1F3',
    '--brand': '#8FE3E8',
    '--term-bg': '#101013',
    '--bg': 'var(--surface-0)',
    '--ring': 'var(--brand)',
  });
  assert.equal(blockTokens(CSS, ':root[data-theme="light"]')['--surface-0'], '#FAFAFA');
  assert.throws(() => blockTokens(CSS, '.missing'), /no \.missing block/);
});

test('themeTokens layers light over dark and resolves var() and aliases in each theme', () => {
  const { light, dark } = themeTokens(CSS);
  assert.equal(dark['--ring'], '#8FE3E8');
  assert.equal(light['--ring'], '#0A6190');
  assert.equal(dark['--bg'], '#101013');
  assert.equal(light['--bg'], '#FAFAFA');
  assert.equal(light['--term-bg'], '#101013'); // a token the light block does not set is shared
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
