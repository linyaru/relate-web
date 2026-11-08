// /docs/reference/glossary/: every term of src/content/docs/_glossary, in
// alphabetical order under letter headings, each at the stable anchor `#<id>`
// that `:term[…]{id=…}` links point at (DOCS-PLAN.md §4.11, ADR-0009). A term
// shows its short definition, the other names people use for it, the page
// that covers it (once that page is published) and its related terms. The
// full definitions (the files' bodies) are phase 2.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CANONICAL_ORIGIN } from '../../cookbook/links.ts';
import { esc } from '../../cookbook/result-view.ts';
import { GLOSSARY_ID } from '../constructs.ts';
import { GLOSSARY_DIR, splitFrontmatter } from '../content.ts';
import { GENERATED_PAGES } from '../model.ts';
import { headingHtml, newest, pageLink, twinHead, type GeneratedContext, type GeneratedPage, type Heading } from './page.ts';
import { inlineHtml, twinLinks } from './table.ts';

export interface GlossaryEntry {
  id: string;
  term: string;
  short: string;
  aliases: string[];
  context: string;
  see: string | null;
  related: string[];
}

const files = () =>
  readdirSync(GLOSSARY_DIR)
    .filter((n) => n.endsWith('.mdx'))
    .sort()
    .map((n) => join(GLOSSARY_DIR, n));

const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** Every term, sorted by its term (case-insensitive). */
export function glossaryEntries(): GlossaryEntry[] {
  return files()
    .map((file) => {
      const { data } = splitFrontmatter(readFileSync(file, 'utf8'), file);
      const id = typeof data.id === 'string' ? data.id : file.replace(/^.*\//, '').replace(/\.mdx$/, '');
      return {
        id,
        term: String(data.term ?? id),
        short: String(data.short ?? ''),
        aliases: strings(data.aliases),
        context: String(data.context ?? ''),
        see: typeof data.see === 'string' ? data.see : null,
        related: strings(data.related),
      };
    })
    .sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1));
}

/** The letter a term files under (`#` for one that starts with anything else). */
const letterOf = (term: string) => {
  const c = term.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase();
  return /\p{L}/u.test(c) ? c : '#';
};
const letterId = (letter: string) => (letter === '#' ? 'letter-other' : `letter-${letter.toLowerCase()}`);

/** The facts under a term, as inline-markdown parts. */
function details(e: GlossaryEntry, byId: Map<string, GlossaryEntry>, ctx: GeneratedContext, termHref: (id: string) => string): string[] {
  const out: string[] = [];
  if (e.aliases.length) out.push(`Other names in use: ${e.aliases.map((a) => `“${a}”`).join(', ')}.`);
  if (e.context) out.push(`Context: ${e.context}.`);
  const see = e.see ? pageLink(e.see, ctx) : null;
  if (see) out.push(`See: ${see}.`);
  const related = e.related.filter((r) => byId.has(r)).map((r) => `[${byId.get(r)!.term}](${termHref(r)})`);
  if (related.length) out.push(`Related: ${related.join(', ')}.`);
  return out;
}

function render(ctx: GeneratedContext) {
  const meta = GENERATED_PAGES.find((p) => p.id === GLOSSARY_ID)!;
  const entries = glossaryEntries();
  const byId = new Map(entries.map((e) => [e.id, e]));
  const letters = [...new Set(entries.map((e) => letterOf(e.term)))];
  const intro =
    `The terms the relate docs use with one meaning, ${entries.length} in all, each at a stable anchor: ` +
    `\`${CANONICAL_ORIGIN}/docs/${GLOSSARY_ID}/#<id>\`. A page links the first use of a term here, and its markdown twin ends with the short definition of every term it links.`;

  const headings: Heading[] = letters.map((l) => ({ depth: 2, slug: letterId(l), text: l }));
  const anchors = new Set<string>([...headings.map((h) => h.slug), ...entries.map((e) => e.id)]);

  const html = [
    `<p>${inlineHtml(intro, ctx.pages)}</p>`,
    ...letters.map((l, i) => {
      const terms = entries.filter((e) => letterOf(e.term) === l);
      return (
        headingHtml(headings[i]) +
        '<dl class="glossary">' +
        terms
          .map((e) => {
            const meta = details(e, byId, ctx, (id) => `#${id}`);
            return (
              `<div class="glossary-entry" id="${esc(e.id)}"><dt><a class="ref-anchor" href="#${esc(e.id)}">${esc(e.term)}</a></dt>` +
              `<dd><p>${inlineHtml(e.short, ctx.pages)}</p>` +
              (meta.length ? `<p class="glossary-meta">${meta.map((m) => inlineHtml(m, ctx.pages)).join(' ')}</p>` : '') +
              '</dd></div>'
            );
          })
          .join('') +
        '</dl>'
      );
    }),
  ].join('\n');

  const termUrl = (id: string) => `/docs/${GLOSSARY_ID}/#${id}`;
  const body = [twinLinks(intro, ctx.pages)];
  for (const l of letters) {
    body.push(`## ${l}`);
    for (const e of entries.filter((x) => letterOf(x.term) === l)) {
      body.push(`### ${e.term}`, e.short);
      const meta = details(e, byId, ctx, termUrl);
      if (meta.length) body.push(meta.map((m) => `- ${twinLinks(m, ctx.pages)}`).join('\n'));
    }
  }
  const markdown = `${[twinHead(meta, ctx, newest(files())), ...body].join('\n\n')}\n`;
  return { html, headings, markdown, anchors };
}

export const glossaryPage: GeneratedPage = {
  meta: GENERATED_PAGES.find((p) => p.id === GLOSSARY_ID)!,
  sources: files,
  render,
};
