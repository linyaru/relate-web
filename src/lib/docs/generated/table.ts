// The table model the generated reference tables share (<Errors />,
// <ExitCodes />, <Flags />, <EnvVars />) and its two renderings: HTML for the
// page, every row at its stable id with the first cell linking to itself, and
// a flat GFM table for the twin, one row per entry, so an agent can grep it.
// Cells hold inline markdown; links in them resolve like any docs link
// (links.ts), so one whose target is not built or not public keeps its text.

import MarkdownIt from 'markdown-it';

import { esc } from '../../cookbook/result-view.ts';
import { absoluteUrl, resolveHref } from '../links.ts';

/**
 * A table: column labels and rows. Each cell is a list of inline-markdown
 * parts (the page stacks them; the twin joins them into one line). A row's `id`
 * is its anchor.
 */
export interface Table {
  columns: string[];
  rows: { id: string; cells: string[][] }[];
  /** Inline-markdown paragraphs printed after the table. */
  notes: string[];
}

/** What a cell says when the data has no value: the sources do not say, or it does not apply. */
export const NONE = '—';

/** `s` as a code span, with a fence longer than any backtick run inside it. */
export function codeSpan(s: string): string {
  const longest = Math.max(0, ...[...s.matchAll(/`+/g)].map((m) => m[0].length));
  const tick = '`'.repeat(longest + 1);
  const pad = s.startsWith('`') || s.endsWith('`') ? ' ' : '';
  return `${tick}${pad}${s}${pad}${tick}`;
}

// ---------- The page ----------

// Inline markdown with raw HTML off (a `<placeholder>` in prose stays text).
const markdown = new MarkdownIt({ html: false, linkify: false });

/** Inline markdown as HTML; links resolve first, so one that is not built or not public keeps its text. */
export function inlineHtml(s: string, pages: Set<string>): string {
  return markdown.renderInline(
    s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
      const resolved = resolveHref(href, { pages });
      return resolved === null ? label : `[${label}](${resolved})`;
    }),
  );
}

export interface HtmlClasses {
  /** The <table>'s class. */
  table: string;
  /** The class of the link from a row's first cell to its own anchor. */
  anchor: string;
}

/** The table as HTML: each <tr> at its row's id, the first part of the first cell linking to it, then the notes. */
export function tableHtml(t: Table, pages: Set<string>, classes: HtmlClasses): string {
  const inline = (parts: string[]) => parts.map((p) => inlineHtml(p, pages)).join('<br />');
  return (
    `<table class="${esc(classes.table)}"><thead><tr>` +
    t.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('') +
    '</tr></thead><tbody>' +
    t.rows
      .map((r) => {
        const [first, ...rest] = r.cells;
        // The first part of the first cell names the row; it links to the row's own anchor.
        const head =
          `<a class="${esc(classes.anchor)}" href="#${esc(r.id)}">${inlineHtml(first[0], pages)}</a>` +
          (first.length > 1 ? `<br />${inline(first.slice(1))}` : '');
        return `<tr id="${esc(r.id)}"><td>${head}</td>${rest.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`;
      })
      .join('') +
    '</tbody></table>' +
    t.notes.map((n) => `<p>${inlineHtml(n, pages)}</p>`).join('')
  );
}

// ---------- The twin ----------

/** Links in twin markdown: absolute, or text only when the target is not built or not public. */
export function twinLinks(md: string, pages: Set<string>): string {
  return md.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
    const resolved = resolveHref(href, { pages });
    return resolved === null ? label : `[${label}](${absoluteUrl(resolved)})`;
  });
}

/** Parts as one line: a sentence is followed by a space, anything else by "; ". */
const joinParts = (parts: string[]) => parts.reduce((acc, p) => (acc ? `${acc}${/[.!?:]$/.test(acc) ? ' ' : '; '}${p}` : p), '');

/** A cell for a GFM table row: parts joined into one line, no line breaks, pipes escaped. */
const twinCell = (parts: string[], pages: Set<string>) => twinLinks(joinParts(parts), pages).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');

/** The table as GFM markdown, then its notes, for the twin. */
export function tableMarkdown(t: Table, pages: Set<string>): string {
  const lines = [
    `| ${t.columns.join(' | ')} |`,
    `| ${t.columns.map(() => '---').join(' | ')} |`,
    ...t.rows.map((r) => `| ${r.cells.map((c) => twinCell(c, pages)).join(' | ')} |`),
  ];
  return [lines.join('\n'), ...t.notes.map((n) => twinLinks(n, pages))].join('\n\n');
}
