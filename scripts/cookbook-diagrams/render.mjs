#!/usr/bin/env node
// Render the cookbook's ```mermaid blocks to SVG for the website (ADR-0135).
// Ported from the Relate repository's scripts/cookbook/diagrams/render.mjs.
//
// Each block of src/content/cookbook/<slug>.md becomes <slug>-<n>-light.svg
// and <slug>-<n>-dark.svg in src/content/cookbook/diagrams/, in the site's
// colours (src/styles/base.css, through src/lib/cookbook/diagram-theme.ts)
// and font. A data model (a flowchart whose nodes are all circles) is drawn
// as a graph by src/lib/cookbook/schema-graph.ts, from mermaid's parse of the
// block and text measured in headless Chrome, and its label colours go to
// <slug>-<n>-labels.json for the result graph view; any other block is drawn
// by mermaid there. The first line of each SVG (the `source` of each labels
// file) records the SHA-256 of its block; the site build fails when they
// differ. Files already rendered from the same source are left alone; pass
// --force after changing the site's colours, which the hash does not cover.
//
// An authoring tool, not run by CI: `npm ci` here (scripts/cookbook-diagrams),
// then `npm run cookbook:diagrams` from the repository root after changing a
// diagram. Needs Chrome (CHROME_PATH, or a usual install location) and Node
// 22.18+ (it imports the site's TypeScript modules); no network.
//
// Usage: node render.mjs [--only SLUG[,SLUG…]] [--force]

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { diagramColors } from '../../src/lib/cookbook/diagram-theme.ts';
import {
  diagramFile,
  diagramFiles,
  diagramTitle,
  hashComment,
  inertSvg,
  isDiagramFileOf,
  isFresh,
  labelsFile,
  readLabels,
  sourceHash,
  THEMES,
  writeLabels,
} from '../../src/lib/cookbook/diagrams.ts';
import { COOKBOOK_DIR, loadRecipes, projectRoot } from '../../src/lib/cookbook/load.ts';
import { PALETTE, PALETTE_BY_NAME } from '../../src/lib/cookbook/palette.ts';
import { drawSchema, FONTS, fontSpec, isSchema, layoutSchema, schemaLabels, schemaModel } from '../../src/lib/cookbook/schema-graph.ts';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
  require.resolve('mermaid/dist/mermaid.min.js');
} catch {
  console.error('render.mjs: its dependencies are not installed; run `npm ci --prefix scripts/cookbook-diagrams` first');
  process.exit(1);
}

const { values: args } = parseArgs({
  options: {
    only: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});
const outDir = join(COOKBOOK_DIR, 'diagrams');
const only = args.only ? args.only.split(',').map((s) => s.trim()) : null;

// Mermaid's theme, from the site's diagram colours.
function themeVariables(theme) {
  const c = diagramColors(theme);
  return {
    darkMode: theme === 'dark',
    background: c.surface,
    primaryColor: c.node,
    primaryTextColor: c.fg,
    primaryBorderColor: c.borderStrong,
    secondaryColor: c.secondary,
    tertiaryColor: c.surface,
    lineColor: c.line,
    textColor: c.fg,
    titleColor: c.fg,
    nodeTextColor: c.fg,
    mainBkg: c.node,
    nodeBorder: c.borderStrong,
    clusterBkg: c.node,
    clusterBorder: c.rule,
    edgeLabelBackground: c.surface,
    // gantt
    gridColor: c.rule,
    sectionBkgColor: c.node,
    sectionBkgColor2: c.node,
    altSectionBkgColor: c.surface,
    taskTextOutsideColor: c.fg,
  };
}

// Label classes l1…l12, for mermaid-drawn flowcharts too: the graph view's
// palette, which reads with dark text on either theme.
const labelClasses = (theme) => {
  const { labelText } = diagramColors(theme);
  return PALETTE.map((c, i) => `  classDef l${i + 1} fill:${c},stroke:${c},color:${labelText}`).join('\n');
};

// Flow classes: `accent` marks the step a diagram is about; `good` and `bad`
// mark outcomes. Each is outlined in its site token over a tint of it.
const flowClasses = (theme) => {
  const c = diagramColors(theme);
  return Object.entries(c.flow)
    .map(([name, { stroke, fill }]) => `  classDef ${name} fill:${fill},stroke:${stroke},color:${c.fg}`)
    .join('\n');
};

// Gantt bars from the palette, with dark text: tasks blue, closed (done)
// beige, current (active) green, rejected (crit) red.
const gantt = (theme) => {
  const { labelText } = diagramColors(theme);
  const { blue, beige, green, red } = PALETTE_BY_NAME;
  return {
    taskBkgColor: blue,
    taskBorderColor: blue,
    taskTextColor: labelText,
    taskTextLightColor: labelText,
    taskTextDarkColor: labelText,
    taskTextClickableColor: labelText,
    doneTaskBkgColor: beige,
    doneTaskBorderColor: beige,
    activeTaskBkgColor: green,
    activeTaskBorderColor: green,
    critBkgColor: red,
    critBorderColor: red,
  };
};

// What mermaid draws for a block of diagram type `type`: flowcharts get the
// label and flow classes; gantt charts lose the marker for today, which would
// move the drawing every day it is rendered.
function mermaidSource(source, type, theme) {
  if (type.startsWith('flowchart')) return `${source}\n${labelClasses(theme)}\n${flowClasses(theme)}`;
  if (type === 'gantt') return `${source}\ntodayMarker off`;
  return source;
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Chrome not found; set CHROME_PATH');
  return found;
}

// The site's own Public Sans files, embedded, so text is measured and drawn
// in the font the page uses, with no network.
function fontFaces() {
  return ['400', '500', '600']
    .map((w) => {
      const data = readFileSync(join(projectRoot(), `public/fonts/public-sans-${w}.woff2`)).toString('base64');
      return `@font-face{font-family:"Public Sans";font-weight:${w};src:url(data:font/woff2;base64,${data}) format("woff2");font-display:block}`;
    })
    .join('');
}

// Whether a diagram's files are current: both renderings, and its labels
// file when it has one.
function isCurrent(slug, diagram) {
  if (!THEMES.every((theme) => isFresh(outDir, slug, diagram, theme))) return false;
  try {
    readLabels(outDir, slug, diagram);
    return true;
  } catch {
    return false; // stale or unreadable: render it again
  }
}

const remove = (file) => {
  rmSync(join(outDir, file));
  console.log(`removed ${file}`);
};

// The recipes as the site parses them, so both agree on what a diagram is.
const { recipes: all, problems } = loadRecipes(COOKBOOK_DIR, { validate: false });
if (problems.length) {
  console.error(`render.mjs: ${problems.join('\n')}`);
  process.exit(1);
}
const recipes = all.filter((r) => !only || only.includes(r.slug));

mkdirSync(outDir, { recursive: true });
const todo = [];
for (const r of recipes) {
  for (const diagram of r.diagrams) {
    if (args.force || !isCurrent(r.slug, diagram)) todo.push({ slug: r.slug, diagram });
  }
  // Files of blocks the recipe no longer has.
  const keep = new Set(r.diagrams.flatMap((d) => diagramFiles(r.slug, d.index)));
  for (const f of readdirSync(outDir)) if (isDiagramFileOf(r.slug, f) && !keep.has(f)) remove(f);
}
if (todo.length === 0) {
  console.log('diagrams: every rendering is current (pass --force to render them again)');
  process.exit(0);
}

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><style>${fontFaces()}</style></head><body></body></html>`, {
    waitUntil: 'load',
  });
  await page.addScriptTag({ path: require.resolve('mermaid/dist/mermaid.min.js') });
  const fonts = await page.evaluate(async () => {
    await Promise.all(['400', '500', '600'].map((w) => document.fonts.load(`${w} 14px "Public Sans"`)));
    return document.fonts.check('14px "Public Sans"');
  });
  if (!fonts) throw new Error('Public Sans did not load; labels would be measured with a fallback font');

  // Data models are measured with each character's advance in the site's
  // fonts (kerning is ignored, which errs a little wide).
  const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
  const chars = [...new Set([...printable, ...todo.map((t) => t.diagram.source).join('')])];
  const advances = await page.evaluate(
    (specs, chars) => {
      const ctx = document.createElement('canvas').getContext('2d');
      return Object.fromEntries(
        specs.map((spec) => {
          ctx.font = spec;
          return [spec, Object.fromEntries(chars.map((c) => [c, ctx.measureText(c).width]))];
        }),
      );
    },
    Object.values(FONTS).map(fontSpec),
    chars,
  );
  const measure = (text, font) => {
    const table = advances[fontSpec(font)];
    return [...text].reduce((w, c) => w + (table[c] ?? font.size * 0.6), 0);
  };

  // Mermaid's own parse of a block: its diagram type and, for a flowchart,
  // its graph.
  const parse = (source) =>
    page.evaluate(async (source) => {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      const diagram = await window.mermaid.mermaidAPI.getDiagramFromText(source);
      if (!diagram.type.startsWith('flowchart')) return { type: diagram.type, flowchart: null };
      const db = diagram.db;
      return {
        type: diagram.type,
        flowchart: {
          direction: db.getDirection(),
          subgraphs: db.getSubGraphs().length,
          vertices: [...db.getVertices().values()].map((v) => ({ id: v.id, text: v.text, type: v.type, classes: v.classes })),
          edges: db.getEdges().map((e) => ({ start: e.start, end: e.end, text: e.text, stroke: e.stroke, type: e.type })),
        },
      };
    }, source);

  // A block drawn by mermaid, in the site's theme.
  const renderMermaid = async (id, source, theme) => {
    const variables = themeVariables(theme);
    const config = {
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: '"Public Sans", system-ui, sans-serif',
      themeVariables: { ...variables, ...gantt(theme), fontFamily: '"Public Sans", system-ui, sans-serif', fontSize: '14px' },
      flowchart: { curve: 'basis', padding: 12, nodeSpacing: 40, rankSpacing: 52, wrappingWidth: 280 },
      gantt: { barHeight: 24, barGap: 8, topPadding: 40, sectionFontSize: 14, fontSize: 13 },
    };
    const svg = await page.evaluate(
      async (id, source, config) => {
        window.mermaid.initialize(config);
        const { svg } = await window.mermaid.render(id, source);
        return svg;
      },
      id,
      source,
      config,
    );
    // Gantt grid lines are drawn with stroke="currentColor", which would take
    // the page's text colour; give them the theme's grid colour.
    const out = svg.replaceAll('<line stroke="currentColor"', `<line stroke="${variables.gridColor}"`);
    // Mermaid draws rounded shapes as long point lists at full precision; two
    // decimals is far below a pixel and cuts the files by most of their size.
    return out.replace(/ d="([^"]*)"/g, (_, d) => ` d="${d.replace(/-?\d+\.\d{3,}/g, (n) => String(Math.round(Number(n) * 100) / 100))}"`);
  };

  for (const { slug, diagram } of todo) {
    const name = `${slug}-${diagram.index}`;
    const parsed = await parse(diagram.source);
    const model = parsed.flowchart && isSchema(parsed.flowchart) ? schemaModel(parsed.flowchart) : null;
    const layout = model && layoutSchema(model, measure);
    for (const p of layout?.problems ?? []) console.warn(`warning: ${name}: ${p}`);
    for (const theme of THEMES) {
      const id = `d-${name}-${theme}`;
      const svg = layout
        ? drawSchema(layout, { id, theme, title: diagramTitle(diagram.source) ?? '' })
        : await renderMermaid(id, mermaidSource(diagram.source, parsed.type, theme), theme);
      // The build accepts only what the renderers are known to draw; fail
      // here, where the cause is visible, if a mermaid upgrade draws
      // something else.
      const file = diagramFile(slug, diagram.index, theme);
      inertSvg(svg, file);
      writeFileSync(join(outDir, file), `${hashComment(sourceHash(diagram.source))}\n${svg}\n`);
      console.log(`${layout ? 'drew' : 'rendered'} ${file}`);
    }
    if (model) {
      writeLabels(outDir, slug, diagram, schemaLabels(model));
      console.log(`wrote ${labelsFile(slug, diagram.index)}`);
    } else if (existsSync(join(outDir, labelsFile(slug, diagram.index)))) {
      remove(labelsFile(slug, diagram.index));
    }
  }
} finally {
  await browser.close();
}
