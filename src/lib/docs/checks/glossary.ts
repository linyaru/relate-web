// The glossary checks of DOCS-PLAN.md §4.11, for docs:check (scripts/docs.ts
// calls each one; the glossary itself is src/lib/docs/glossary.ts):
//
//   - the files: `id` matches the file name and uses [a-z0-9-]; `term` is set;
//     the Short-definitions rule (one sentence, under 160 characters, plain
//     text, ends with a period, does not start with the term); `context` is
//     one of the six; `related` names other terms; an alias is neither the
//     term, another term, nor another term's alias; `see` resolves (through
//     the caller, which owns link resolution); the body (the full definition)
//     is present and renders: no headings, block directives, JSX or images,
//     every `:term` inside it names a term, every fence has a language
//   - Glossary links: every `:term[…]{id=…}` on a page names a term (also
//     enforced by the renderer and the docs graph; here with the page's line)
//   - Unused terms: a term no page links is reported (a warning)
//   - First use: a page whose prose uses a term three or more times and never
//     links it gets one warning naming each such term with its count; only
//     while the page links fewer terms than the Terms-section cap, since
//     past the cap the advice is to link fewer; FIRST_USE_IGNORED lists the
//     common words it does not count, with the reason
//   - Twin: the twin's `## Terms used on this page` section lists exactly the
//     page's linked terms, in order of first use, each with its short
//     definition
//
// The alias (banned-synonym) rules come from glossary.ts aliasRules; the word
// checks in scripts/docs.ts apply them to page prose and glossary bodies.

import { relative } from 'node:path';

import type { Code, Root, RootContent } from 'mdast';
import type { TextDirective } from 'mdast-util-directive';

import { ROOT } from '../content.ts';
import { bodyTree, CONTEXTS, readGlossary, shortProblems, termMatcher, type GlossaryEntry } from '../glossary.ts';
import { parsePage } from '../parse.ts';

export type Severity = 'error' | 'warning';
export type Report = (file: string, line: number | null, severity: Severity, rule: string, message: string) => void;
export type RefVerdict = { ok: true } | { ok: false; severity: Severity; message: string };

/** How often a page may use a term without linking it before First use warns (DOCS-PLAN.md §4.11). */
export const FIRST_USE_THRESHOLD = 3;

/**
 * Terms First use does not count, each for a stated reason, so the warning
 * names the vocabulary a reader meets cold rather than every common word:
 * words the pages also use in another sense (a file path, a list index, to
 * plan, to query, an HTTP client, a file extension, git's push, pull and
 * clone), and the basic graph and Cypher words every Cypher reader brings
 * (node, relationship, label, property, statement). They stay glossary
 * terms, and a page links them where the sentence needs the definition.
 */
export const FIRST_USE_IGNORED: ReadonlySet<string> = new Set([
  'path', 'index', 'plan', 'query', 'client', 'extension', 'push', 'pull', 'clone',
  'node', 'relationship', 'label', 'property', 'statement',
]);

/** What the glossary checks need of scripts/docs.ts's Site. */
export interface GlossarySite {
  /** Published page ids, generated pages included. */
  pages: Set<string>;
  /** The ids of glossary terms some page links with `:term`. */
  termsUsed: Set<string>;
}

/**
 * The `:term` ids a page body links, in order of first use, with the line of
 * each use. Read from the parsed page, as the renderer and the docs graph read
 * it, so a `:term[…]` shown inside a code fence or inline code is not a link.
 * A body that does not parse (docs:check reports that elsewhere) falls back to
 * a scan of its lines.
 */
export function linkedTerms(body: string): { id: string; line: number }[] {
  let tree: Root;
  try {
    tree = parsePage(body);
  } catch {
    const out: { id: string; line: number }[] = [];
    body.split('\n').forEach((text, i) => {
      for (const m of text.matchAll(/:term\[[^\]]*\]\{([^}]*)\}/g)) {
        out.push({ id: /(?:^|\s)id=["']?([^\s"'}]+)/.exec(m[1])?.[1] ?? '', line: i + 1 });
      }
    });
    return out;
  }
  const out: { id: string; line: number }[] = [];
  walk(tree, (n) => {
    if (n.type === 'textDirective' && (n as TextDirective).name === 'term') {
      out.push({ id: String((n as TextDirective).attributes?.id ?? ''), line: n.position?.start.line ?? 1 });
    }
  });
  return out;
}

/**
 * Every fenced or indented code block of a glossary body (`tree`, from
 * parsePage), nested ones included, with its language and its line in the
 * body. scripts/docs.ts runs the page fences' trust rules on each.
 */
export function bodyFences(tree: Root): { lang: string; value: string; line: number }[] {
  const out: { lang: string; value: string; line: number }[] = [];
  walk(tree, (n) => {
    if (n.type === 'code') out.push({ lang: (n as Code).lang ?? '', value: (n as Code).value, line: n.position?.start.line ?? 1 });
  });
  return out;
}

/**
 * A term file with its frontmatter replaced by as many empty lines, for Vale
 * (docs:lint): Vale lints front-matter string values, and a term's id, context
 * and see are lowercase identifiers its vocabulary case check flags. The body
 * keeps its line numbers. A file with no frontmatter comes back as it is.
 */
export function blankFrontmatter(text: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? '\n'.repeat(m[0].split('\n').length - 1) + text.slice(m[0].length) : text;
}

/** Depth-first, in document order. */
function walk(node: Root | RootContent, fn: (node: RootContent) => void): void {
  if (node.type !== 'root') fn(node);
  if ('children' in node) for (const child of node.children as RootContent[]) walk(child, fn);
}

/** The term files: frontmatter, the Short-definitions rule, the body. `pageRef` resolves a `see` reference. */
export function checkGlossaryFiles(site: GlossarySite, report: Report, pageRef: (ref: string) => RefVerdict, entries: GlossaryEntry[] = readGlossary()): void {
  const ids = new Set(entries.map((e) => e.id));
  const termOwner = new Map(entries.map((e) => [e.term.toLowerCase(), e.id]));
  const aliasOwner = new Map<string, string>();
  for (const e of entries) {
    const err = (msg: string, line: number | null = 1) => report(e.file, line, 'error', 'glossary', msg);
    const stem = e.file.split(/[\\/]/).pop()!.replace(/\.mdx$/, '');
    if (e.id !== stem) err(`\`id: ${e.id}\` differs from the file name (${stem}.mdx)`);
    if (!/^[a-z0-9-]+$/.test(e.id)) err(`\`id: ${e.id}\` uses lowercase letters, digits and - only`);
    if (!e.term.trim()) err('`term` is required');
    for (const p of shortProblems(e.term, e.short)) err(p);
    if (!(CONTEXTS as readonly string[]).includes(e.context)) err(`\`context: ${e.context}\` is not one of ${CONTEXTS.join(', ')}`);
    for (const r of e.related) {
      if (r === e.id) err(`\`related\` lists the term itself`);
      else if (!ids.has(r)) err(`related term \`${r}\` has no _glossary/${r}.mdx`);
    }
    for (const raw of e.aliases) {
      const a = raw.trim().toLowerCase();
      if (!a) err('an empty alias');
      else if (a === e.term.toLowerCase() && raw.trim() === e.term) err(`alias "${raw}" is the term itself`);
      else if (termOwner.has(a) && termOwner.get(a) !== e.id) err(`alias "${raw}" is the term \`${termOwner.get(a)}\`; an alias is a spelling the docs avoid`);
      else if (aliasOwner.has(a) && aliasOwner.get(a) !== e.id) err(`alias "${raw}" is also an alias of \`${aliasOwner.get(a)}\`; a banned spelling has one preferred term`);
      aliasOwner.set(a, e.id);
    }
    if (e.see === null) err('`see` is required: the page id that owns the detail');
    else {
      const verdict = pageRef(e.see);
      if (!verdict.ok) report(e.file, 1, verdict.severity, verdict.severity === 'error' ? 'glossary' : 'link-pending', `see: ${verdict.message}`);
    }
    if (!e.body) report(e.file, null, 'error', 'glossary-body', 'the full definition (the body under the frontmatter) is empty; write two to four paragraphs (DOCS-PLAN.md §4.11)');
    else {
      const { problems } = bodyTree(e, 'markdown', site.pages, ids);
      for (const p of problems) report(e.file, null, 'error', 'glossary-body', p);
    }
  }
}

/** Glossary links on one page: every `:term` id names a term. */
export function checkGlossaryLinks(file: string, body: string, bodyOffset: number, ids: Set<string>, report: Report): void {
  for (const { id, line } of linkedTerms(body)) {
    if (!id) report(file, line + bodyOffset, 'error', 'glossary-link', '`:term[…]` needs an id: `:term[label]{id=<glossary id>}`');
    else if (!ids.has(id)) report(file, line + bodyOffset, 'error', 'glossary-link', `\`:term\` id \`${id}\` names no glossary term (src/content/docs/_glossary/${id}.mdx)`);
  }
}

/** Unused terms: each term no page links, reported. */
export function checkUnusedTerms(site: GlossarySite, report: Report, entries: GlossaryEntry[] = readGlossary()): void {
  for (const e of entries) {
    if (!site.termsUsed.has(e.id)) report(e.file, 1, 'warning', 'glossary-unused', `no page links \`${e.id}\` with :term[…]{id=${e.id}}`);
  }
}

/**
 * First use: the terms `prose` (a page's paragraphs, list items and table
 * cells, inline code already replaced) uses at least FIRST_USE_THRESHOLD
 * times that the page never links, most used first. Empty when the page
 * already links `cap` terms or more.
 */
export function firstUseMisses(prose: string[], linked: Set<string>, cap: number, entries: GlossaryEntry[] = readGlossary()): { id: string; term: string; count: number }[] {
  if (linked.size >= cap) return [];
  const text = prose.join('\n');
  const out: { id: string; term: string; count: number }[] = [];
  for (const e of entries) {
    if (linked.has(e.id) || FIRST_USE_IGNORED.has(e.id)) continue;
    const count = [...text.matchAll(termMatcher(e.term))].length;
    if (count >= FIRST_USE_THRESHOLD) out.push({ id: e.id, term: e.term, count });
  }
  return out.sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1));
}

/** The First-use warning for a page, or nothing. */
export function checkFirstUse(file: string, prose: string[], linked: Set<string>, cap: number, report: Report, entries?: GlossaryEntry[]): void {
  const misses = firstUseMisses(prose, linked, cap, entries);
  if (!misses.length) return;
  const list = misses.map((m) => `"${m.term}" ${m.count}× (\`:term[…]{id=${m.id}}\`)`).join(', ');
  report(file, null, 'warning', 'glossary-first-use', `uses ${list} without a glossary link; link the first use of the one a reader most needs (DOCS-PLAN.md §4.11)`);
}

/** The `- **term**: short` lines of a twin's Terms section, or null when it has none. */
export function twinTermsSection(markdown: string): string[] | null {
  const m = /\n## Terms used on this page\n\n([\s\S]*?)(?=\n## |\s*$)/.exec(markdown);
  if (!m) return null;
  return m[1].split('\n').filter((l) => l.trim());
}

/**
 * The Twin check: the Terms section lists exactly the page's linked terms
 * (`linked`, in order of first use), each as `- **<term>**: <short>`. Returns
 * the problems.
 */
export function twinTermsProblems(markdown: string, linked: string[], glossary: Map<string, { term: string; short: string }>): string[] {
  const want = [...new Set(linked)].filter((id) => glossary.has(id)).map((id) => `- **${glossary.get(id)!.term}**: ${glossary.get(id)!.short}`);
  const have = twinTermsSection(markdown);
  if (!want.length) return have === null ? [] : ['the twin has a "Terms used on this page" section, but the page links no glossary term'];
  if (have === null) return [`the page links ${want.length} glossary term(s), but the twin has no "Terms used on this page" section`];
  const problems: string[] = [];
  for (const w of want) if (!have.includes(w)) problems.push(`the twin's Terms section lacks or misstates "${w.slice(0, 70)}"`);
  for (const h of have) if (!want.includes(h)) problems.push(`the twin's Terms section lists "${h.slice(0, 70)}", which the page does not link`);
  if (!problems.length && have.join('\n') !== want.join('\n')) problems.push("the twin's Terms section is not in the order the page first links its terms");
  return problems;
}

/** A file path for messages, relative to the repository. */
export const relFile = (file: string) => relative(ROOT, file);
