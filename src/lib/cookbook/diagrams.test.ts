import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  diagramFile,
  diagramTitle,
  hashComment,
  inertSvg,
  labelsFile,
  prepareSvg,
  readLabels,
  readRendered,
  sourceHash,
  type Theme,
} from './diagrams.ts';

const DIAGRAM = { index: 1, source: 'flowchart LR\n  accTitle: The graph data model\n  A --> B', line: 1 };
const SVG = '<svg id="d" style="max-width: 10px;"><path marker-end="url(#d_arrow)" d="M0 0"/></svg>';

test('diagramTitle reads accTitle', () => {
  assert.equal(diagramTitle(DIAGRAM.source), 'The graph data model');
  assert.equal(diagramTitle('flowchart TD\n  C --> D'), null);
});

test('sourceHash ignores trailing whitespace only', () => {
  assert.equal(sourceHash('a\nb'), sourceHash('a\nb\n  \n'));
  assert.notEqual(sourceHash('a\nb'), sourceHash(' a\nb'));
});

function rendered(svgs: Partial<Record<Theme, string>>) {
  const dir = mkdtempSync(join(tmpdir(), 'diagrams-'));
  for (const [theme, svg] of Object.entries(svgs)) {
    writeFileSync(join(dir, diagramFile('t', 1, theme as Theme)), `${hashComment(sourceHash(DIAGRAM.source))}\n${svg}\n`);
  }
  return dir;
}

test('readRendered returns both themes and rejects stale, missing, or active files', () => {
  const dir = rendered({ light: SVG, dark: SVG });
  assert.deepEqual(readRendered(dir, 't', DIAGRAM), { light: inertSvg(SVG, 'x'), dark: inertSvg(SVG, 'x') });
  assert.throws(() => readRendered(dir, 't', { ...DIAGRAM, source: 'flowchart TD' }), /changed since it was rendered/);
  assert.throws(() => readRendered(dir, 'u', DIAGRAM), /has no light rendering/);
  const tampered = rendered({ light: SVG, dark: SVG.replace('</svg>', '<script>alert(1)</script></svg>') });
  assert.throws(() => readRendered(tampered, 't', DIAGRAM), /holds the element <script>/);
});

test('readLabels reads fresh labels, and rejects stale or malformed ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'labels-'));
  assert.equal(readLabels(dir, 't', DIAGRAM), null);
  const write = (labels: unknown, source = sourceHash(DIAGRAM.source)) =>
    writeFileSync(join(dir, labelsFile('t', 1)), JSON.stringify({ source, labels }));
  write({ Agent: '#FFDF81', 'Doc:ADR': '#A5ABB6' });
  assert.deepEqual(readLabels(dir, 't', DIAGRAM), { Agent: '#FFDF81', 'Doc:ADR': '#A5ABB6' });
  assert.throws(
    () => readLabels(dir, 't', { ...DIAGRAM, source: 'flowchart TD' }),
    /diagram 1 of t changed since its labels were rendered/,
  );
  for (const labels of [['#FFDF81'], { Agent: 'red' }, { Agent: '#FFDF81;x' }, null]) {
    write(labels);
    assert.throws(() => readLabels(dir, 't', DIAGRAM), /does not map labels to #RRGGBB colours/, JSON.stringify(labels));
  }
  writeFileSync(join(dir, labelsFile('t', 1)), '{');
  assert.throws(() => readLabels(dir, 't', DIAGRAM), /is not JSON/);
});

test('inertSvg accepts what mermaid draws and nothing that can run, fetch, or navigate', () => {
  assert.equal(
    inertSvg(SVG, 'ok'),
    '<svg id="d" style="max-width: 10px;"><path marker-end="url(#d_arrow)" d="M0 0"></path></svg>',
  );
  inertSvg(
    '<svg role="graphics-document document" aria-labelledby="t"><title id="t">T</title><style>#d .node rect{fill:rgb(1,2,3);filter:drop-shadow(1px 1px 2px rgba(0,0,0,.1))}</style>' +
      '<g class="node" data-id="A"><rect rx="5" width="10" height="4"/><foreignObject width="10" height="4"><div><span><p><b>A</b><br/>id</p></span></div></foreignObject></g></svg>',
    'mermaid shape',
  );
  for (const [bad, what] of [
    ['<svg/onload="alert(1)"></svg>', /attribute onload/],
    ['<svg><foreignObject><img src="data:,"onerror="alert(1)"></foreignObject></svg>', /element <img>/],
    ['<svg><foreignObject><details/open/ontoggle="alert(1)"></details></foreignObject></svg>', /element <details>/],
    ['<svg><script>alert(1)</script></svg>', /element <script>/],
    ['<svg><meta http-equiv="refresh" content="0;URL=https://evil.example/"></svg>', /not a single <svg>|element <meta>/],
    ['<svg><a href="https://example.com">x</a></svg>', /element <a>/],
    ['<svg><rect xlink:href="#x"/></svg>', /attribute xlink:href/],
    ['<svg><style>@import "https://example.com/x.css";</style></svg>', /@-rule/],
    ['<svg><style>@font-face{font-family:x}</style></svg>', /@-rule/],
    ['<svg><style>.a{background:u\\72l(https://example.com/p.gif)}</style></svg>', /CSS escape/],
    ['<svg><style>.a{background:image-set("https://example.com/p.gif" 1x)}</style></svg>', /image-set/],
    ['<svg><rect style="fill: url(https://example.com/p.svg#g)"/></svg>', /not a fragment/],
    ['<svg><path marker-end="url(https://example.com/m.svg#m)"/></svg>', /not a fragment/],
    ['<svg></svg><img src="https://example.com/p.gif">', /not a single <svg>/],
  ] as const) {
    assert.throws(() => inertSvg(bad, 'x'), what, bad);
  }
});

test('prepareSvg records the natural width', () => {
  assert.equal(
    prepareSvg('<svg id="d" width="100%" style="max-width: 676.5px;" viewBox="0 0 676 82"><g/></svg>'),
    '<svg id="d" width="100%" style="max-width: 676.5px; --natural-width: 676.5px;" viewBox="0 0 676 82"><g/></svg>',
  );
  assert.equal(prepareSvg('<svg><g style="max-width: 1px;"/></svg>'), '<svg><g style="max-width: 1px;"/></svg>');
});
