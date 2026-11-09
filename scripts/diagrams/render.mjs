#!/usr/bin/env node
// Render the ```mermaid blocks of the cookbook and the docs to SVG for the
// website (ADR-0135, DOCS-PLAN.md 7.6). Ported from the Relate repository's
// scripts/cookbook/diagrams/render.mjs.
//
// Each block of src/content/cookbook/<slug>.md becomes <slug>-<n>-light.svg
// and <slug>-<n>-dark.svg in src/content/cookbook/diagrams/; each block of a
// docs page, src/content/docs/<path>/<slug>.mdx, becomes the same files in
// src/content/docs/<path>/diagrams/, beside the page. They are drawn in the
// site's colors (src/styles/base.css, through src/lib/cookbook/diagram-theme.ts)
// and font. A data model (a flowchart whose nodes are all circles) is drawn
// as a graph by src/lib/cookbook/schema-graph.ts, from mermaid's parse of the
// block and text measured in headless Chrome, and its label colors go to
// <slug>-<n>-labels.json for the result graph view; any other block is drawn
// by mermaid there. The first line of each SVG (the `source` of each labels
// file) records the SHA-256 of its block; the site build fails when they
// differ. Files already rendered from the same source are left alone; pass
// --force after changing the site's colors, which the hash does not cover.
//
// Every block must carry an `accTitle:` line and a multi-line `accDescr { … }`
// block (its caption, and what it shows in words for screen readers and the
// markdown twin); the run fails, naming the file and the block, when one
// lacks either, before anything is rendered.
//
// An authoring tool, not run by CI: `npm ci --prefix scripts/diagrams` once,
// then `npm run cookbook:diagrams` or `npm run docs:diagrams` from the
// repository root after changing a diagram. Needs Chrome (CHROME_PATH, or a
// usual install location) and Node 22.18+ (it imports the site's TypeScript
// modules); no network.
//
// Usage: node render.mjs [--collection cookbook|docs|all] [--only NAME[,NAME…]] [--force]
//   --collection  which pages to render (default all)
//   --only        recipe slugs, or docs pages by file name (`storage`) or by
//                 path under src/content/docs without extension (`concepts/storage`)

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { diagramColors } from '../../src/lib/cookbook/diagram-theme.ts';
import {
  diagramDescription,
  diagramFile,
  diagramFiles,
  diagramProblems,
  diagramTitle,
  hashComment,
  inertSvg,
  isDiagramFileOf,
  isFresh,
  labelsFile,
  mermaidBlocks,
  readLabels,
  sourceHash,
  THEMES,
  writeLabels,
} from '../../src/lib/cookbook/diagrams.ts';
import { COOKBOOK_DIR, loadRecipes, projectRoot } from '../../src/lib/cookbook/load.ts';
import { PALETTE, PALETTE_BY_NAME } from '../../src/lib/cookbook/palette.ts';
import { esc } from '../../src/lib/cookbook/result-view.ts';
import { drawSchema, FONTS, fontSpec, isSchema, layoutSchema, schemaLabels, schemaModel } from '../../src/lib/cookbook/schema-graph.ts';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
  require.resolve('mermaid/dist/mermaid.min.js');
} catch {
  console.error('render.mjs: its dependencies are not installed; run `npm ci --prefix scripts/diagrams` first');
  process.exit(1);
}

const { values: args } = parseArgs({
  options: {
    collection: { type: 'string', default: 'all' },
    only: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});
if (!['cookbook', 'docs', 'all'].includes(args.collection)) {
  console.error(`render.mjs: --collection is cookbook, docs or all, not ${args.collection}`);
  process.exit(1);
}
const only = args.only ? args.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
const root = projectRoot();
const DOCS_DIR = join(root, 'src/content/docs');

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

// The site's own Relate Sans file (a variable font), embedded, so text is measured and drawn
// in the font the page uses, with no network.
function fontFaces() {
  const data = readFileSync(join(root, 'public/fonts/relate-sans.woff2')).toString('base64');
  return `@font-face{font-family:"Relate Sans";font-weight:100 900;src:url(data:font/woff2;base64,${data}) format("woff2");font-display:block}`;
}

// Every page with diagrams to keep current: { file, slug, dir, diagrams },
// where `dir` is the directory its renderings go to and `selected` says
// whether --only picked it.
function cookbookPages() {
  // The recipes as the site parses them, so both agree on what a diagram is.
  const { recipes, problems } = loadRecipes(COOKBOOK_DIR, { validate: false });
  if (problems.length) {
    console.error(`render.mjs: ${problems.join('\n')}`);
    process.exit(1);
  }
  return recipes.map((r) => ({
    file: join(COOKBOOK_DIR, `${r.slug}.md`),
    slug: r.slug,
    dir: join(COOKBOOK_DIR, 'diagrams'),
    diagrams: r.diagrams,
    selected: !only || only.includes(r.slug),
  }));
}

// Every .mdx file under `dir`, sorted.
function mdxFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return e.name === 'diagrams' || e.name === 'node_modules' ? [] : mdxFiles(path);
      return e.isFile() && extname(e.name) === '.mdx' ? [path] : [];
    })
    .sort();
}

function docsPages() {
  const problems = [];
  const pages = [];
  for (const file of mdxFiles(DOCS_DIR)) {
    const slug = basename(file, '.mdx');
    const path = relative(DOCS_DIR, file).slice(0, -'.mdx'.length).split(sep).join('/');
    let diagrams;
    try {
      diagrams = mermaidBlocks(readFileSync(file, 'utf8'));
    } catch (e) {
      problems.push(`${relative(root, file)}: ${e.message}`);
      continue;
    }
    pages.push({
      file,
      slug,
      dir: join(dirname(file), 'diagrams'),
      diagrams,
      selected: !only || only.includes(slug) || only.includes(path),
    });
  }
  if (problems.length) {
    console.error(`render.mjs: ${problems.join('\n')}`);
    process.exit(1);
  }
  return pages;
}

const pages = [
  ...(args.collection === 'docs' ? [] : cookbookPages()),
  ...(args.collection === 'cookbook' ? [] : docsPages()),
];
const selected = pages.filter((p) => p.selected);
if (only) {
  const known = new Set(selected.flatMap((p) => [p.slug, relative(DOCS_DIR, p.file).replace(/\.mdx$/, '').split(sep).join('/')]));
  const unknown = only.filter((name) => !known.has(name));
  if (unknown.length) {
    console.error(`render.mjs: --only names no page in ${args.collection === 'all' ? 'the cookbook or the docs' : `the ${args.collection}`}: ${unknown.join(', ')}`);
    process.exit(1);
  }
}

// Every block must say what it shows, in a title and in words, for readers
// who cannot see the picture; check them all before drawing any.
const missing = selected.flatMap((p) =>
  p.diagrams.flatMap((d) =>
    diagramProblems(d.source).map((why) => `${relative(root, p.file)}:${d.line}: diagram ${d.index} (${p.slug}-${d.index}): ${why}`),
  ),
);
if (missing.length) {
  console.error(`render.mjs: every mermaid block needs \`accTitle:\` and a multi-line \`accDescr { … }\`:\n${missing.join('\n')}`);
  process.exit(1);
}

// Whether a diagram's files are current: both renderings, and its labels
// file when it has one.
function isCurrent({ dir, slug }, diagram) {
  if (!THEMES.every((theme) => isFresh(dir, slug, diagram, theme))) return false;
  try {
    readLabels(dir, slug, diagram);
    return true;
  } catch {
    return false; // stale or unreadable: render it again
  }
}

const remove = (dir, file) => {
  rmSync(join(dir, file));
  console.log(`removed ${relative(root, join(dir, file))}`);
};

const todo = [];
for (const page of selected) {
  for (const diagram of page.diagrams) {
    if (args.force || !isCurrent(page, diagram)) todo.push({ page, diagram });
  }
  // Files of blocks the page no longer has.
  if (!existsSync(page.dir)) continue;
  const keep = new Set(page.diagrams.flatMap((d) => diagramFiles(page.slug, d.index)));
  for (const f of readdirSync(page.dir)) if (isDiagramFileOf(page.slug, f) && !keep.has(f)) remove(page.dir, f);
}
// Files of pages that are gone, in the docs' diagrams/ directories (the
// cookbook's recipes always have one). Only on a full run, which knows
// every page.
if (!only && args.collection !== 'cookbook') {
  const rendering = /^.+-\d+-(light\.svg|dark\.svg|labels\.json)$/;
  const byDir = new Map();
  for (const p of pages) if (p.file.startsWith(DOCS_DIR)) byDir.set(p.dir, [...(byDir.get(p.dir) ?? []), p]);
  const dirs = (dir) =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory() && e.name !== 'node_modules')
          .flatMap((e) => (e.name === 'diagrams' ? [join(dir, e.name)] : dirs(join(dir, e.name))))
      : [];
  for (const dir of dirs(DOCS_DIR)) {
    const owners = byDir.get(dir) ?? [];
    for (const f of readdirSync(dir)) {
      if (rendering.test(f) && !owners.some((p) => isDiagramFileOf(p.slug, f))) remove(dir, f);
    }
  }
}
if (todo.length === 0) {
  console.log('diagrams: every rendering is current (pass --force to render them again)');
  process.exit(0);
}

let executablePath;
try {
  executablePath = chromePath();
} catch (e) {
  console.error(`render.mjs: ${e.message}`);
  process.exit(1);
}
const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><style>${fontFaces()}</style></head><body></body></html>`, {
    waitUntil: 'load',
  });
  await page.addScriptTag({ path: require.resolve('mermaid/dist/mermaid.min.js') });
  const fonts = await page.evaluate(async () => {
    await Promise.all(['400', '500', '600'].map((w) => document.fonts.load(`${w} 14px "Relate Sans"`)));
    return document.fonts.check('14px "Relate Sans"');
  });
  if (!fonts) throw new Error('Relate Sans did not load; labels would be measured with a fallback font');

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
      fontFamily: '"Relate Sans", system-ui, sans-serif',
      themeVariables: { ...variables, ...gantt(theme), fontFamily: '"Relate Sans", system-ui, sans-serif', fontSize: '14px' },
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

  // The SVG's <desc>, for a data model drawn here, is the block's own
  // description (mermaid writes accDescr into the SVGs it draws).
  const withDescription = (svg, source) => {
    const text = diagramDescription(source);
    return text ? svg.replace(/(<desc id="[^"]*">)[^<]*(<\/desc>)/, (_, open, close) => `${open}${esc(text)}${close}`) : svg;
  };

  for (const { page, diagram } of todo) {
    const { slug, dir } = page;
    const name = `${slug}-${diagram.index}`;
    mkdirSync(dir, { recursive: true });
    const parsed = await parse(diagram.source);
    const model = parsed.flowchart && isSchema(parsed.flowchart) ? schemaModel(parsed.flowchart) : null;
    const layout = model && layoutSchema(model, measure);
    for (const p of layout?.problems ?? []) console.warn(`warning: ${relative(root, page.file)}: ${name}: ${p}`);
    for (const theme of THEMES) {
      const id = `d-${name}-${theme}`;
      const svg = layout
        ? withDescription(drawSchema(layout, { id, theme, title: diagramTitle(diagram.source) ?? '' }), diagram.source)
        : await renderMermaid(id, mermaidSource(diagram.source, parsed.type, theme), theme);
      // The build accepts only what the renderers are known to draw; fail
      // here, where the cause is visible, if a mermaid upgrade draws
      // something else.
      const file = diagramFile(slug, diagram.index, theme);
      inertSvg(svg, file);
      writeFileSync(join(dir, file), `${hashComment(sourceHash(diagram.source))}\n${svg}\n`);
      console.log(`${layout ? 'drew' : 'rendered'} ${relative(root, join(dir, file))}`);
    }
    if (model) {
      writeLabels(dir, slug, diagram, schemaLabels(model));
      console.log(`wrote ${relative(root, join(dir, labelsFile(slug, diagram.index)))}`);
    } else if (existsSync(join(dir, labelsFile(slug, diagram.index)))) {
      remove(dir, labelsFile(slug, diagram.index));
    }
  }
} finally {
  await browser.close();
}
