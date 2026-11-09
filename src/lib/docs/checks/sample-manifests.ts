// The verified samples' manifests, for docs:check (src/lib/docs/sample-manifests.ts,
// ADR-0052).
//
// From the source: _data/samples.json is well formed, describes every sample
// language (and every `env=<name>` a page uses), and records the pins
// scripts/samples/setup.sh holds now, so a pin bumped without a replay is
// caught; every published page's manifests can be made, and each one's code,
// output, SHA-256s and client version are its page's fence and its sidecar
// entry, byte for byte.
//
// With --built: /docs/samples.json and every manifest in dist/ are the bytes
// this build makes; no other file sits under a page's samples/ directory;
// and each manifest agrees with what the build served for its page: the HTML
// page holds the program (its copy textarea) and the output byte for byte,
// escaped, and links the manifest; the twin lists the manifest in its
// `samples` frontmatter and holds the program and the output.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { esc } from '../../cookbook/result-view.ts';
import { ROOT } from '../content.ts';
import { pageUrl, twinUrl } from '../model.ts';
import {
  manifestText,
  pageSampleManifests,
  SAMPLES_DATA_FILE,
  SAMPLES_INDEX_PATH,
  samplesDataProblems,
  samplesIndex,
  samplesIndexText,
  samplesWithSections,
  SETUP_SCRIPT,
  setupPins,
  type SampleManifest,
  type SamplesData,
} from '../sample-manifests.ts';
import { readSidecar, sampleSourceHash } from '../samples.ts';
import type { Report, SamplesSite } from './samples.ts';

const RULE = 'sample-manifest';
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** HTML text with its character references resolved (the five the build writes, and numeric ones). */
export const unescapeHtml = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const rel = (file: string) => relative(ROOT, file);

/** docs:check for the manifests; `builtDist` adds the dist/ half. Returns the manifests it made (for the built half and tests). */
export function checkSampleManifests(site: SamplesSite, report: Report, builtDist: string | null = null): SampleManifest[] {
  const err = (file: string, line: number | null, message: string) => report(file, line, 'error', RULE, message);

  let data: SamplesData;
  try {
    const raw = JSON.parse(readFileSync(SAMPLES_DATA_FILE, 'utf8')) as unknown;
    const problems = samplesDataProblems(raw);
    for (const p of problems) err(SAMPLES_DATA_FILE, null, p);
    if (problems.length) return [];
    data = raw as SamplesData;
  } catch (e) {
    err(SAMPLES_DATA_FILE, null, existsSync(SAMPLES_DATA_FILE) ? `is not JSON: ${(e as Error).message}` : 'is missing: it records what the samples were last replayed with');
    return [];
  }

  const pins = setupPins();
  for (const key of Object.keys(pins) as (keyof SamplesData['pins'])[]) {
    if (JSON.stringify(pins[key]) !== JSON.stringify(data.pins[key])) {
      err(
        SAMPLES_DATA_FILE,
        null,
        `pins.${key} is ${JSON.stringify(data.pins[key])}, but ${rel(SETUP_SCRIPT)} pins ${JSON.stringify(pins[key])}: replay the samples with the new pins (npm run docs:samples) and record what they ran with here`,
      );
    }
  }

  const manifests: SampleManifest[] = [];
  for (const page of [...site.published.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const source = readFileSync(page.file, 'utf8');
    const list = samplesWithSections(source, page.id);
    if (!list?.length) continue; // No samples, or problems checkSamples reports.
    let sidecar;
    try {
      sidecar = readSidecar(page.file);
    } catch {
      continue; // checkSamples reports an unreadable sidecar.
    }
    // A sample without a record is checkSamples' error; its page gets no manifests until it has one.
    if (list.some(({ sample }) => sidecar?.cells[sample.id]?.kind !== 'text')) continue;
    for (const { sample } of list) {
      if (sample.env && !data.clients.python.envs?.[sample.env]) {
        err(page.file, sample.line, `sample \`${sample.id}\` runs in env=${sample.env}, which ${rel(SAMPLES_DATA_FILE)} clients.python.envs does not describe`);
      }
    }
    let made: SampleManifest[];
    try {
      made = pageSampleManifests({ id: page.id, file: page.file, title: String(page.data.title ?? page.id) }, site.engine, data, sidecar);
    } catch (e) {
      err(page.file, null, `its sample manifests cannot be made: ${(e as Error).message}`);
      continue;
    }
    for (const [i, m] of made.entries()) {
      const s = list[i].sample;
      const entry = sidecar!.cells[s.id];
      const where = (what: string) => `sample \`${s.id}\`: the manifest's ${what}`;
      if (m.id !== s.id || m.language !== s.lang) err(page.file, s.line, where(`id or language is ${m.id}/${m.language}, not ${s.id}/${s.lang}`));
      if (m.code !== s.code) err(page.file, s.line, where('code is not the fence byte for byte'));
      if (m.code_sha256 !== sha256(s.code)) err(page.file, s.line, where('code_sha256 is not the SHA-256 of the fence'));
      if (m.output.text !== entry.text) err(page.file, s.line, where('output is not the recorded output byte for byte'));
      if (m.output.sha256 !== sha256(entry.text)) err(page.file, s.line, where('output.sha256 is not the SHA-256 of the recorded output'));
      if (m.source_sha256 !== entry.source_sha256 || m.source_sha256 !== sampleSourceHash(s)) err(page.file, s.line, where('source_sha256 is not the program\'s as recorded and as it reads now'));
      if (m.verified.version !== entry.verified) err(page.file, s.line, where(`client version is ${m.verified.version}, not the record's ${entry.verified}`));
      manifests.push(m);
    }
  }

  if (builtDist) checkBuiltSampleManifests(builtDist, manifests, site, data, report);
  return manifests;
}

/** Every file under a `samples/` directory below dist/docs/, site-relative. */
function servedManifestPaths(dist: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, underSamples: boolean) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, name === 'samples');
      else if (underSamples) out.push(`/${relative(dist, path).split('\\').join('/')}`);
    }
  };
  const docs = join(dist, 'docs');
  if (existsSync(docs)) walk(docs, false);
  return out.sort();
}

/** The --built half: dist/ serves exactly these manifests, and each agrees with its page's HTML and twin. */
export function checkBuiltSampleManifests(dist: string, manifests: SampleManifest[], site: SamplesSite, data: SamplesData, report: Report): void {
  const err = (file: string, message: string) => report(file, null, 'error', RULE, message);
  const at = (path: string) => join(dist, path.replace(/^\//, ''));
  const read = (path: string) => (existsSync(at(path)) ? readFileSync(at(path), 'utf8') : null);

  const index = read(SAMPLES_INDEX_PATH);
  if (index === null) err(at(SAMPLES_INDEX_PATH), `${SAMPLES_INDEX_PATH} was not built`);
  else if (index !== samplesIndexText(samplesIndex(manifests, site.engine, data))) err(at(SAMPLES_INDEX_PATH), `differs from the index this source makes; rebuild`);

  const expected = new Set<string>();
  const byPage = new Map<string, SampleManifest[]>();
  for (const m of manifests) {
    const path = new URL(m.url).pathname;
    expected.add(path);
    byPage.set(m.page.id, [...(byPage.get(m.page.id) ?? []), m]);
    const served = read(path);
    if (served === null) {
      err(at(path), `${path} was not built`);
      continue;
    }
    if (served !== manifestText(m)) err(at(path), `differs from the manifest this source makes for ${m.page.id} sample \`${m.id}\`; rebuild`);
  }
  for (const path of servedManifestPaths(dist)) {
    if (!expected.has(path)) err(at(path), `${path} is under a samples/ directory but is no sample's manifest`);
  }

  for (const [id, list] of byPage) {
    const htmlPath = `${pageUrl(id)}index.html`;
    const html = read(htmlPath);
    if (html === null) err(at(htmlPath), `the page of ${list.length} sample manifest(s) was not built`);
    const twin = read(twinUrl(id));
    if (twin === null) err(at(twinUrl(id)), 'the twin was not built');
    // Every code block's copy text, unescaped (the build re-serializes entities, so compare text, not markup).
    const programs = new Set([...(html ?? '').matchAll(/<textarea id="code-\d+" hidden>([\s\S]*?)<\/textarea>/g)].map((x) => unescapeHtml(x[1])));
    let listed: unknown = null;
    if (twin !== null) {
      const front = /^---\n([\s\S]*?)\n---\n/.exec(twin);
      listed = front ? (parseYaml(front[1]) as Record<string, unknown>)?.samples : null;
      const urls = list.map((m) => m.url);
      if (JSON.stringify(listed) !== JSON.stringify(urls)) err(at(twinUrl(id)), `its frontmatter \`samples\` is ${JSON.stringify(listed)}, not the page's manifests in order (${urls.join(', ')})`);
    }
    for (const m of list) {
      const path = new URL(m.url).pathname;
      if (html !== null) {
        if (!html.includes(`href="${esc(path)}"`)) err(at(htmlPath), `does not link sample \`${m.id}\`'s manifest ${path}`);
        if (!programs.has(m.code)) err(at(htmlPath), `does not hold sample \`${m.id}\`'s program as its manifest gives it`);
        const shown = new RegExp(`<pre class="out-text" id="out-${escapeRegExp(m.id)}">([\\s\\S]*?)</pre>`).exec(html)?.[1];
        if (shown === undefined || unescapeHtml(shown) !== m.output.text.replace(/\n$/, '')) err(at(htmlPath), `does not show sample \`${m.id}\`'s output as its manifest gives it`);
      }
      if (twin !== null) {
        const codeAt = twin.indexOf(`\n${m.code}\n`);
        if (codeAt < 0) err(at(twinUrl(id)), `does not hold sample \`${m.id}\`'s program as its manifest gives it`);
        else if (!twin.slice(codeAt).includes(`text\n${m.output.text.replace(/\n$/, '')}\n`)) err(at(twinUrl(id)), `does not hold sample \`${m.id}\`'s output after its program as its manifest gives it`);
      }
    }
  }
}
