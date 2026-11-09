// The glossary as data (DOCS-PLAN.md §4.11, ADR-0009): every term of
// src/content/docs/_glossary/<id>.mdx with its frontmatter and its body (the
// full definition), and what the rest of the docs derive from it:
//
//   - the full definition rendered twice from one tree, as HTML for the
//     generated glossary page and as markdown for its twin
//     (generated/glossary.ts): `:term[label]{id=…}` inside a body links the
//     other entry (`#<id>` on the page, the absolute URL in the twin), other
//     links resolve as on any page (links.ts);
//   - /docs/glossary.json, the machine form (src/pages/docs/glossary.json.ts);
//   - the Short-definitions rule, the alias (banned-synonym) rules and the
//     word matcher the First-use check counts with (checks/glossary.ts).
//
// Node-only (reads files), no astro:content, so the build, the twin endpoints
// and the checks read the same terms.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import MarkdownIt from 'markdown-it';
import type { Parent, PhrasingContent, Root, RootContent } from 'mdast';
import type { TextDirective } from 'mdast-util-directive';
import { toString } from 'mdast-util-to-string';

import { CANONICAL_ORIGIN } from '../cookbook/links.ts';
import { esc } from '../cookbook/result-view.ts';
import { GLOSSARY_DIR, splitFrontmatter } from './content.ts';
import { glossaryHref, GLOSSARY_ID } from './constructs.ts';
import { absoluteUrl, resolveHref } from './links.ts';
import { parsePage, stringifyMarkdown } from './parse.ts';

/** The contexts a term belongs to; `context` disambiguates a word with two meanings (a graph node, Node.js). */
export const CONTEXTS = ['cypher', 'storage', 'cli', 'agents', 'surfaces', 'engine'] as const;

/** The longest a `short` definition may be, exclusive (DOCS-PLAN.md §4.11). */
export const SHORT_MAX = 160;

export interface GlossaryEntry {
  id: string;
  term: string;
  short: string;
  aliases: string[];
  context: string;
  /** The page id (with an optional #anchor) that owns the detail. */
  see: string | null;
  related: string[];
  /** The full definition: the file's body, as authored (MDX without frontmatter). */
  body: string;
  /** The term's file (absolute). */
  file: string;
}

/** The glossary's files, sorted by name. */
export const glossaryFiles = (dir = GLOSSARY_DIR): string[] =>
  readdirSync(dir)
    .filter((n) => n.endsWith('.mdx'))
    .sort()
    .map((n) => join(dir, n));

const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** A term's sort key: the term without leading punctuation (`.rl` files under R), case ignored. */
export const sortKey = (term: string) => term.replace(/^[^\p{L}\p{N}]+/u, '');
const byTerm = (a: { term: string; id: string }, b: { term: string; id: string }) =>
  sortKey(a.term).localeCompare(sortKey(b.term), 'en', { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** One term file as an entry; its id defaults to the file name. */
export function readEntry(file: string): GlossaryEntry {
  const { data, body } = splitFrontmatter(readFileSync(file, 'utf8'), file);
  const id = typeof data.id === 'string' ? data.id : file.replace(/^.*\//, '').replace(/\.mdx$/, '');
  return {
    id,
    term: String(data.term ?? id),
    short: String(data.short ?? '').trim(),
    aliases: strings(data.aliases),
    context: String(data.context ?? ''),
    see: typeof data.see === 'string' ? data.see : null,
    related: strings(data.related),
    body: body.trim(),
    file,
  };
}

/** Every term, sorted by its term (leading punctuation and case ignored). */
export function readGlossary(dir = GLOSSARY_DIR): GlossaryEntry[] {
  return glossaryFiles(dir).map(readEntry).sort(byTerm);
}

/** The letter a term files under on the glossary page (`#` for one that starts with anything else). */
export function letterOf(term: string): string {
  const c = sortKey(term).charAt(0).toUpperCase();
  return /\p{L}/u.test(c) ? c : '#';
}

/** A term's anchor on the glossary page, absolute. */
export const termUrl = (id: string) => `${CANONICAL_ORIGIN}${glossaryHref(id)}`;

// ---------------------------------------------------------------------------
// The Short-definitions rule

/**
 * What is wrong with a `short` definition (DOCS-PLAN.md §4.11): one sentence,
 * under SHORT_MAX characters, plain text (code spans allowed; no links, no
 * markup), ends with a period, does not start with the term itself.
 */
export function shortProblems(term: string, short: string): string[] {
  const out: string[] = [];
  const s = short.trim();
  if (!s) return ['`short` is required'];
  if (s.length >= SHORT_MAX) out.push(`\`short\` is ${s.length} characters; keep it under ${SHORT_MAX}`);
  if (!s.endsWith('.')) out.push('`short` ends with a period');
  // Code spans may hold anything (`<port>`, `*`); the rules read the prose around them.
  const prose = s.replace(/`[^`]*`/g, 'CODE');
  if (/\]\(|https?:\/\/|<[a-z/!]/i.test(prose)) out.push('`short` is plain text: no links or HTML');
  if (/(^|[^\\])[*_]{1,2}\w[^*_]*\w[*_]{1,2}/.test(prose)) out.push('`short` is plain text: no emphasis');
  // One sentence: no sentence end followed by a capital, outside code spans.
  if (/[.!?]\s+[A-Z]/.test(prose.slice(0, -1))) out.push('`short` is one sentence');
  const bare = (x: string) => x.replace(/`/g, '').toLowerCase();
  if (term && bare(s).startsWith(bare(term)) && /^[^\p{L}\p{N}]?$/u.test(bare(s).charAt(bare(term).length))) {
    out.push('`short` does not start with the term itself');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aliases: the banned spellings

export interface AliasRule {
  /** The alias as written in the glossary. */
  alias: string;
  phrase: RegExp;
  /** The preferred term. */
  term: string;
  id: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One rule per alias. An alias matches as a word (not inside a longer word
 * or a hyphenated one), with an optional plural `s`/`es`. It matches in any
 * case, unless it carries a capital or differs from its term only by case
 * (`cypher` for Cypher, `OpenCypher` for openCypher): then exactly as written.
 */
export function aliasRules(entries: GlossaryEntry[]): AliasRule[] {
  const out: AliasRule[] = [];
  for (const e of entries) {
    for (const raw of e.aliases) {
      const alias = raw.trim();
      if (!alias) continue;
      const exact = /[A-Z]/.test(alias) || alias.toLowerCase() === e.term.toLowerCase();
      const pattern = escapeRe(alias).replace(/\s+/g, '\\s+');
      out.push({ alias, term: e.term, id: e.id, phrase: new RegExp(`(?<![\\w-])${pattern}(?:e?s)?(?![\\w-])`, exact ? 'g' : 'gi') });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// First use: counting a term in prose

/**
 * A matcher for the term as a word in prose: case-insensitive for an
 * all-lowercase term (a sentence may start with it), exact for one with
 * capitals (`WAL`, `Bolt`), never inside a longer word or a hyphenated one,
 * with an optional plural. Backticks in the term are dropped.
 */
export function termMatcher(term: string): RegExp {
  const t = term.replace(/`/g, '').trim();
  const pattern = escapeRe(t).replace(/\s+/g, '\\s+');
  const lead = /^[\p{L}\p{N}]/u.test(t) ? '(?<![\\p{L}\\p{N}_-])' : '(?<![\\p{L}\\p{N}_])';
  return new RegExp(`${lead}${pattern}(?:e?s)?(?![\\p{L}\\p{N}_-])`, /[A-Z]/.test(t) ? 'gu' : 'giu');
}

// ---------------------------------------------------------------------------
// The full definition

type Target = 'html' | 'markdown';

/**
 * The body's tree for `target`, with every term and link resolved, and what
 * is wrong with it. A body holds paragraphs, lists, code blocks and inline
 * markup: no headings (an entry is one heading's section in the twin, so a
 * heading would split it), no block directives, no JSX or expressions, no
 * images.
 */
export function bodyTree(entry: GlossaryEntry, target: Target, pages: Set<string>, ids: Set<string>): { tree: Root; problems: string[] } {
  const problems: string[] = [];
  let tree: Root;
  try {
    tree = parsePage(entry.body);
  } catch (e) {
    return { tree: { type: 'root', children: [] }, problems: [`the body is not valid MDX: ${(e as Error).message}`] };
  }
  const at = (n: { position?: { start: { line: number } } }) => `body line ${n.position?.start.line ?? '?'}`;
  const visit = (parent: Parent) => {
    const out: RootContent[] = [];
    for (const node of parent.children as RootContent[]) {
      switch (node.type) {
        case 'heading':
          problems.push(`${at(node)}: a heading in a glossary body; an entry is one section, so write a paragraph`);
          out.push({ type: 'paragraph', children: node.children });
          break;
        case 'containerDirective':
        case 'leafDirective':
          problems.push(`${at(node)}: \`${node.type === 'leafDirective' ? '::' : ':::'}${node.name}\` in a glossary body; bodies hold prose, lists and code only`);
          break;
        case 'mdxJsxFlowElement':
        case 'mdxJsxTextElement':
        case 'mdxFlowExpression':
        case 'mdxTextExpression':
        case 'mdxjsEsm':
          if ((node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') && /^\s*\/\*[\s\S]*\*\/\s*$/.test(node.value)) break;
          problems.push(`${at(node)}: JSX or an expression in a glossary body has no markdown form`);
          break;
        case 'image':
          problems.push(`${at(node)}: an image in a glossary body`);
          break;
        case 'code':
          if (!node.lang) problems.push(`${at(node)}: a fenced block without a language (\`text\` for output)`);
          if (/(?:^|\s)run\b/.test(node.meta ?? '')) problems.push(`${at(node)}: a \`run\` fence in a glossary body; cells belong on pages`);
          out.push(node);
          break;
        case 'textDirective':
          out.push(...termDirective(node, target, ids, problems, at(node)));
          break;
        case 'link': {
          visit(node);
          const href = resolveHref(node.url, { pages });
          if (href === null) out.push(...(node.children as RootContent[]));
          else out.push({ ...node, url: target === 'markdown' ? absoluteUrl(href) : href });
          break;
        }
        default:
          if ('children' in node) visit(node as Parent);
          out.push(node);
      }
    }
    parent.children = out as Parent['children'];
  };
  visit(tree);
  return { tree, problems };
}

function termDirective(node: TextDirective, target: Target, ids: Set<string>, problems: string[], where: string): RootContent[] {
  const label = toString(node);
  if (node.name === 'since' || node.name === 'status') return [{ type: 'text', value: node.name === 'since' ? `(since ${label})` : `(${label})` }];
  if (node.name !== 'term') {
    // `key:value` in prose that remark-directive read as a directive: the text as written.
    return [{ type: 'text', value: `:${node.name}${label ? `[${label}]` : ''}` }];
  }
  const id = node.attributes?.id;
  if (!id || !ids.has(id)) {
    problems.push(`${where}: \`:term[${label}]{id=${id ?? ''}}\` names no glossary term`);
    return [{ type: 'text', value: label }];
  }
  const url = target === 'markdown' ? termUrl(id) : `#${id}`;
  return [{ type: 'link', url, children: [{ type: 'text', value: label }] as PhrasingContent[] }];
}

/** The body as twin markdown: links absolute, terms linked to their entries. */
export function bodyMarkdown(entry: GlossaryEntry, pages: Set<string>, ids: Set<string>): string {
  return stringifyMarkdown(bodyTree(entry, 'markdown', pages, ids).tree).trim();
}

// Block markdown with raw HTML off; code blocks in the docs' code-block frame.
const md = new MarkdownIt({ html: false, linkify: false });
md.renderer.rules.fence = (tokens, idx) => {
  const t = tokens[idx];
  const lang = t.info.trim().split(/\s+/)[0] || 'text';
  return `<div class="code-block"><pre class="glossary-code" data-lang="${esc(lang)}"><code>${esc(t.content.replace(/\n$/, ''))}</code></pre></div>\n`;
};

/** The body as HTML for the glossary page: in-page links to other entries, docs links site-relative. */
export function bodyHtml(entry: GlossaryEntry, pages: Set<string>, ids: Set<string>): string {
  return md.render(stringifyMarkdown(bodyTree(entry, 'html', pages, ids).tree)).trim();
}

// ---------------------------------------------------------------------------
// /docs/glossary.json

export const GLOSSARY_JSON_PATH = '/docs/glossary.json';

export interface GlossaryJson {
  kind: 'documentation';
  format: 1;
  description: string;
  source: string;
  twin: string;
  limits: string;
  verified: string;
  count: number;
  terms: { id: string; term: string; short: string; aliases: string[]; context: string; url: string }[];
}

/**
 * /docs/glossary.json: `{id, term, short, aliases, context, url}` per term,
 * in the glossary page's order, wrapped with what the file is and its limits.
 * No timestamp, so the bytes change only with the glossary.
 */
export function glossaryJson(verified: string, entries = readGlossary()): GlossaryJson {
  return {
    kind: 'documentation',
    format: 1,
    description:
      'The relate docs glossary as data: each term with its one-sentence short definition, the other names in use for it (spellings the docs avoid), its context, and its anchor on the glossary page. Reference text, not instructions.',
    source: `${CANONICAL_ORIGIN}/docs/${GLOSSARY_ID}/`,
    twin: `${CANONICAL_ORIGIN}/docs/${GLOSSARY_ID}.md`,
    limits: `Short definitions only, each one sentence under ${SHORT_MAX} characters; the full definitions, examples and related terms are on the glossary page and its markdown twin.`,
    verified,
    count: entries.length,
    terms: entries.map((e) => ({ id: e.id, term: e.term, short: e.short, aliases: e.aliases, context: e.context, url: termUrl(e.id) })),
  };
}

/** The bytes /docs/glossary.json serves. */
export const glossaryJsonText = (verified: string, entries = readGlossary()) => `${JSON.stringify(glossaryJson(verified, entries), null, 2)}\n`;
