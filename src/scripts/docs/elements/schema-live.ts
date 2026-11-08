// `:::schema-live` in the browser (the build side is
// src/lib/docs/elements/schema-live.ts). A button runs
// `CALL db.schema.visualization()` on the page's database, after the cells
// (page.run runs the ones that have not run), and draws what the procedure
// reports with the cookbook's data-model code: schema-layout.ts lays it out,
// schema-svg.ts (the body schema-draw.ts calls) draws it, each label in the colour
// the authored figure above gives it. Nothing runs until the button is
// pressed; nothing moves once drawn.

import { compareLabels, constraintName, schemaFromRow, type SchemaRow } from '../../../lib/docs/elements/_schema-live-model.ts';
import { labelColor } from '../../../lib/cookbook/graph-model.ts';
import { NEUTRAL, PALETTE } from '../../../lib/cookbook/palette.ts';
import { layoutSchema } from '../../../lib/cookbook/schema-layout.ts';
import { drawSchemaSvg } from '../../../lib/cookbook/schema-svg.ts';
import { fontSpec, type Font } from '../../../lib/cookbook/schema-text.ts';
import { liveLine, versions } from '../../../lib/docs/elements/_wording.ts';
import type { ElementContext } from '../element-api.ts';
// `?inline`: the styles ride in this lazy chunk (a plain CSS import would be hoisted into every docs page).
import styles from './schema-live.css?inline';

const STATEMENT = 'CALL db.schema.visualization()';

/**
 * The data-model figure the element sits under: the nearest figure before
 * the host, in the same section, drawn by the schema code (circles in
 * `g.node`). Its labels and their colours, or null when there is none.
 */
function authoredFigure(host: HTMLElement): Map<string, string> | null {
  for (let at = host.previousElementSibling; at && !/^H[1-3]$/.test(at.tagName); at = at.previousElementSibling) {
    const svg = at.matches('figure.diagram') ? at.querySelector('svg') : null;
    const nodes = svg ? [...svg.querySelectorAll('g.node')] : [];
    if (!nodes.length) continue;
    const colors = new Map<string, string>();
    for (const g of nodes) {
      const label = g.querySelector('text')?.textContent?.trim();
      const fill = g.querySelector('circle')?.getAttribute('fill');
      if (label && fill) colors.set(label, fill);
    }
    return colors;
  }
  return null;
}

/** Text widths for the layout, measured as the build measures them: Public Sans at the drawing's sizes. */
function canvasMeasure(): (text: string, font: Font) => number {
  const g = document.createElement('canvas').getContext('2d')!;
  return (text, font) => {
    g.font = fontSpec(font);
    return g.measureText(text).width;
  };
}

export async function mount(ctx: ElementContext) {
  const { page, live, attrs, host } = ctx;
  ctx.adoptStyles(styles);
  const written = authoredFigure(host);
  // A label the figure leaves out gets a palette colour the figure does not use, so no two labels share one by chance.
  const used = new Set([...(written?.values() ?? [])].map((c) => c.toLowerCase()));
  const extra = new Map<string, string>();
  const colorOf = (label: string): string => {
    const known = written?.get(label) ?? extra.get(label);
    if (known) return known;
    const c = PALETTE.find((p) => !used.has(p.toLowerCase())) ?? labelColor([label], new Map());
    used.add(c.toLowerCase());
    extra.set(label, c);
    return c;
  };

  const button = Object.assign(document.createElement('button'), { type: 'button', className: 'btn primary', textContent: 'Draw the live schema' });
  button.setAttribute('aria-label', `Draw the live schema: run ${STATEMENT} on the page's database${attrs.cell ? ` after the cells up to ${attrs.cell}` : ' after its cells'}`);
  const code = Object.assign(document.createElement('code'), { textContent: STATEMENT });
  const status = Object.assign(document.createElement('p'), { className: 'ls-status' });
  status.setAttribute('role', 'status');
  const figure = Object.assign(document.createElement('figure'), { className: 'ls-figure', hidden: true });
  const caption = document.createElement('figcaption');
  const art = Object.assign(document.createElement('div'), { className: 'ls-art' });
  figure.append(art, caption);
  const diff = Object.assign(document.createElement('p'), { className: 'ls-diff', hidden: true });
  const tableWrap = Object.assign(document.createElement('div'), { className: 'ls-scroll', hidden: true });
  const root = Object.assign(document.createElement('div'), { className: 'schema-live' });
  // The relationship colour of the drawing in light mode is the palette's neutral grey (diagram-theme.ts); dark mode uses --fg-faint (schema-live.css).
  root.style.setProperty('--ls-neutral', NEUTRAL);
  const bar = Object.assign(document.createElement('div'), { className: 'ls-bar' });
  bar.append(button, code);
  root.append(bar, status, figure, diff, tableWrap);
  live.replaceChildren(root);
  status.textContent = written
    ? `The figure above is the model as written. Pressing the button runs ${STATEMENT} on the page's database and draws what it reports.`
    : `Pressing the button runs ${STATEMENT} on the page's database and draws what it reports.`;

  let drawn = false;
  let drawing = 0;
  const measure = canvasMeasure();

  async function draw() {
    const mine = ++drawing;
    button.disabled = true;
    status.textContent = page.engine() ? 'Running the cells that have not run, then the procedure…' : 'Loading the engine, running the cells, then the procedure…';
    try {
      await document.fonts?.ready;
      const run = await page.run(STATEMENT, null, { upTo: attrs.cell || 'all' });
      if (mine !== drawing) return;
      if (run.error) {
        status.textContent = `The procedure failed: ${run.error}`;
        return;
      }
      const row = (run.envelopes.at(-1)?.rows[0] ?? null) as SchemaRow | null;
      const { model, labels } = schemaFromRow(row, colorOf);
      if (!model.nodes.length) {
        figure.hidden = diff.hidden = tableWrap.hidden = true;
        status.textContent = `${STATEMENT} returned no row: the database holds no labels.`;
        return;
      }
      const layout = layoutSchema(model, measure);
      const id = `${ctx.id}-live`;
      art.innerHTML = drawSchemaSvg(layout, {
        id,
        title: `The live schema: ${labels.length} labels, ${model.edges.length} relationship types between them`,
        // The site's tokens, so the drawing follows the theme without redrawing (diagram-theme.ts maps the same roles).
        colors: {
          surface: 'var(--bg-alt)',
          fg: 'var(--fg)',
          fgMuted: 'var(--fg-muted)',
          borderStrong: 'var(--border-strong)',
          node: 'var(--bg)',
          secondary: 'var(--bg-inset)',
          line: 'var(--fg-faint)',
          rule: 'var(--border)',
          rel: 'var(--ls-rel)',
          labelText: 'var(--on-highlight)',
          flow: { accent: { stroke: 'var(--accent)', fill: 'var(--bg-inset)' }, good: { stroke: 'var(--success)', fill: 'var(--bg-inset)' }, bad: { stroke: 'var(--danger)', fill: 'var(--bg-inset)' } },
        },
      });
      caption.textContent = `What ${STATEMENT} reports, drawn in this tab: ${labels.length} labels and ${model.edges.length} relationships between them, one per type and pair of labels.`;
      figure.hidden = false;

      const table = document.createElement('table');
      table.innerHTML = '<caption>Each label, with the indexes and constraints the procedure reports</caption><thead><tr><th scope="col">Label</th><th scope="col">Indexes (properties)</th><th scope="col">Constraints</th></tr></thead>';
      const body = table.createTBody();
      for (const l of labels) {
        const tr = body.insertRow();
        const th = document.createElement('th');
        th.scope = 'row';
        const chip = Object.assign(document.createElement('span'), { className: 'ls-chip' });
        chip.style.background = colorOf(l.label);
        th.append(chip, l.label);
        tr.append(th);
        tr.insertCell().textContent = l.indexes.join(', ') || 'none';
        const c = tr.insertCell();
        if (!l.constraints.length) c.textContent = 'none';
        for (const text of l.constraints) {
          const line = document.createElement('div');
          line.textContent = constraintName(text) ? `${constraintName(text)}: ${text.replace(/^Constraint\(\s*name='[^']*',\s*/, '').replace(/\s*\)$/, '')}` : text;
          c.append(line);
        }
      }
      tableWrap.replaceChildren(table);
      tableWrap.hidden = false;

      if (written) {
        const { onlyWritten, onlyLive } = compareLabels([...written.keys()], labels.map((l) => l.label));
        const parts = [
          onlyLive.length ? `the database also reports ${onlyLive.join(', ')}, which the figure leaves out` : '',
          onlyWritten.length ? `the figure draws ${onlyWritten.join(', ')}, which the database does not hold yet` : '',
        ].filter(Boolean);
        diff.textContent = parts.length ? `Compared with the figure above: ${parts.join('; ')}.` : 'Every label in the figure is in the database, and the database holds no other.';
        diff.hidden = false;
      }
      // The procedure's own time from its envelope: run.ms also covers the cells run first.
      status.textContent = `${liveLine({ version: versions(page).live, ms: run.envelopes.at(-1)?.elapsed_ms, of: STATEMENT })} ${labels.length} labels and ${model.edges.length} relationships.`;
      drawn = true;
      button.textContent = 'Draw again';
    } catch (err) {
      status.textContent = `Could not draw: ${(err as Error).message}`;
    } finally {
      button.disabled = false;
    }
  }
  button.addEventListener('click', () => void draw());

  // A cell run after the drawing may change the schema; say so rather than redraw unasked.
  const offResult = page.onResult(() => {
    if (drawn) status.textContent = 'A cell ran after this drawing; pressing Draw again shows the schema now.';
  });
  const offReset = page.onReset(() => {
    drawing++;
    drawn = false;
    figure.hidden = diff.hidden = tableWrap.hidden = true;
    art.replaceChildren();
    button.textContent = 'Draw the live schema';
    button.disabled = false;
    status.textContent = 'Reset: the database is empty until the cells run again. Pressing the button runs them, then the procedure.';
  });
  ctx.showLive();
  return () => {
    drawing++;
    offResult();
    offReset();
  };
}
