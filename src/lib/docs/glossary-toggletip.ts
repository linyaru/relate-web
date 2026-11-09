// The term toggletip (DOCS-PLAN.md §4.11 "How it renders in HTML", ADR-0009):
// a pass over a docs page's mdast after constructs.ts has rendered each
// `:term[label]{id=…}` as a link with the class `term`. It runs for the HTML
// page only (remark.ts); the twin keeps every term as a plain absolute link
// and its closing Terms section (twin.ts).
//
// Per term, in document order:
//   - in a heading, a table's header row, a callout title, a tab label or a
//     link: plain text (never a control there);
//   - in a table body cell or inside a tab panel: a plain link to the entry
//     (tables are scanned, and a tab panel can be hidden); this does not use
//     up the term's toggletip;
//   - the first other use: the toggletip, a <button popovertarget> that
//     opens a popover="auto" panel holding the short definition and a "Read
//     more in the glossary" link;
//   - every later use: plain text.
//
// The panel is a <span popover="auto">, not a <div>: it sits inside a
// paragraph, where a <div> would end the paragraph early. Declarative (the
// Popover API): click, tap or Enter opens it, Escape or a click outside
// closes it, focus stays on the button, and no JavaScript runs. With
// JavaScript off it works the same, and the definition is in the static HTML
// for a fetcher.

import MarkdownIt from 'markdown-it';
import type { Html, Link, Parent, Root, RootContent } from 'mdast';
import { toString } from 'mdast-util-to-string';

import { esc } from '../cookbook/result-view.ts';
import { glossaryHref } from './constructs.ts';

export interface TipTerm {
  id: string;
  term: string;
  short: string;
}

/** The id of a toggletip's panel on the page. */
export const tipId = (id: string) => `term-tip-${id}`;

const inline = new MarkdownIt({ html: false, linkify: false });
const HREF_PREFIX = glossaryHref('');

/** The toggletip's HTML: the button with the term as written, then its panel. */
export function toggletipHtml(label: string, term: TipTerm): string {
  const pid = tipId(term.id);
  return (
    `<button type="button" class="term" popovertarget="${esc(pid)}">${esc(label)}</button>` +
    `<span class="term-tip" id="${esc(pid)}" popover="auto">` +
    `<span class="term-tip-name">${esc(term.term)}</span> ` +
    `<span class="term-tip-short">${inline.renderInline(term.short)}</span> ` +
    `<a class="term-tip-more" href="${esc(glossaryHref(term.id))}">Read more in the glossary</a></span>`
  );
}

type Place = 'plain' | 'link' | 'tip';

interface Context {
  /** Where a term renders here: as text, as a plain link, or as the page's toggletip if it is the first. */
  place: Place;
}

const hasClass = (node: { data?: unknown }, name: string) => {
  const cls = (node.data as { hProperties?: { className?: unknown } } | undefined)?.hProperties?.className;
  return Array.isArray(cls) && cls.includes(name);
};

/** The glossary id a rendered term link names, or null for any other node. */
function termIdOf(node: RootContent): string | null {
  if (node.type !== 'link' || !hasClass(node, 'term') || !node.url.startsWith(HREF_PREFIX)) return null;
  return node.url.slice(HREF_PREFIX.length) || null;
}

/**
 * Turn the page's rendered term links into their HTML form in place: the
 * first eligible use of each term becomes the toggletip. Returns the ids that
 * got one, in order.
 */
export function renderToggletips(tree: Root, glossary: Map<string, TipTerm>): string[] {
  const done = new Set<string>();
  const order: string[] = [];
  const walk = (parent: Parent, ctx: Context) => {
    const out: RootContent[] = [];
    (parent.children as RootContent[]).forEach((node, index) => {
      const id = termIdOf(node);
      if (id !== null) {
        const term = glossary.get(id);
        const children = (node as Link).children as RootContent[];
        if (!term || ctx.place === 'plain') out.push(...children);
        else if (ctx.place === 'link') out.push(node);
        else if (done.has(id)) out.push(...children);
        else {
          done.add(id);
          order.push(id);
          out.push({ type: 'html', value: toggletipHtml(toString(node), term) } as Html);
        }
        return;
      }
      if ('children' in node) walk(node as Parent, { place: placeOf(parent, node, index, ctx) });
      out.push(node);
    });
    parent.children = out as Parent['children'];
  };
  walk(tree, { place: 'tip' });
  return order;
}

/** The place for terms inside `node`, a child of `parent` at `index`. */
function placeOf(parent: Parent, node: RootContent, index: number, ctx: Context): Place {
  if (ctx.place === 'plain') return 'plain';
  switch (node.type) {
    case 'heading':
    case 'link':
    case 'linkReference':
      return 'plain';
    case 'tableRow':
      // The first row of a GFM table is its header.
      return parent.type === 'table' && index === 0 ? 'plain' : ctx.place;
    case 'tableCell':
      return ctx.place === 'tip' ? 'link' : ctx.place;
    case 'paragraph':
      return hasClass(node, 'callout-title') || hasClass(node, 'tab-label') ? 'plain' : ctx.place;
    case 'mdxJsxFlowElement':
    case 'mdxJsxTextElement':
      return /^[A-Z]/.test(node.name ?? '') ? 'plain' : ctx.place;
    default:
      return hasClass(node, 'tab-panel') && ctx.place === 'tip' ? 'link' : ctx.place;
  }
}
