// cookbook:browser cases for `:::geo-explorer` (src/lib/docs/elements/geo-explorer.ts),
// on guides/cypher/geospatial and on the nearby-places recipe (ADR-0045): the plane draws the page's places; dragging
// the circle (pointer events) runs the radius cell on the engine and changes
// the places it returns, and the search after the shape stops is the one
// shown (its parameters are where the shape ended, its lit places what a
// haversine over the recorded places says lies inside); the keyboard moves
// and resizes the shape; the box searches with the box cell; at phone width
// a real finger (CDP touch events) drags the circle without scrolling the
// page, a finger on the open plane scrolls past without moving the shape or
// starting the engine, and a tap on the circle runs nothing; the point index
// button keeps keyboard focus, shows its CREATE and DROP statements, searches
// again, and the scan's database hits fall with the index on; Reset puts the
// recorded result back. The box and the index cases pass with a note on a
// placement without `box=` or `index=`.

import { scenario, type BrowserCases, type BrowserTab, type Outcome } from './_kit.ts';

/**
 * A real one-finger swipe: the runner's `tab.swipe` (CDP
 * Input.dispatchTouchEvent with touch emulation on), so the browser decides
 * to scroll or not, and fires pointercancel, as for a finger. Synthetic
 * PointerEvents never scroll, so they cannot show either.
 */
type SwipeTab = BrowserTab & { swipe?: (x0: number, y0: number, x1: number, y1: number, steps?: number) => Promise<void> };

/** In-page helpers: the explorer's parts, a synthetic drag, and a wait for the next live search. */
const HELPERS = `
  const parts = (h) => ({
    plot: h.querySelector('.geo-plane'),
    area: h.querySelector('.geo-area'),
    handle: h.querySelector('.geo-handle'),
    status: h.querySelector('.geo-status'),
    caption: () => h.querySelector('.geo-table caption').textContent,
    rows: () => [...h.querySelectorAll('.geo-table tbody tr')],
    lit: () => [...h.querySelectorAll('.geo-place.is-hit')].map((g) => g.dataset.name),
    params: () => h.querySelector('.geo-params').textContent.replace(/^Parameters: /, ''),
    code: () => h.querySelector('.geo-code pre code').textContent,
    index: h.querySelector('.geo-index'),
    timing: (k) => h.querySelector('.geo-timing tr[data-index=' + k + ']'),
  });
  /** The page scrolls smoothly: wait until the host stops moving before measuring where to press. */
  const settle = async (h) => { let last = NaN, still = 0; for (let i = 0; i < 60 && still < 3; i++) { const top = Math.round(h.getBoundingClientRect().top); still = top === last ? still + 1 : 0; last = top; await wait(50); } };
  const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const fire = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
  /** Press on 'from' at its centre and move in steps to (x, y) over the plane, then release. */
  const drag = async (from, plot, x, y) => {
    const [x0, y0] = centre(from);
    fire(from, 'pointerdown', x0, y0);
    for (let i = 1; i <= 6; i++) { fire(plot, 'pointermove', x0 + ((x - x0) * i) / 6, y0 + ((y - y0) * i) / 6); await wait(30); }
    fire(plot, 'pointerup', x, y);
  };
  /** The shape's position as its aria-label says (what the plane shows). */
  const shapeOf = (h) => {
    const label = h.querySelector('.geo-shape').getAttribute('aria-label') || '';
    const c = /latitude (-?\\d+(?:\\.\\d+)?), longitude (-?\\d+(?:\\.\\d+)?), radius (\\d+) m/.exec(label);
    if (c) return { lat: Number(c[1]), lon: Number(c[2]), radius: Number(c[3]) };
    const b = /latitude (-?\\d+(?:\\.\\d+)?) to (-?\\d+(?:\\.\\d+)?), longitude (-?\\d+(?:\\.\\d+)?) to (-?\\d+(?:\\.\\d+)?)/.exec(label);
    return b ? { south: Number(b[1]), north: Number(b[2]), west: Number(b[3]), east: Number(b[4]) } : null;
  };
  const sameShape = (a, b) => !!a && !!b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);
  /** The points cell's recorded places. */
  const recordedPlaces = async (h) => (await recordedOf(JSON.parse(h.dataset.attrs).points)).envelope.rows;
  /**
   * Which recorded places lie inside a circle, by haversine with the engine's
   * Earth radius (6,378,140 m): 'in' within 1 m inside, 'out' beyond 1 m
   * outside; a place on the edge itself is left to the engine.
   */
  const insideCircle = async (h, c) => {
    const R = 6378140, rad = Math.PI / 180, out = { in: [], out: [] };
    for (const p of await recordedPlaces(h)) {
      const dLat = (p.latitude - c.lat) * rad, dLon = (p.longitude - c.lon) * rad;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(c.lat * rad) * Math.cos(p.latitude * rad) * Math.sin(dLon / 2) ** 2;
      const d = 2 * R * Math.asin(Math.sqrt(a));
      if (d < c.radius - 1) out.in.push(p.name); else if (d > c.radius + 1) out.out.push(p.name);
    }
    return out;
  };
  /** The places the table lists (its name column). */
  const tabled = (p) => p.rows().map((tr) => tr.cells[0].textContent);
  /** Wait for a live search whose status differs from 'before'. */
  const searched = (p, before) => until(() => p.status.textContent !== before && /in the engine|failed|Could not/.test(p.status.textContent), 90000);
  /** Wait for the last search after the shape stops: a drag's throttled searches land mid-move, the final one after it. */
  const final = async (p, before) => {
    await searched(p, before);
    let last = p.status.textContent, quiet = 0;
    for (let i = 0; i < 100 && quiet < 6; i++) { await wait(100); quiet = p.status.textContent === last ? quiet + 1 : 0; last = p.status.textContent; }
    await idle();
  };
`;

const FIRST = scenario(`
  ${HELPERS}
  const log = [], failures = [];
  const h = await live('geo-explorer');
  expect(log, failures, 'the explorer goes live', !!h);
  if (!h) return { log, failures };
  await settle(h);
  const p = parts(h);
  // The places: those on the plane, plus those named beyond it, are the rows the points cell recorded.
  const pointsCell = document.querySelector('cypher-cell[data-cell="' + JSON.parse(h.dataset.attrs).points + '"]');
  const recorded = pointsCell.querySelectorAll('.cell-output table tbody tr').length;
  const drawn = h.querySelectorAll('.geo-place').length;
  const off = Number(h.querySelector('.geo-off').dataset.count);
  expect(log, failures, 'the plane draws the page\\'s places', drawn > 0 && drawn + off === recorded, drawn + ' drawn + ' + off + ' beyond = ' + recorded + ' recorded');
  expect(log, failures, 'it starts on the recorded result, without the engine', /^Recorded/.test(p.status.textContent) && !engineLoaded(), p.status.textContent.slice(0, 60));
  const before = p.lit().length;
  expect(log, failures, 'the recorded matches are lit and tabled', before > 0 && before === p.rows().length, before + ' lit');
  const pr = p.plot.getBoundingClientRect();
  const status0 = p.status.textContent;
  const params0 = p.params();
  await drag(p.area, p.plot, pr.left + pr.width * 0.06, pr.top + pr.height * 0.08);
  await final(p, status0);
  const after = p.lit().length;
  expect(log, failures, 'the drag runs the radius cell on the engine', /as it ran/.test(h.querySelector('.geo-label').textContent) && /^PROFILE /.test(p.code()) && /in the engine/.test(p.status.textContent), p.status.textContent.slice(0, 120));
  expect(log, failures, 'the matched count changes', after !== before, before + ' -> ' + after);
  expect(log, failures, 'the table lists what is lit', p.rows().length === after && /this tab/.test(p.caption()), p.rows().length + ' rows, ' + after + ' lit');
  // A whole FLOAT keeps its .0, as in the cell's own table and relate --mode table (393.0, not 393).
  const radiusEnv = (await recordedOf(JSON.parse(h.dataset.attrs).radius)).envelope;
  const floats = (radiusEnv.columnTypes || []).flatMap((t, i) => (t === 'FLOAT' ? [i] : []));
  const badFloat = p.rows().flatMap((tr) => floats.map((i) => tr.cells[i].textContent)).filter((t) => t !== 'null' && !/[.eE]/.test(t));
  expect(log, failures, 'the live table prints FLOAT columns with their decimal point', floats.length > 0 && badFloat.length === 0, floats.length + ' FLOAT column(s); ' + badFloat.join(','));
  expect(log, failures, 'the live status opens with the shared wording', /^From this tab's run on relate \\d+\\.\\d+\\.\\d+, (?:<0\\.1|\\d+(?:\\.\\d)?) ms in the engine\\./.test(p.status.textContent), p.status.textContent.slice(0, 90));
  expect(log, failures, 'the parameters are the shape\\'s', JSON.parse(p.params()).radius > 0 && p.params() !== params0, params0 + ' -> ' + p.params());
  expect(log, failures, 'the timing row has the engine\\'s numbers', /parse .* ms, plan .* ms, execute .* ms; .* ms elapsed/.test(p.timing('off').textContent), p.timing('off').textContent.slice(0, 80));
  // The search shown is the one after the shape stopped: its parameters are where the shape ended,
  // and what is lit is what lies inside the circle there.
  const shape = shapeOf(h), sent = JSON.parse(p.params());
  expect(log, failures, 'the last search ran where the shape stopped', sameShape(shape, sent), JSON.stringify(shape) + ' vs ' + p.params());
  const want = await insideCircle(h, sent), lit = p.lit();
  expect(log, failures, 'the lit places are the ones inside the circle there', want.in.every((n) => lit.includes(n)) && want.out.every((n) => !lit.includes(n)) && lit.every((n) => tabled(p).includes(n)), 'lit ' + lit.join(', ') + '; inside ' + want.in.join(', '));
  expect(log, failures, 'the status describes that search', p.status.textContent.includes('of latitude ' + sent.lat + ', longitude ' + sent.lon) && p.status.textContent.includes(after === 1 ? '1 place ' : after + ' places '), p.status.textContent.slice(0, 160));
  return { log: [before + ' lit -> ' + after + ' after the drag; ' + p.params()], failures };
`);

export default {
  element: 'geo-explorer',
  cases: [
    { name: 'the plane draws the page\'s places, and a drag searches them on the engine', scenario: FIRST },
    {
      name: 'the keyboard moves and resizes the circle',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const start = await tab.evaluate<Outcome & { params?: string; status?: string }>(scenario(`
          ${HELPERS}
          const h = await live('geo-explorer');
          if (!h) return { log: [], failures: ['the explorer did not go live'] };
          h.querySelector('.geo-shape').focus();
          return { log: [], failures: document.activeElement === h.querySelector('.geo-shape') ? [] : ['the shape takes focus'], params: parts(h).params(), status: parts(h).status.textContent };
        `));
        if (start.failures.length) return start;
        await tab.press('ArrowRight', 'ArrowRight', 39);
        await tab.press('ArrowRight', 'ArrowRight', 39);
        await tab.press('ArrowUp', 'ArrowUp', 38);
        await tab.press('+', 'Equal', 187);
        return tab.evaluate<Outcome>(scenario(`
          ${HELPERS}
          const log = [], failures = [];
          const h = host('geo-explorer');
          const p = parts(h);
          await final(p, ${JSON.stringify(start.status)});
          const a = ${JSON.stringify(start.params)}, b = JSON.parse(p.params());
          const was = JSON.parse(a);
          expect(log, failures, 'arrow keys move the center east and north', b.lon > was.lon && b.lat > was.lat, a + ' -> ' + p.params());
          expect(log, failures, 'plus grows the radius', b.radius > was.radius, was.radius + ' -> ' + b.radius);
          expect(log, failures, 'the moved shape ran on the engine', /^PROFILE /.test(p.code()) && /in the engine/.test(p.status.textContent), p.status.textContent.slice(0, 100));
          expect(log, failures, 'the shape keeps focus', document.activeElement === h.querySelector('.geo-shape'));
          expect(log, failures, 'the last search ran where the shape stopped', sameShape(shapeOf(h), b), JSON.stringify(shapeOf(h)) + ' vs ' + p.params());
          return { log: [p.params() + ': ' + p.lit().length + ' lit'], failures };
        `));
      },
    },
    {
      name: 'the box searches with the box cell',
      scenario: scenario(`
        ${HELPERS}
        const log = [], failures = [];
        const h = await live('geo-explorer');
        if (!h) return { log, failures: ['the explorer did not go live'] };
        if (!JSON.parse(h.dataset.attrs).box) return { log: ['this placement has no box (no box= on its directive); the box is checked where one is set'], failures: [] };
        await settle(h);
        const box = h.querySelector('.geo-modes [data-mode=box]');
        box.click();
        let p = parts(h);
        const box0 = shapeOf(h);
        expect(log, failures, 'Box shows the box cell\\'s recorded result', /withinBBox/.test(p.code()) && /^Recorded/.test(p.status.textContent) && p.rows().length > 0, p.rows().length + ' rows');
        const before = p.lit().length;
        p = parts(h);
        const pr = p.plot.getBoundingClientRect();
        const status0 = p.status.textContent;
        await drag(p.handle, p.plot, pr.left + pr.width * 0.97, pr.top + pr.height * 0.03);
        await final(p, status0);
        const q = JSON.parse(p.params());
        expect(log, failures, 'the handle grows the box and the box cell runs', q.north > box0.north && q.east > box0.east && /^PROFILE /.test(p.code()) && /withinBBox/.test(p.code()) && /in the engine/.test(p.status.textContent), p.params());
        expect(log, failures, 'a bigger box returns more places', p.lit().length > before && p.rows().length === p.lit().length, before + ' -> ' + p.lit().length);
        expect(log, failures, 'the last search ran where the box stopped', sameShape(shapeOf(h), q), JSON.stringify(shapeOf(h)) + ' vs ' + p.params());
        return { log: [before + ' -> ' + p.lit().length + ' in ' + p.params()], failures };
      `),
    },
    {
      name: 'at phone width a finger drags the circle, and the page does not scroll',
      scenario: async (t: BrowserTab): Promise<Outcome> => {
        const tab = t as SwipeTab;
        if (!tab.swipe) return { log: [], failures: ['the runner gives no tab.swipe (real touch input), which this case needs'] };
        await tab.viewport(390, 844, { mobile: true });
        const start = await tab.evaluate<Outcome & { x?: number; y?: number; top?: number; scrollY?: number; status?: string }>(scenario(`
          ${HELPERS}
          const h = await live('geo-explorer');
          if (!h) return { log: [], failures: ['the explorer did not go live'] };
          await settle(h);
          const p = parts(h);
          // The plane itself in the middle of the screen: a page's sticky bar may cover the top of a tall host.
          p.plot.scrollIntoView({ block: 'center', behavior: 'instant' });
          await settle(h);
          const [x, y] = centre(p.area);
          const hit = document.elementFromPoint(x, y);
          if (!hit || !hit.closest('.geo-area')) return { log: [], failures: ['the circle is not under its own center (' + (hit ? hit.className.baseVal || hit.tagName : 'nothing') + ')'] };
          return { log: [], failures: [], x, y, top: p.plot.getBoundingClientRect().top, scrollY: window.scrollY, status: p.status.textContent };
        `));
        if (start.failures.length) return start;
        const [dx, dy] = [60, -60];
        await tab.swipe(start.x!, start.y!, start.x! + dx, start.y! + dy, 10);
        return tab.evaluate<Outcome>(scenario(`
          ${HELPERS}
          const log = [], failures = [];
          const h = host('geo-explorer');
          const p = parts(h);
          // Where the plane sits on screen: a touch scroll would carry it with the finger. (scrollY itself
          // may shift a little while the cells above re-render with the engine's output: the browser's
          // scroll anchoring keeps the plane in place then.)
          const shifted = p.plot.getBoundingClientRect().top - ${start.top};
          const scrolled = window.scrollY - ${start.scrollY};
          const [x, y] = centre(p.area);
          const moved = [x - ${start.x}, y - ${start.y}];
          expect(log, failures, 'the page does not scroll under the finger', Math.abs(shifted) <= 2, 'the plane moved ' + shifted.toFixed(1) + ' px on screen, scrollY ' + scrolled);
          expect(log, failures, 'the circle follows the finger', Math.abs(moved[0] - ${dx}) <= 6 && Math.abs(moved[1] - (${dy})) <= 6, 'moved ' + moved.map((v) => v.toFixed(1)).join(', ') + ' px for ${dx}, ${dy}');
          await final(p, ${JSON.stringify(start.status)});
          expect(log, failures, 'the circle searches where it stopped', /in the engine/.test(p.status.textContent) && sameShape(shapeOf(h), JSON.parse(p.params())), p.params());
          return { log: ['moved ' + moved.map((v) => v.toFixed(1)).join(', ') + ' px; the plane moved ' + shifted.toFixed(1) + ' px on screen (scrollY ' + scrolled + '); ' + p.params()], failures };
        `));
      },
    },
    {
      name: 'at phone width a finger on the open plane scrolls past: the shape stays and the engine does not load',
      scenario: async (t: BrowserTab): Promise<Outcome> => {
        const tab = t as SwipeTab;
        if (!tab.swipe) return { log: [], failures: ['the runner gives no tab.swipe (real touch input), which this case needs'] };
        await tab.viewport(390, 844, { mobile: true });
        const start = await tab.evaluate<Outcome & { x?: number; y?: number; scrollY?: number; params?: string }>(scenario(`
          ${HELPERS}
          const h = await live('geo-explorer');
          if (!h) return { log: [], failures: ['the explorer did not go live'] };
          await settle(h);
          const p = parts(h);
          const pr = p.plot.getBoundingClientRect();
          // A point of the plane off the shape and its handle, low enough to swipe up from.
          const open = [[0.95, 0.9], [0.05, 0.9], [0.95, 0.75], [0.05, 0.75]].map(([fx, fy]) => [pr.left + pr.width * fx, pr.top + pr.height * fy])
            .find(([x, y]) => { const el = document.elementFromPoint(x, y); return el && p.plot.contains(el) && !el.closest('.geo-area, [data-handle]'); });
          if (!open) return { log: [], failures: ['no open point on the plane'] };
          return { log: [], failures: [], x: open[0], y: open[1], scrollY: window.scrollY, params: p.params() };
        `));
        if (start.failures.length) return start;
        await tab.swipe(start.x!, start.y!, start.x!, start.y! - 200, 10);
        return tab.evaluate<Outcome>(scenario(`
          ${HELPERS}
          const log = [], failures = [];
          const p = parts(host('geo-explorer'));
          await wait(800);
          const scrolled = window.scrollY - ${start.scrollY};
          expect(log, failures, 'the page scrolls', scrolled > 50, 'scrollY moved ' + scrolled);
          expect(log, failures, 'the shape did not move', p.params() === ${JSON.stringify(start.params)}, p.params());
          expect(log, failures, 'the engine did not load', !engineLoaded());
          return { log: ['scrollY moved ' + scrolled + ', shape at ' + p.params() + ', engine ' + (engineLoaded() ? 'loaded' : 'not loaded')], failures };
        `));
      },
    },
    {
      name: 'at phone width a tap on the circle runs nothing: the recording stays and the engine does not load',
      scenario: async (t: BrowserTab): Promise<Outcome> => {
        const tab = t as SwipeTab;
        if (!tab.swipe) return { log: [], failures: ['the runner gives no tab.swipe (real touch input), which this case needs'] };
        await tab.viewport(390, 844, { mobile: true });
        const start = await tab.evaluate<Outcome & { x?: number; y?: number; params?: string }>(scenario(`
          ${HELPERS}
          const h = await live('geo-explorer');
          if (!h) return { log: [], failures: ['the explorer did not go live'] };
          await settle(h);
          const p = parts(h);
          // The plane itself in the middle of the screen: a page's sticky bar may cover the top of a tall host.
          p.plot.scrollIntoView({ block: 'center', behavior: 'instant' });
          await settle(h);
          const [x, y] = centre(p.area);
          const hit = document.elementFromPoint(x, y);
          if (!hit || !hit.closest('.geo-area')) return { log: [], failures: ['the circle is not under its own center'] };
          return { log: [], failures: [], x, y, params: p.params() };
        `));
        if (start.failures.length) return start;
        // A finger that lands and lifts without moving: a tap.
        await tab.swipe(start.x!, start.y!, start.x!, start.y!, 1);
        return tab.evaluate<Outcome>(scenario(`
          ${HELPERS}
          const log = [], failures = [];
          const p = parts(host('geo-explorer'));
          await wait(800);
          expect(log, failures, 'the shape did not move', p.params() === ${JSON.stringify(start.params)}, p.params());
          expect(log, failures, 'the status still shows the recording', /^Recorded/.test(p.status.textContent), p.status.textContent.slice(0, 60));
          expect(log, failures, 'the engine did not load', !engineLoaded());
          return { log: ['after a tap: ' + p.params() + ', engine ' + (engineLoaded() ? 'loaded' : 'not loaded')], failures };
        `));
      },
    },
    {
      name: 'the point index button keeps focus, creates and drops the index, and the search runs again',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const start = await tab.evaluate<Outcome & { offHits?: number; status?: string; skip?: boolean }>(scenario(`
          ${HELPERS}
          const log = [], failures = [];
          const h = await live('geo-explorer');
          if (!h) return { log, failures: ['the explorer did not go live'] };
          if (!JSON.parse(h.dataset.attrs).index) return { log: ['this placement has no point index button (no index= on its directive); the button is checked where one is set'], failures: [], skip: true };
          const p = parts(h);
          const statement = () => h.querySelectorAll('.geo-code')[1];
          expect(log, failures, 'the button starts off and no index statement shows', p.index.getAttribute('aria-pressed') === 'false' && statement().hidden);
          // A search with the index off first, for its row.
          const s = p.status.textContent;
          h.querySelector('.geo-shape').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
          await final(p, s);
          p.index.focus();
          return { log, failures, offHits: Number(p.timing('off').cells[2].textContent), status: p.status.textContent };
        `));
        if (start.failures.length || start.skip) return start;
        // A real Space on the focused button: the keyboard user's press.
        await tab.press(' ', 'Space', 32);
        return tab.evaluate<Outcome>(scenario(`
          ${HELPERS}
          const log = ${JSON.stringify(start.log)}, failures = [];
          const h = host('geo-explorer');
          const p = parts(h);
          const statement = () => h.querySelectorAll('.geo-code')[1];
          const offHits = ${start.offHits};
          // Focus stays on the button while its statement runs, and after.
          let lost = null;
          await until(() => { if (document.activeElement !== p.index && lost === null) lost = document.activeElement?.tagName || 'nothing'; return p.index.getAttribute('aria-pressed') === 'true' && /point index on/.test(p.status.textContent); }, 60000);
          expect(log, failures, 'Space on the button keeps keyboard focus on it', lost === null && document.activeElement === p.index, lost ? 'focus went to ' + lost : '');
          const created = statement().textContent;
          const onHits = Number(p.timing('on').cells[2].textContent);
          expect(log, failures, 'the CREATE statement shows', !statement().hidden && /CREATE POINT INDEX \\w+/.test(created), created.slice(0, 80));
          expect(log, failures, 'the search ran again with the index on', /parse .* ms elapsed/.test(p.timing('on').textContent));
          expect(log, failures, 'the scan reads fewer places with the index', onHits < offHits, offHits + ' -> ' + onHits);
          const s0 = p.status.textContent;
          p.index.click();
          await until(() => p.index.getAttribute('aria-pressed') === 'false' && p.status.textContent !== s0 && /point index off/.test(p.status.textContent), 60000);
          expect(log, failures, 'the DROP statement shows and the search runs again', /DROP INDEX \\w+ IF EXISTS/.test(statement().textContent) && Number(p.timing('off').cells[2].textContent) === offHits, statement().textContent);
          // Reset empties the store: the explorer goes back to the recording.
          document.getElementById('engineBar').querySelector('[data-action=reset]').click();
          await until(() => /^Recorded/.test(p.status.textContent), 10000);
          expect(log, failures, 'Reset brings back the recorded result', /^Recorded/.test(p.status.textContent) && p.timing('on').cells[2].textContent === '-' && p.index.getAttribute('aria-pressed') === 'false', p.status.textContent.slice(0, 60));
          return { log: ['database hits: index off ' + offHits + ', on ' + onHits], failures };
        `));
      },
    },
  ],
} satisfies BrowserCases;
