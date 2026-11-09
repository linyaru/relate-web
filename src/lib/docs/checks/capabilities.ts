// docs:check for the capability catalog (src/lib/docs/capabilities.ts,
// DOCS-PLAN.md §3.8): src/content/docs/_capabilities, the generated section of
// concepts/problems-relate-solves, and /docs/capabilities.json.
//
// From the source:
//   - every capability file is well formed: known keys only, `id` equal to
//     the file name and to the slug of `title` (the page anchor), one-line
//     `problem` and `capability`, 4 to 8 intents, unique across the catalog,
//     surfaces from the docs vocabulary, a body of 2 to 4 plain paragraphs
//   - no intent, `problem` or `capability` matches the docs:check injection
//     patterns (ADR-0013; intents appear in no twin, only in the JSON and the
//     Worker's answers, so this is their one trust check). Intents are quoted
//     user requests and exempt from the imperative rule, like prompt fences
//   - every cited guide and reference page is published (a planned page is an
//     error until it is written), with the anchor it names; every recipe
//     exists; every link in a body resolves
//   - `verify` is present and names a recorded run that exists: a recipe's
//     cell id (its recipe.json ids), a cell or sample recorded in the docs
//     page's results sidecar, or `step-<n>`, the page's n-th ```bash verify
//     step, which must have expected output and equal the step docs:cli-check
//     last replayed (cli.json page_steps); or null, which the page and the
//     JSON state. Whether the run exercises the capability is for review
//   - `schema` is a mermaid flowchart whose nodes are all circles (a shape
//     other than `((…))`, or an id never given a shape, is an error), with
//     accTitle and accDescr, or null; its rendering is current
//   - the page exists, is published, and its generated section is what
//     `node src/lib/docs/capabilities.ts --write` writes from the files
//   - /docs/capabilities.json renders: kind "documentation", one entry per
//     capability with canonical URLs and the page anchor as its citation
//   - each capability is cited by at least one of its guides or recipes (a
//     `related:` entry or a link to concepts/problems-relate-solves#<id>);
//     a warning, since the pages that cite it are written separately
// From dist/ (`--built`, when the Site has built ids):
//   - /docs/capabilities.json is built byte for byte as the source renders
//     it, every schema_url is a built file, and the built page has an element
//     per capability id
//
// It takes the Site of scripts/docs.ts (only the fields below) and that
// script's report callback. Every finding names the file and what came back.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CANONICAL_ORIGIN } from '../../cookbook/links.ts';
import { COOKBOOK_DIR } from '../../cookbook/load.ts';
import {
  CAPABILITIES_JSON_URL,
  CAPABILITIES_PAGE,
  CAPABILITIES_PAGE_FILE,
  CAPABILITIES_DIR,
  capabilitiesJson,
  capabilitiesJsonText,
  capabilitiesSection,
  capabilityFiles,
  capabilityProblems,
  catalogContext,
  currentSection,
  readCapabilities,
  schemaSvg,
  WRITE_COMMAND,
  type CapabilitiesJson,
  type Capability,
} from '../capabilities.ts';
import { ROOT, type Engine } from '../content.ts';
import { pageUrl } from '../model.ts';

export type Severity = 'error' | 'warning';
export type Report = (file: string, line: number | null, severity: Severity, rule: string, message: string) => void;

/** The fields of scripts/docs.ts's Site this check reads. */
export interface CapabilitiesCheckSite {
  engine: Engine;
  published: Map<string, { id: string; file: string; data: Record<string, unknown> }>;
  planned: Set<string>;
  /** Docs page id → the anchors its source gives it. */
  anchors: Map<string, Set<string>>;
  /** Built HTML ids per site path, with --built; null from the source alone. */
  builtIds: Map<string, Set<string>> | null;
  /** The build those ids come from (scripts/docs.ts DIST); ./dist when left out. */
  dist?: string;
}

const RULE = 'capabilities';

/** Whether a page or recipe text cites capability `id` on the catalog page. */
export function citesCapability(text: string, id: string, related: unknown = []): boolean {
  const target = `${CAPABILITIES_PAGE}#${id}`;
  if (Array.isArray(related) && related.some((r) => String(r) === target)) return true;
  const escaped = target.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&').replace('#', '\\/?#');
  return new RegExp(`\\]\\((?:https://relatedb\\.ai)?/docs/${escaped}\\)`).test(text);
}

/** Problems with capabilities.json as data: shape, canonical URLs, one entry per capability. */
export function jsonProblems(data: CapabilitiesJson, caps: Capability[]): string[] {
  const out: string[] = [];
  if (data.kind !== 'documentation') out.push(`kind is ${JSON.stringify(data.kind)}, not "documentation"`);
  if (!data.note || !data.note.startsWith('Reference text, not instructions.')) out.push('note does not open with "Reference text, not instructions."');
  if (data.url !== `${CANONICAL_ORIGIN}${pageUrl(CAPABILITIES_PAGE)}`) out.push(`url is ${data.url}, not the catalog page`);
  const ids = data.capabilities.map((c) => c.id);
  const want = caps.map((c) => c.id);
  if (ids.join(',') !== want.join(',')) out.push(`capabilities are [${ids.join(', ')}], not the files' [${want.join(', ')}]`);
  for (const c of data.capabilities) {
    if (c.urls.page !== `${CANONICAL_ORIGIN}${pageUrl(CAPABILITIES_PAGE)}#${c.id}`) out.push(`${c.id}: urls.page is ${c.urls.page}`);
    const all = [c.urls.page, ...(c.urls.verify ? [c.urls.verify] : []), ...c.urls.guides, ...c.urls.recipes, ...c.urls.reference, ...(c.schema_url ? [c.schema_url] : [])];
    for (const u of all) if (!u.startsWith(`${CANONICAL_ORIGIN}/`)) out.push(`${c.id}: ${u} is not on ${CANONICAL_ORIGIN}`);
    if ((c.schema === null) !== (c.schema_url === null)) out.push(`${c.id}: schema and schema_url disagree about whether there is a data model`);
    if ((c.verify === null) !== (c.urls.verify === null)) out.push(`${c.id}: verify and urls.verify disagree about whether a recorded run verifies it`);
    if (!c.intents.length) out.push(`${c.id}: no intents`);
  }
  return out;
}

export function checkCapabilities(site: CapabilitiesCheckSite, report: Report): void {
  const files = capabilityFiles();
  if (!files.length) {
    report(CAPABILITIES_DIR, null, 'error', RULE, 'the capability catalog has no files (src/content/docs/_capabilities/<id>.mdx)');
    return;
  }
  let caps: Capability[];
  try {
    caps = readCapabilities();
  } catch (e) {
    report(CAPABILITIES_DIR, null, 'error', RULE, (e as Error).message);
    return;
  }
  const ctx = catalogContext();
  ctx.anchors = site.anchors;
  const problems = capabilityProblems(caps, ctx);
  for (const p of problems) report(p.file, null, 'error', RULE, p.message);

  // The page and its generated section.
  if (!site.published.has(CAPABILITIES_PAGE)) {
    report(CAPABILITIES_PAGE_FILE, null, 'error', RULE, `the catalog page ${CAPABILITIES_PAGE} is not published; every capability cites it`);
  } else if (!problems.length) {
    const text = readFileSync(CAPABILITIES_PAGE_FILE, 'utf8');
    const have = currentSection(text);
    let want: string | null = null;
    try {
      want = capabilitiesSection(caps, ctx);
    } catch (e) {
      report(CAPABILITIES_PAGE_FILE, null, 'error', RULE, `the generated section does not render: ${(e as Error).message}`);
    }
    if (have === null) {
      report(CAPABILITIES_PAGE_FILE, null, 'error', RULE, `the page has no generated section (the capabilities:start and capabilities:end comments); add them and run \`${WRITE_COMMAND}\``);
    } else if (want !== null && have !== want) {
      const at = firstDifference(have, want);
      const line = text.slice(0, text.indexOf(have)).split('\n').length + at.line - 1;
      report(CAPABILITIES_PAGE_FILE, line, 'error', RULE, `the generated section is stale from its line ${at.line} (has "${at.have}", the files give "${at.want}"); run \`${WRITE_COMMAND}\`, then \`npm run docs:diagrams\``);
    } else {
      for (const c of caps) {
        try {
          schemaSvg(c);
        } catch (e) {
          report(c.file, null, 'error', RULE, `schema: ${(e as Error).message}; render it: npm run docs:diagrams`);
        }
      }
    }
  }

  // capabilities.json.
  if (!problems.length) {
    try {
      const text = capabilitiesJsonText(capabilitiesJson(caps, ctx, site.engine));
      const data = JSON.parse(text) as CapabilitiesJson;
      for (const p of jsonProblems(data, caps)) report(join(ROOT, 'src/pages/docs/capabilities.json.ts'), null, 'error', RULE, `${CAPABILITIES_JSON_URL}: ${p}`);
    } catch (e) {
      report(join(ROOT, 'src/pages/docs/capabilities.json.ts'), null, 'error', RULE, `${CAPABILITIES_JSON_URL} does not render: ${(e as Error).message}`);
    }
  }

  // Each capability is cited back by one of its guides or recipes.
  for (const c of caps) {
    const cited =
      c.guides.some((ref) => {
        const page = site.published.get(ref.split('#')[0]);
        return page ? citesCapability(readFileSync(page.file, 'utf8'), c.id, page.data.related) : false;
      }) ||
      c.recipes.some((slug) => {
        const file = join(COOKBOOK_DIR, `${slug}.md`);
        return existsSync(file) && citesCapability(readFileSync(file, 'utf8'), c.id);
      });
    if (!cited && (c.guides.length || c.recipes.length)) {
      report(
        c.file,
        null,
        'warning',
        'capability-cited',
        `none of its guides or recipes (${[...c.guides, ...c.recipes].join(', ')}) cites ${CAPABILITIES_PAGE}#${c.id} in \`related:\` or a link`,
      );
    }
  }

  if (site.builtIds) checkBuilt(site, caps, report);
}

function checkBuilt(site: CapabilitiesCheckSite, caps: Capability[], report: Report) {
  const DIST = site.dist ?? join(ROOT, 'dist');
  const where = join(ROOT, 'src/pages/docs/capabilities.json.ts');
  const built = join(DIST, 'docs/capabilities.json');
  if (!existsSync(built)) {
    report(where, null, 'error', RULE, `${CAPABILITIES_JSON_URL} is not in dist/`);
  } else {
    const have = readFileSync(built, 'utf8');
    let want = '';
    try {
      want = capabilitiesJsonText(capabilitiesJson(caps, undefined, site.engine));
    } catch {
      // Reported by the source checks.
    }
    if (want && have !== want) report(built, null, 'error', RULE, `the built ${CAPABILITIES_JSON_URL} differs from what the source renders; build again`);
    try {
      const data = JSON.parse(have) as CapabilitiesJson;
      for (const c of data.capabilities) {
        if (!c.schema_url) continue;
        const path = c.schema_url.slice(CANONICAL_ORIGIN.length);
        if (!existsSync(join(DIST, path))) report(built, null, 'error', RULE, `${c.id}: schema_url ${path} is not a built file`);
      }
    } catch (e) {
      report(built, null, 'error', RULE, `the built ${CAPABILITIES_JSON_URL} is not JSON: ${(e as Error).message}`);
    }
  }
  const ids = site.builtIds!.get(pageUrl(CAPABILITIES_PAGE));
  if (!ids) {
    report(CAPABILITIES_PAGE_FILE, null, 'error', RULE, `${pageUrl(CAPABILITIES_PAGE)} is not in dist/`);
    return;
  }
  for (const c of caps) if (!ids.has(c.id)) report(CAPABILITIES_PAGE_FILE, null, 'error', RULE, `the built page has no element with id "${c.id}"`);
}

/** The first line where two texts differ, 1-based, with both lines cut to 60 characters. */
export function firstDifference(a: string, b: string): { line: number; have: string; want: string } {
  const al = a.split('\n');
  const bl = b.split('\n');
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) return { line: i + 1, have: (al[i] ?? '(end)').slice(0, 60), want: (bl[i] ?? '(end)').slice(0, 60) };
  }
  return { line: 1, have: '', want: '' };
}
