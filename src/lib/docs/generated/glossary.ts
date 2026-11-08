// /docs/reference/glossary/: every term of src/content/docs/_glossary, in
// alphabetical order under letter headings, each at the stable anchor `#<id>`
// that `:term[…]{id=…}` links point at (DOCS-PLAN.md §4.11, ADR-0009,
// ADR-0018). An entry shows the short definition first, then the full one
// (the file's body), the other names people use for the term, its context,
// the page that covers it (once that page is published) and its related
// terms.
//
// The page: a letter index; a filter box that the inline script reveals and
// drives (without JavaScript the box stays hidden and every entry shows); a
// JSON-LD DefinedTermSet for the head (`head`). An entry is
// `<div class="glossary-entry" id="<id>"><dt>term</dt><dd>…</dd></div>`, the
// shape src/lib/docs/negotiation.ts htmlHeadings reads as a heading, so
// `?section=<id>` and the docs MCP's get_page cut one entry. No toggletip on
// this page: links between entries are plain in-page links.
//
// The twin: `## <letter>`, then per term `### <term>`, the short definition,
// the full definition and a list of the facts, so one entry is one section.

import { CANONICAL_ORIGIN } from '../../cookbook/links.ts';
import { esc } from '../../cookbook/result-view.ts';
import { GLOSSARY_ID } from '../constructs.ts';
import { bodyHtml, bodyMarkdown, glossaryFiles, letterOf, readGlossary, termUrl, type GlossaryEntry } from '../glossary.ts';
import { GENERATED_PAGES } from '../model.ts';
import { headingHtml, newest, pageLink, twinHead, type GeneratedContext, type GeneratedPage, type Heading, type RenderedPage } from './page.ts';
import { inlineHtml, twinLinks } from './table.ts';

export type { GlossaryEntry };

/** Every term, sorted by its term (leading punctuation and case ignored). */
export const glossaryEntries = (): GlossaryEntry[] => readGlossary();

const letterId = (letter: string) => (letter === '#' ? 'letter-other' : `letter-${letter.toLowerCase()}`);

/** The facts under a term, as inline-markdown parts. */
function details(e: GlossaryEntry, byId: Map<string, GlossaryEntry>, ctx: GeneratedContext, href: (id: string) => string): string[] {
  const out: string[] = [];
  if (e.aliases.length) out.push(`Other names in use: ${e.aliases.map((a) => `“${a}”`).join(', ')}.`);
  if (e.context) out.push(`Context: ${e.context}.`);
  const see = e.see ? pageLink(e.see, ctx) : null;
  if (see) out.push(`See: ${see}.`);
  const related = e.related.filter((r) => byId.has(r)).map((r) => `[${byId.get(r)!.term}](${href(r)})`);
  if (related.length) out.push(`Related: ${related.join(', ')}.`);
  return out;
}

/** What the filter matches an entry on: its id, term, aliases and short definition, lowercased. */
const filterText = (e: GlossaryEntry) => [e.id, e.term, ...e.aliases, e.short].join(' ').replace(/`/g, '').replace(/\s+/g, ' ').toLowerCase();

// The filter: progressive enhancement. The form is `hidden` in the HTML; this
// reveals it and hides the entries (and letters) that do not match. Plain
// ES2017, no module, no dependency.
const FILTER_SCRIPT = `(() => {
  const form = document.querySelector('[data-glossary-filter]');
  if (!form) return;
  const input = form.querySelector('input');
  const count = form.querySelector('[data-glossary-count]');
  const entries = [...document.querySelectorAll('.glossary-entry[data-filter]')];
  const letters = [...document.querySelectorAll('.glossary-letter')];
  const total = entries.length;
  const apply = () => {
    const words = input.value.toLowerCase().split(/\\s+/).filter(Boolean);
    let shown = 0;
    for (const e of entries) {
      const hit = words.every((w) => e.dataset.filter.includes(w));
      e.hidden = !hit;
      if (hit) shown++;
    }
    for (const l of letters) l.hidden = !l.querySelector('.glossary-entry:not([hidden])');
    count.textContent = words.length ? shown + ' of ' + total + ' terms' : total + ' terms';
  };
  form.addEventListener('submit', (ev) => ev.preventDefault());
  input.addEventListener('input', apply);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && input.value) { input.value = ''; apply(); } });
  form.hidden = false;
  apply();
})();`;

/** The JSON-LD DefinedTermSet for the page head (schema.org), with `<` escaped so it cannot close the script. */
export function glossaryJsonLd(entries: GlossaryEntry[]): string {
  const setId = `${CANONICAL_ORIGIN}/docs/${GLOSSARY_ID}/`;
  const doc = {
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    '@id': setId,
    name: 'relate glossary',
    url: setId,
    hasDefinedTerm: entries.map((e) => ({
      '@type': 'DefinedTerm',
      '@id': termUrl(e.id),
      name: e.term,
      termCode: e.id,
      description: e.short.replace(/`/g, ''),
      url: termUrl(e.id),
      inDefinedTermSet: setId,
    })),
  };
  return `<script type="application/ld+json">${JSON.stringify(doc).replace(/</g, '\\u003c')}</script>`;
}

function render(ctx: GeneratedContext): RenderedPage & { head: string } {
  const meta = GENERATED_PAGES.find((p) => p.id === GLOSSARY_ID)!;
  const entries = glossaryEntries();
  const byId = new Map(entries.map((e) => [e.id, e]));
  const ids = new Set(byId.keys());
  const letters = [...new Set(entries.map((e) => letterOf(e.term)))];
  const intro =
    `The terms the relate docs use with one meaning, ${entries.length} in all, each at a stable anchor: ` +
    `\`${CANONICAL_ORIGIN}/docs/${GLOSSARY_ID}/#<id>\`. Each entry gives the short definition first, then the full one. ` +
    `A page links the first use of a term here, and its markdown twin ends with the short definition of every term it links. ` +
    `The same terms as JSON: \`${CANONICAL_ORIGIN}/docs/glossary.json\`.`;

  const headings: Heading[] = letters.map((l) => ({ depth: 2, slug: letterId(l), text: l }));
  const anchors = new Set<string>([...headings.map((h) => h.slug), ...entries.map((e) => e.id), 'glossary-filter', 'glossary-q']);

  const letterNav =
    `<nav class="glossary-letters" aria-label="Glossary letters"><ul>` +
    letters.map((l, i) => `<li><a href="#${esc(headings[i].slug)}">${esc(l)}</a></li>`).join('') +
    '</ul></nav>';
  const filter =
    `<form class="glossary-filter" id="glossary-filter" role="search" aria-label="Filter the glossary" data-glossary-filter hidden>` +
    `<label for="glossary-q">Filter terms</label>` +
    `<input id="glossary-q" type="search" autocomplete="off" spellcheck="false" placeholder="store, WAL, index…" />` +
    `<span class="glossary-count" data-glossary-count aria-live="polite">${entries.length} terms</span></form>`;

  const html = [
    `<p>${inlineHtml(intro, ctx.pages)}</p>`,
    filter,
    letterNav,
    ...letters.map((l, i) => {
      const terms = entries.filter((e) => letterOf(e.term) === l);
      return (
        `<section class="glossary-letter" aria-labelledby="${esc(headings[i].slug)}">` +
        headingHtml(headings[i]) +
        '<dl class="glossary">' +
        terms
          .map((e) => {
            const facts = details(e, byId, ctx, (id) => `#${id}`);
            const body = e.body ? bodyHtml(e, ctx.pages, ids) : '';
            return (
              `<div class="glossary-entry" id="${esc(e.id)}" data-filter="${esc(filterText(e))}"><dt><a class="ref-anchor" href="#${esc(e.id)}">${esc(e.term)}</a></dt>` +
              `<dd><p class="glossary-short">${inlineHtml(e.short, ctx.pages)}</p>` +
              (body ? `<div class="glossary-body">${body}</div>` : '') +
              (facts.length ? `<p class="glossary-meta">${facts.map((m) => inlineHtml(m, ctx.pages)).join(' ')}</p>` : '') +
              '</dd></div>'
            );
          })
          .join('') +
        '</dl></section>'
      );
    }),
    `<script>${FILTER_SCRIPT}</script>`,
  ].join('\n');

  const termHref = (id: string) => `/docs/${GLOSSARY_ID}/#${id}`;
  const body = [twinLinks(intro, ctx.pages)];
  for (const l of letters) {
    body.push(`## ${l}`);
    for (const e of entries.filter((x) => letterOf(x.term) === l)) {
      body.push(`### ${e.term}`, e.short);
      if (e.body) body.push(bodyMarkdown(e, ctx.pages, ids));
      const facts = details(e, byId, ctx, termHref);
      if (facts.length) body.push(facts.map((m) => `- ${twinLinks(m, ctx.pages)}`).join('\n'));
    }
  }
  const markdown = `${[twinHead(meta, ctx, newest(glossaryFiles())), ...body].join('\n\n')}\n`;
  return { html, headings, markdown, anchors, head: glossaryJsonLd(entries) };
}

export const glossaryPage: GeneratedPage = {
  meta: GENERATED_PAGES.find((p) => p.id === GLOSSARY_ID)!,
  sources: () => glossaryFiles(),
  render,
};
