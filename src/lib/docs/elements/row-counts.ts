// `:::row-counts{cells="a,b"}`: the framework's example element (the docs
// README "Interactive elements"), on the _example page only. Its static form
// is the rows each cell returned when the page was recorded, as a table and
// as bars; live, it adds each cell's rows and time as the reader runs it,
// and two buttons exercise the element API: one counts the page's nodes on
// its database (`page.run`), one tries a write on a read-only database
// (`page.runReadOnly`), which the engine refuses.

import { bothThemes, esc, markdownTable, svgFrame } from '../element-kit.ts';
import type { ElementInput, ElementSpec } from '../elements.ts';

const ATTRIBUTES = new Set(['id', 'cells']);

/** The cells the element counts: `cells="a,b"`, or every cell on the page. */
const chosen = (input: ElementInput) =>
  input.attributes.cells ? input.attributes.cells.split(',').map((s) => s.trim()).filter(Boolean) : input.cells.map((c) => c.id);

/** A recorded cell's row count, or 'error' for a cell that fails. */
function recordedRows(input: ElementInput, id: string): number | 'error' {
  const envelope = input.recordings[id]?.envelope as { rows?: unknown[]; error?: string | null } | null | undefined;
  if (envelope?.error) return 'error';
  return Array.isArray(envelope?.rows) ? envelope.rows.length : 0;
}

export default {
  live: 'the table adds the rows and milliseconds of each cell as it runs in your browser; one button counts the nodes in the page\'s database, and one tries a write on a read-only database, which the engine refuses.',
  validate(input) {
    const out: string[] = [];
    for (const k of Object.keys(input.attributes)) if (!ATTRIBUTES.has(k)) out.push(`takes \`cells="<id>,<id>"\` and \`id\`, not \`${k}\``);
    if (!input.cells.length) out.push('counts the rows of runnable cells, and the page has none');
    for (const id of chosen(input)) if (!input.cells.some((c) => c.id === id)) out.push(`\`cells\` names \`${id}\`, which is not a cell on the page`);
    return out;
  },
  staticForm(input) {
    const ids = chosen(input);
    const rows = ids.map((id) => [id, recordedRows(input, id)] as const);
    const text = markdownTable(['Cell', 'Rows (recorded)'], rows.map(([id, n]) => [`\`${id}\``, n]));
    const max = Math.max(1, ...rows.map(([, n]) => (typeof n === 'number' ? n : 0)));
    const label = 120;
    const barMax = 260;
    const step = 28;
    const width = label + barMax + 60;
    const height = rows.length * step + 8;
    const pictures = bothThemes((theme, c) => {
      const id = `${input.id}-${theme}`;
      const bars = rows
        .map(([cell, n], i) => {
          const y = 4 + i * step;
          const w = typeof n === 'number' ? Math.max(2, Math.round((n / max) * barMax)) : 0;
          return (
            `<text class="name" x="${label - 8}" y="${y + 14}" dy="0.35em">${esc(cell)}</text>` +
            (w ? `<rect class="bar" x="${label}" y="${y + 4}" width="${w}" height="20" rx="3"/>` : '') +
            `<text class="n" x="${label + w + 6}" y="${y + 14}" dy="0.35em">${esc(n)}</text>`
          );
        })
        .join('');
      const style =
        `#${id} .name{text-anchor:end;font-size:13px;fill:${c.fg}}` +
        `#${id} .n{font-size:13px;fill:${c.fgMuted}}` +
        `#${id} .bar{fill:${c.flow.accent.fill};stroke:${c.flow.accent.stroke};stroke-width:1.5}`;
      const desc = rows.map(([cell, n]) => `${cell}: ${n}`).join('; ');
      return svgFrame({ id, width, height, title: 'Rows each cell returned when the page was recorded', desc, style, body: bars });
    });
    return { text, caption: 'Rows each cell returned when the page was recorded', ...pictures };
  },
} satisfies ElementSpec;
