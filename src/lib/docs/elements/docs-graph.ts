// `:::docs-graph`: the docs graph, live (DOCS-PLAN.md §7.3, §3.5; on
// reference/docs-graph). Its static form holds what changes only when a page
// is added, removed or moved to another section: how many published pages
// each section has, how the live view treats each node label and
// relationship type, and a picture of the pages where the live view first
// draws them (_docs-graph-view.ts lays both out, so the picture is the live
// view's first frame without its lines). Links, terms and counts change with
// nearly every edit of any page; a recorded form that held them would go
// stale on each, and with it this page's section embedding, so the live view
// draws them from /docs/graph-view.json, which the site builds with every
// deploy. The browser module adds search, kind toggles, an inspector and a
// click through to each page; it runs no engine.
//
// The form reads the docs collection, not the page's recordings, so the
// framework's hash cannot see it go stale. `validate` closes that gap: in
// docs:check it rebuilds the form and fails when the recorded text or
// picture differs, naming the --record command. During --record it skips
// that comparison (the record is what fixes it).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bothThemes, esc, markdownTable, measure, outline, svgFrame } from '../element-kit.ts';
import { elementFormFile, elementSvgFile, type ElementInput, type ElementSpec, type StaticForm } from '../elements.ts';
import { docsGraph, LABELS, REL_TYPES } from '../graph.ts';
import { pageDiagrams } from '../results.ts';
import { docsGraphView, HIDDEN_RELS, LEFT_OUT, PAGE_RELS, VIEW_KINDS, type DocsGraphView, type ViewSection } from './_docs-graph-view.ts';

const ATTRIBUTES = new Set(['id']);
const CAPTION = 'The published docs pages, one cluster per section, where the live view first draws them';

let cachedView: DocsGraphView | null = null;
/** The view of the docs graph as the files on disk give it, once per process (docs:check and --record build the graph once each). */
const view = () => (cachedView ??= docsGraphView(docsGraph({ cache: true })));

const fmt = (n: number) => n.toLocaleString('en-US');

/** The sections' page counts, and how the live view treats each label and relationship type: nothing that a link or a term changes. */
function summary(v: DocsGraphView): string {
  const pages = v.sections.reduce((t, s) => t + s.pages, 0);
  const kindRow = (label: (typeof LABELS)[number]) => {
    const k = VIEW_KINDS.find((x) => x.label === label);
    const where = !k
      ? (LEFT_OUT[label] ?? 'left out')
      : k.ring === 0
        ? 'drawn at first: each published page, colored by section (planned pages are not drawn)'
        : `a toggle, on the ${RING_NAMES[k.ring - 1] ?? 'outer'} ring around the pages`;
    return [`\`${label}\``, where];
  };
  const pageRel = new Map(PAGE_RELS.map((r) => [r.type, r]));
  const relRow = (type: (typeof REL_TYPES)[number]) => {
    const r = pageRel.get(type);
    const where = HIDDEN_RELS.has(type) ? 'not drawn: its far end is a kind the view leaves out' : r ? `a toggle, ${r.on ? 'on' : 'off'} at first` : 'drawn when both ends are';
    return [`\`${type}\``, where];
  };
  return [
    `The live view draws the ${fmt(pages)} published pages, one cluster per section: ${v.sections.map((s) => `${s.label} ${fmt(s.pages)}`).join(', ')}. The picture places them where the live view first draws them. The links and prerequisites between them, and the number of nodes and relationships of each kind, change with nearly every edit, so the live view draws and counts them from the data the site is built with; the seed script's header lists the same counts.`,
    '',
    markdownTable(['Label', 'In the live view'], LABELS.map(kindRow)),
    '',
    markdownTable(['Relationship', 'In the live view'], REL_TYPES.map(relRow)),
  ].join('\n');
}

/** The rings around the page clusters, nearest first, as the text names them. */
const RING_NAMES = ['nearest', 'middle', 'outermost'];

/** The pages-by-section picture, both themes: where the live view first draws each page. */
function picture(v: DocsGraphView, id: string): Required<Pick<StaticForm, 'svgLight' | 'svgDark'>> {
  const r = 7;
  const labelSize = 18;
  const pages = v.nodes.filter((n) => n.label === 'Page');
  const label = (s: ViewSection) => `${s.label} (${fmt(s.pages)})`;
  const shown = v.sections.filter((s) => s.pages > 0);
  // Each cluster's box, its label under it included; the frame holds them all.
  const boxes = shown.map((s) => {
    const half = Math.max(s.r, measure(label(s), { size: labelSize, weight: 600 }) / 2);
    return { left: s.x - half, right: s.x + half, top: s.y - s.r, bottom: s.y + s.r + 12 + labelSize };
  });
  const pad = 12;
  const minX = Math.floor(Math.min(...boxes.map((b) => b.left))) - pad;
  const minY = Math.floor(Math.min(...boxes.map((b) => b.top))) - pad;
  const width = Math.ceil(Math.max(...boxes.map((b) => b.right))) + pad - minX;
  const height = Math.ceil(Math.max(...boxes.map((b) => b.bottom))) + pad - minY;
  const dots = pages.map((n) => `<circle class="s-${n.section}" cx="${n.x - minX}" cy="${n.y - minY}" r="${r}"/>`).join('');
  // Each section's name and page count under its cluster: colour is never the only key.
  const labels = shown
    .map((s) => `<text class="sec" x="${s.x - minX}" y="${s.y + s.r + 12 + labelSize * 0.8 - minY}" text-anchor="middle">${esc(label(s))}</text>`)
    .join('');
  const desc =
    `${fmt(pages.length)} published pages as dots, one cluster per section, each labelled with its name and page count: ` +
    shown.map((s) => `${s.label} ${fmt(s.pages)}`).join(', ') +
    '. The live view draws the links between them over the same positions.';

  return bothThemes((theme, c) => {
    const sid = `${id}-${theme}`;
    const style =
      v.sections.map((s) => `#${sid} .s-${s.id}{fill:${s.color};stroke:${outline(s.color)};stroke-width:1.2}`).join('') +
      `#${sid} .sec{font-size:${labelSize}px;font-weight:600;fill:${c.fg}}`;
    return svgFrame({ id: sid, width, height, title: CAPTION, desc, style, body: `${dots}${labels}` });
  });
}

/** The form `staticForm` writes for the docs graph as it is now. */
function form(input: ElementInput): StaticForm {
  const v = view();
  return { text: summary(v), caption: CAPTION, ...picture(v, input.id) };
}

/** Whether this process is `node scripts/docs.ts --record`, which rewrites a stale form instead of reporting it. */
const recording = () => process.argv.includes('--record');

/** Problems when the recorded form differs from the one the docs graph gives now (none when there is no record: readForm reports that). */
function staleness(input: ElementInput): string[] {
  const { dir, stem } = pageDiagrams(input.page.file);
  const json = join(dir, elementFormFile(stem, input.id));
  const light = join(dir, elementSvgFile(stem, input.id, 'light'));
  if (!existsSync(json) || !existsSync(light)) return [];
  let recorded: { text?: unknown };
  try {
    recorded = JSON.parse(readFileSync(json, 'utf8'));
  } catch {
    return []; // readForm reports a malformed record
  }
  const now = form(input);
  const svg = readFileSync(light, 'utf8').split('\n').slice(1).join('\n').trim();
  const again = `run DOCS_ONLY=${input.page.id} node scripts/docs.ts --record`;
  if (recorded.text !== now.text.trim()) return [`the docs' published pages or sections changed since this static form was recorded (a page was added, removed, published or moved); ${again}`];
  if (svg !== now.svgLight!.trim()) return [`the docs' published pages changed since this static form's picture was laid out; ${again}`];
  return [];
}

export default {
  live: 'the view draws the pages with the links and prerequisites between them from `/docs/graph-view.json` and counts every kind; a search box enlarges the nodes whose title matches and dims the rest, toggles add glossary terms, capabilities and the other kinds, hovering a node shows its description and the nodes it is joined to, and a click opens its page.',
  engine: false,
  validate(input) {
    const out: string[] = [];
    for (const k of Object.keys(input.attributes)) if (!ATTRIBUTES.has(k)) out.push(`takes only \`id\`, not \`${k}\``);
    if (out.length || recording()) return out;
    return staleness(input);
  },
  staticForm: form,
} satisfies ElementSpec;
