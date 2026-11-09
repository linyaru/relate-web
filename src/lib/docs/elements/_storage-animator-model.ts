// The storage animator's model (`:::storage-animator`, DOCS-PLAN.md §7.3):
// the facts it draws, the store it steps through, what a crash loses in each
// durability mode, and the drawings. Free of Node and DOM imports: the build
// side (storage-animator.ts) draws the static form with it, in the site's
// colours, and the browser module draws every live frame with it, in CSS
// variables, so the two pictures are one drawing.
//
// Nothing here runs the engine. The WASM build opens an in-memory store with
// no files to sync, so the browser cannot show a WAL, a sync or a checkpoint;
// the element is a diagram of documented behaviour, and every sentence and
// number in it is one the storage pages already verify against the release
// binary (each fact names its page). Where a page gives a rule but no
// number, the drawing gives none either: sizes inside a `.rl` file are not to
// scale, and no byte count is shown.

/** The three views, in the order a page lists them by default. */
export const SCENES = ['write-path', 'durability', 'rl-file'] as const;
export type Scene = (typeof SCENES)[number];

/** The durability modes, as `--durability-mode` spells them (checked against cli.json by the build side). */
export const MODES = ['full', 'everysecond', 'snapshot'] as const;
export type Mode = (typeof MODES)[number];
export const DEFAULT_MODE: Mode = 'full';

/**
 * The numbers the element states. Each is verified on a storage page:
 * concepts/storage-and-durability, reference/storage/wal-and-checkpoints,
 * reference/storage/formats, guides/operate/durability-modes.
 */
export const FACTS = {
  /** `--checkpoint-interval-secs` and RELATE_CHECKPOINT_INTERVAL_SECS default (cli.json). */
  checkpointIntervalSecs: 300,
  /** A checkpoint starts when the open segment holds this many bytes (wal-and-checkpoints, "When a checkpoint runs"). */
  segmentBytes: '64 MiB',
  /** …or this many commits (wal-and-checkpoints; its 10,001-commit example shows it). */
  segmentCommits: '10,000',
  /** The `.rl` container's version marker (formats, "Version markers"; `relate info` prints `superblock version: 1`). */
  rlMagic: 'MDBCLB01',
  rlVersion: 1,
} as const;

/** Per-scene names, for the scene switch and the picture's panel titles. */
export const SCENE_TITLES: Record<Scene, string> = {
  'write-path': 'Write path',
  durability: 'Durability modes',
  'rl-file': 'One .rl file',
};

// ---------------------------------------------------------------- the store the write path and the .rl view step through

export interface Segment {
  /** The segment id: `wal/<8 digits>.log`. */
  id: number;
  /** The LSNs of its records. */
  records: number[];
  closed: boolean;
}

export interface StoreState {
  /** The last LSN a commit took. */
  lsn: number;
  segments: Segment[];
  /** The snapshot's checkpoint LSN. */
  checkpointLsn: number;
  /** The highest LSN applied to the in-memory graph; null while the process is down (after a crash, before the open loads). */
  graphLsn: number | null;
  /** The commit in flight, and how far it has gone. */
  pending: { lsn: number; stage: 'collect' | 'record' | 'appended' | 'synced' | 'applied' | 'acked' } | null;
  /** The checkpoint in flight. */
  checkpoint: { stage: 'rotate' | 'pin' | 'write' | 'publish' | 'recycle'; pinned: number | null } | null;
  /** In the .rl view: the file's size in drawing units, which grows to the most its parts have needed and never shrinks. */
  rlHigh: number;
  /** The parts a step points at (the drawing marks them). */
  focus: string[];
  /** The LSN of a record that just arrived, drawn as new. */
  arrived: number | null;
}

/** The store as a fresh `.rl` file is after its seed run closed cleanly and it was opened again: checkpoint LSN 1, the open segment empty (wal-and-checkpoints, Examples). */
export function initialStore(): StoreState {
  const s: StoreState = {
    lsn: 1,
    segments: [{ id: 2, records: [], closed: false }],
    checkpointLsn: 1,
    graphLsn: 1,
    pending: null,
    checkpoint: null,
    rlHigh: 0,
    focus: [],
    arrived: null,
  };
  s.rlHigh = rlContentHeight(s);
  return s;
}

const cloneStore = (s: StoreState): StoreState => ({
  ...s,
  segments: s.segments.map((g) => ({ ...g, records: [...g.records] })),
  pending: s.pending && { ...s.pending },
  checkpoint: s.checkpoint && { ...s.checkpoint },
  focus: [...s.focus],
});

export const segmentName = (id: number) => `${String(id).padStart(8, '0')}.log`;
const openSegment = (s: StoreState) => s.segments[s.segments.length - 1];

/** One step of an action: what it says, and what it does to the store. */
export interface Step {
  say: string;
  apply: (s: StoreState) => void;
}

/** A step's result: a new store, the step applied, the .rl file grown if it must. */
export function applyStep(s: StoreState, step: Step): StoreState {
  const next = cloneStore(s);
  next.focus = [];
  next.arrived = null;
  step.apply(next);
  next.rlHigh = Math.max(next.rlHigh, rlContentHeight(next));
  return next;
}

export type Action = 'commit' | 'checkpoint' | 'crash';

/** Why an action cannot run on this store now, or null. */
export function refusal(s: StoreState, action: Action): string | null {
  if (action === 'checkpoint' && s.graphLsn !== null && s.lsn === s.checkpointLsn) {
    return 'Nothing to checkpoint: the WAL holds no commit the snapshot lacks.';
  }
  return null;
}

/**
 * The steps of an action on the store as it is when the action starts, under
 * `full` (the write path's mode). Commit: wal-and-checkpoints "What a commit
 * appends" and the concept page's write path; the sync comes before the apply
 * under `full`, and a relaxed mode acknowledges after the apply instead.
 * Checkpoint: wal-and-checkpoints "What a checkpoint does", step for step.
 * Crash: the concept page's recovery and wal-and-checkpoints "What replay
 * does on open".
 */
export function stepsFor(s: StoreState, action: Action, view: 'write-path' | 'rl-file'): Step[] {
  const inFile = view === 'rl-file';
  if (action === 'commit') {
    const n = s.lsn + 1;
    const seg = segmentName(openSegment(s).id);
    return [
      {
        say: 'The statement runs and collects its changes privately; nothing is written yet.',
        apply: (t) => {
          t.pending = { lsn: n, stage: 'collect' };
          t.focus = ['statement'];
        },
      },
      {
        say: `At commit, the changes become one record with LSN ${n}: physical changes to nodes, relationships, labels and properties, not Cypher text.`,
        apply: (t) => {
          t.pending = { lsn: n, stage: 'record' };
          t.focus = ['record'];
        },
      },
      {
        say: inFile
          ? `The record is appended to the open segment, wal/${seg}, inside the file.`
          : `The record is appended to the open WAL segment, wal/${seg}.`,
        apply: (t) => {
          openSegment(t).records.push(n);
          t.lsn = n;
          t.pending = { lsn: n, stage: 'appended' };
          t.focus = ['wal', 'append'];
          t.arrived = n;
        },
      },
      {
        say: inFile
          ? 'Under full, the default durability mode, the file is synced to disk before the commit returns; commits waiting together share one sync.'
          : 'Under full, the default durability mode, the WAL is synced to disk before the commit returns; commits waiting together share one sync.',
        apply: (t) => {
          t.pending = { lsn: n, stage: 'synced' };
          t.focus = ['wal', 'sync'];
        },
      },
      {
        say: 'The changes are applied to the in-memory graph, where every query reads.',
        apply: (t) => {
          t.graphLsn = n;
          t.pending = { lsn: n, stage: 'applied' };
          t.focus = ['graph', 'apply'];
        },
      },
      {
        say: `The commit is acknowledged. LSN ${n} is in the WAL on disk and in the graph; the snapshot still holds LSN ${s.checkpointLsn}.`,
        apply: (t) => {
          t.pending = null;
          t.focus = ['statement'];
        },
      },
    ];
  }
  if (action === 'checkpoint') {
    const open = openSegment(s);
    const pinned = open.records.length ? open.records[open.records.length - 1] : s.lsn;
    const next = segmentName(open.id + 1);
    return [
      {
        say: `Rotate: the open segment, wal/${segmentName(open.id)}, closes. New commits go to wal/${next}, so writers do not stop.`,
        apply: (t) => {
          openSegment(t).closed = true;
          t.segments.push({ id: open.id + 1, records: [], closed: false });
          t.checkpoint = { stage: 'rotate', pinned: null };
          t.focus = ['wal'];
        },
      },
      {
        say: `Pin: the checkpoint takes LSN ${pinned}, the last record of the newest closed segment.`,
        apply: (t) => {
          t.checkpoint = { stage: 'pin', pinned };
          t.focus = ['wal', 'checkpoint'];
        },
      },
      {
        say: inFile
          ? `Write: the committed state up to LSN ${pinned} goes through the codec into new snapshot files inside the file, under temporary names.`
          : `Write: the committed state up to LSN ${pinned} goes through the store's codec into snapshot files, under temporary names.`,
        apply: (t) => {
          t.checkpoint = { stage: 'write', pinned };
          t.focus = ['checkpoint', 'snapshot'];
        },
      },
      {
        say: `Publish: the files are renamed into place, manifest.json last, and the snapshot's checkpoint LSN is ${pinned}. A crash before this step leaves the previous snapshot in force.`,
        apply: (t) => {
          t.checkpointLsn = pinned;
          t.checkpoint = { stage: 'publish', pinned };
          t.focus = ['snapshot'];
        },
      },
      {
        say: inFile
          ? `Recycle: closed segments at or below LSN ${pinned} are deleted. The file keeps their space and later writes reuse it; a .rl file does not shrink.`
          : `Recycle: closed segments whose last record is at or below LSN ${pinned} are deleted.`,
        apply: (t) => {
          t.segments = t.segments.filter((g) => !g.closed || (g.records.at(-1) ?? 0) > pinned);
          t.checkpoint = null;
          t.focus = inFile ? ['wal', 'free'] : ['wal', 'recycle'];
        },
      },
    ];
  }
  // crash
  const replay = s.lsn - s.checkpointLsn;
  return [
    {
      say: `The process crashes. The in-memory graph is gone; the snapshot (LSN ${s.checkpointLsn}) and the synced WAL are on disk.`,
      apply: (t) => {
        t.graphLsn = null;
        t.pending = null;
        t.checkpoint = null;
        t.focus = ['graph'];
      },
    },
    {
      say: `The next open loads the latest snapshot: the state at checkpoint LSN ${s.checkpointLsn}.`,
      apply: (t) => {
        t.graphLsn = s.checkpointLsn;
        t.focus = ['snapshot', 'load', 'graph'];
      },
    },
    {
      say: replay
        ? `It replays the WAL records with an LSN above ${s.checkpointLsn}, in LSN order: ${replay === 1 ? '1 record' : `${replay} records`}.`
        : `No WAL record has an LSN above ${s.checkpointLsn}, so there is nothing to replay.`,
      apply: (t) => {
        t.graphLsn = s.lsn;
        t.focus = replay ? ['wal', 'replay', 'graph'] : ['graph'];
      },
    },
    {
      say: `Under full, every acknowledged commit is back: the graph holds LSN ${s.lsn}. A record a crash cuts short at the very end of the WAL was never acknowledged, and the open drops it.`,
      apply: (t) => {
        t.focus = ['graph'];
      },
    },
  ];
}

/** The store a static picture shows: two commits after the seed, and (for the .rl view) the checkpoint after them. */
export function pictureStore(view: 'write-path' | 'rl-file'): StoreState {
  let s = initialStore();
  const run = (action: Action) => {
    for (const step of stepsFor(s, action, view)) s = applyStep(s, step);
  };
  run('commit');
  run('commit');
  if (view === 'rl-file') run('checkpoint');
  s.focus = [];
  s.arrived = null;
  return s;
}

// ---------------------------------------------------------------- what a crash can lose

/**
 * The timeline the durability view draws: acknowledged writes in the ten
 * seconds after a completed checkpoint, at times picked for the drawing. The
 * syncs are `everysecond`'s background syncs, about once a second
 * (durability-modes; a slow disk or a delayed sync widens the window).
 */
export const TIMELINE = {
  seconds: 10,
  commits: [0.5, 1.2, 1.9, 2.4, 3.1, 3.7, 4.2, 4.5, 5.3, 6.0, 6.6, 7.2, 7.9, 8.5, 9.1, 9.7],
  syncs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  crash: 4.6,
  minCrash: 0.6,
} as const;

export interface Loss {
  mode: Mode;
  crash: number;
  /** The writes acknowledged before the crash. */
  acked: number[];
  /** The ones the crash can take back. */
  lost: number[];
  /** Where the loss window opens (the last sync or checkpoint), or null when there is none. */
  from: number | null;
}

/** What a crash at `crash` seconds can lose under `mode` (concepts/storage-and-durability, "Durability modes and their loss windows"). */
export function loss(mode: Mode, crash: number): Loss {
  const acked = TIMELINE.commits.filter((t) => t < crash);
  if (mode === 'full') return { mode, crash, acked, lost: [], from: null };
  const from = mode === 'everysecond' ? Math.max(0, ...TIMELINE.syncs.filter((t) => t <= crash)) : 0;
  return { mode, crash, acked, lost: acked.filter((t) => t > from), from };
}

/** Seconds as the drawing prints them: one decimal, no trailing zero. */
export const secs = (n: number) => `${Number(n.toFixed(1))} s`;

const writes = (n: number) => (n === 1 ? '1 write' : `${n} writes`);

/** One sentence on what a crash at that time can lose under that mode. */
export function lossSentence(l: Loss): string {
  const n = l.acked.length;
  if (l.mode === 'full') {
    return `Under full, all ${writes(n)} acknowledged before the crash come back: each returned only after its WAL record was synced.`;
  }
  if (l.mode === 'everysecond') {
    const span = l.from === null ? 0 : l.crash - l.from;
    const lost = l.lost.length;
    return lost
      ? `Under everysecond, the last background sync was at ${secs(l.from ?? 0)}, so the ${writes(lost)} acknowledged in the ${secs(span)} after it can be lost. Slow storage or a delayed sync makes the window longer.`
      : `Under everysecond, the last background sync was at ${secs(l.from ?? 0)} and no write was acknowledged after it, so nothing acknowledged is lost. Slow storage or a delayed sync makes the window longer.`;
  }
  return `Under snapshot, nothing is synced on commit, so all ${writes(n)} acknowledged since the last completed checkpoint can be lost. The next timed checkpoint is due at ${FACTS.checkpointIntervalSecs} s; a WAL segment that fills, or a clean close, checkpoints sooner.`;
}

// ---------------------------------------------------------------- drawing

/** The colours a drawing uses: hex values in a static picture, CSS variables live. */
export interface Palette {
  surface: string;
  node: string;
  secondary: string;
  fg: string;
  fgMuted: string;
  line: string;
  rule: string;
  accent: string;
  accentFill: string;
  good: string;
  goodFill: string;
  bad: string;
  badFill: string;
  font: string;
  mono: string;
}

/** The drawing's style rules, scoped to the SVG with id `scope`. */
export function svgStyle(scope: string, p: Palette): string {
  const s = `#${scope}`;
  return [
    `${s}{font-family:${p.font}}`,
    `${s} .zone{fill:none;stroke:${p.rule};stroke-width:1;stroke-dasharray:6 5}`,
    `${s} .zl{font-size:12px;font-weight:600;fill:${p.fgMuted};letter-spacing:.04em}`,
    `${s} .box{fill:${p.node};stroke:${p.line};stroke-width:1.5}`,
    `${s} .on .box{fill:${p.accentFill};stroke:${p.accent};stroke-width:2.5}`,
    `${s} .gone .box{fill:none;stroke-dasharray:5 4}`,
    `${s} .t{font-size:14px;font-weight:600;fill:${p.fg}}`,
    `${s} .s{font-size:12px;fill:${p.fgMuted}}`,
    `${s} .m{font-family:${p.mono};font-size:11.5px;fill:${p.fg}}`,
    `${s} .pt{font-size:15px;font-weight:600;fill:${p.fg}}`,
    `${s} .arrow path{fill:none;stroke:${p.line};stroke-width:1.5}`,
    `${s} .arrow polygon{fill:${p.line}}`,
    `${s} .arrow.dash path{stroke-dasharray:5 4}`,
    `${s} .arrow.on path{stroke:${p.accent};stroke-width:2.5}`,
    `${s} .arrow.on polygon{fill:${p.accent}}`,
    `${s} .al{font-size:12px;fill:${p.fgMuted}}`,
    `${s} .arrow.on .al{fill:${p.fg};font-weight:600}`,
    `${s} .rec{fill:${p.secondary};stroke:${p.line};stroke-width:1}`,
    `${s} .rec.new{fill:${p.accentFill};stroke:${p.accent};stroke-width:2}`,
    `${s} .rt{font-size:10.5px;fill:${p.fg};text-anchor:middle}`,
    `${s} .seg{fill:${p.surface};stroke:${p.rule};stroke-width:1}`,
    `${s} .sync{fill:${p.goodFill};stroke:${p.good};stroke-width:1.5}`,
    `${s} .syt{font-size:11px;font-weight:600;fill:${p.fg}}`,
    `${s} .free{fill:none;stroke:${p.line};stroke-width:1.2;stroke-dasharray:4 4}`,
    `${s} .axis{stroke:${p.fgMuted};stroke-width:1}`,
    `${s} .tick{stroke:${p.fgMuted};stroke-width:1}`,
    `${s} .tl{font-size:11px;fill:${p.fgMuted};text-anchor:middle}`,
    `${s} .cp{stroke:${p.fg};stroke-width:2.5}`,
    `${s} .sy{stroke:${p.good};stroke-width:2}`,
    `${s} .crash{stroke:${p.bad};stroke-width:2.5}`,
    `${s} .ct{font-size:12px;font-weight:600;fill:${p.bad}}`,
    `${s} .win{fill:${p.badFill};stroke:${p.bad};stroke-width:1;stroke-dasharray:4 3}`,
    `${s} .ok{fill:${p.good};stroke:${p.good};stroke-width:1.5}`,
    `${s} .lost{fill:${p.surface};stroke:${p.bad};stroke-width:2}`,
    `${s} .x{stroke:${p.bad};stroke-width:1.8}`,
    `${s} .mode{font-family:${p.mono};font-size:13px;font-weight:600;fill:${p.fg}}`,
    `${s} .row.on .mode{fill:${p.accent}}`,
    `${s} .wt{font-size:11.5px;font-weight:600;fill:${p.bad}}`,
    `${s} .note{font-size:12px;fill:${p.fgMuted}}`,
    `${s} .band{fill:${p.node};stroke:${p.line};stroke-width:1.2}`,
    `${s} .on .band{fill:${p.accentFill};stroke:${p.accent};stroke-width:2.5}`,
    `${s} .file{fill:${p.surface};stroke:${p.fg};stroke-width:2}`,
  ].join('');
}

const esc = (v: unknown) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const text = (cls: string, x: number, y: number, body: string, anchor?: 'start' | 'middle' | 'end') =>
  `<text class="${cls}" x="${x}" y="${y}"${anchor && anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}>${esc(body)}</text>`;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function part(id: string, b: Box, title: string, lines: string[], state: { on: boolean; gone?: boolean }, extra = ''): string {
  const cls = ['part', state.on ? 'on' : '', state.gone ? 'gone' : ''].filter(Boolean).join(' ');
  const rows = lines.map((l, i) => text('s', b.x + 10, b.y + 38 + i * 15, l)).join('');
  return `<g class="${cls}" data-part="${id}"><rect class="box" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6"/>${text('t', b.x + 10, b.y + 20, title)}${rows}${extra}</g>`;
}

/** An arrow through `points` with its head at the last one; `label` sits at `at`. */
function arrow(id: string, points: [number, number][], opts: { on: boolean; dash?: boolean; label?: string; at?: [number, number]; anchor?: 'start' | 'middle' | 'end' }): string {
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  const [x1, y1] = points[points.length - 2];
  const [x2, y2] = points[points.length - 1];
  const a = Math.atan2(y2 - y1, x2 - x1);
  const len = 9;
  const wing = 4.5;
  const bx = x2 - len * Math.cos(a);
  const by = y2 - len * Math.sin(a);
  const head = [
    [x2, y2],
    [bx - wing * Math.sin(a), by + wing * Math.cos(a)],
    [bx + wing * Math.sin(a), by - wing * Math.cos(a)],
  ]
    .map(([x, y]) => `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`)
    .join(' ');
  const cls = ['arrow', opts.on ? 'on' : '', opts.dash ? 'dash' : ''].filter(Boolean).join(' ');
  const label = opts.label && opts.at ? text('al', opts.at[0], opts.at[1], opts.label, opts.anchor) : '';
  return `<g class="${cls}" data-part="${id}"><path d="${d}"/><polygon points="${head}"/>${label}</g>`;
}

/** Record chips in a row: the last few LSNs of a segment, the newest marked. */
function chips(records: number[], x: number, y: number, room: number, arrived: number | null): string {
  const w = 30;
  const gap = 4;
  const fit = Math.max(1, Math.floor((room + gap) / (w + gap)));
  const shown = records.length > fit ? records.slice(records.length - (fit - 1)) : records;
  const more = records.length - shown.length;
  let out = '';
  let cx = x;
  if (more) {
    out += text('s', cx, y + 14, `+${more}`);
    cx += w + gap;
  }
  for (const lsn of shown) {
    const fresh = lsn === arrived ? ' new' : '';
    out += `<g class="chip${fresh}"><rect class="rec${fresh}" x="${cx}" y="${y}" width="${w}" height="19" rx="3"/>${text('rt', cx + w / 2, y + 13.5, String(lsn))}</g>`;
    cx += w + gap;
  }
  return out;
}

/** The WAL's segment rows inside a box: name, open or closed, and record chips. */
function segmentRows(s: StoreState, x: number, y: number, w: number): string {
  return s.segments
    .map((g, i) => {
      const top = y + i * 26;
      const label = `${segmentName(g.id)}${g.closed ? '' : ' (open)'}`;
      return (
        `<rect class="seg" x="${x}" y="${top}" width="${w}" height="23" rx="3"/>` +
        text('m', x + 6, top + 15.5, label) +
        (g.records.length ? chips(g.records, x + 150, top + 2, w - 154, s.arrived) : text('s', x + 150, top + 15.5, 'no records'))
      );
    })
    .join('');
}

export interface Drawing {
  width: number;
  height: number;
  body: string;
  /** What the drawing shows, in words: the SVG's desc. */
  desc: string;
}

const has = (s: StoreState, id: string) => s.focus.includes(id);

/** The write path: memory above, disk below; arrows for append, apply, checkpoint, recycle, load and replay. */
export function drawWritePath(s: StoreState): Drawing {
  const W = 760;
  const statement: Box = { x: 24, y: 46, w: 136, h: 62 };
  const record: Box = { x: 200, y: 46, w: 150, h: 62 };
  const graph: Box = { x: 540, y: 46, w: 180, h: 62 };
  const wal: Box = { x: 140, y: 196, w: 300, h: 40 + Math.max(1, s.segments.length) * 26 };
  const snap: Box = { x: 540, y: 196, w: 180, h: 76 };
  const H = Math.max(snap.y + snap.h, wal.y + wal.h) + 20;
  const p = s.pending;
  const statementLines = p ? [`commit, LSN ${p.lsn}`] : has(s, 'statement') ? ['acknowledged'] : ['a write'];
  const recordLines = p && p.stage !== 'collect' ? [`LSN ${p.lsn}`, 'physical changes'] : ['physical changes,', 'not Cypher text'];
  const graphLines = s.graphLsn === null ? ['gone: the process crashed'] : [`commits up to LSN ${s.graphLsn}`, 'every query reads here'];
  const cp = s.checkpoint;
  const snapLines =
    cp && cp.stage === 'write' ? ['manifest.json, codec files', `writing LSN ${cp.pinned}`, 'under temporary names'] : ['manifest.json, codec files', `checkpoint LSN ${s.checkpointLsn}`];
  const synced = has(s, 'sync');
  const walExtra =
    segmentRows(s, wal.x + 10, wal.y + 30, wal.w - 20) +
    (synced ? `<rect class="sync" x="${wal.x + wal.w - 82}" y="${wal.y + 6}" width="72" height="20" rx="10"/>${text('syt', wal.x + wal.w - 46, wal.y + 20, 'synced', 'middle')}` : '');
  const body = [
    `<rect class="zone" x="8" y="8" width="${W - 16}" height="124" rx="8"/>`,
    text('zl', 18, 26, 'IN MEMORY'),
    `<rect class="zone" x="8" y="156" width="${W - 16}" height="${H - 164}" rx="8"/>`,
    text('zl', 18, 174, 'ON DISK, IN THE STORE'),
    arrow('run', [[statement.x + statement.w, 77], [record.x, 77]], { on: has(s, 'record') }),
    arrow('apply', [[record.x + record.w, 77], [graph.x, 77]], { on: has(s, 'apply'), label: 'apply', at: [445, 70], anchor: 'middle' }),
    arrow('append', [[275, record.y + record.h], [275, wal.y]], { on: has(s, 'append'), label: 'append', at: [283, 146], anchor: 'start' }),
    arrow('checkpoint', [[600, graph.y + graph.h], [600, snap.y]], { on: has(s, 'checkpoint'), label: 'checkpoint', at: [592, 146], anchor: 'end' }),
    arrow('load', [[670, snap.y], [670, graph.y + graph.h]], { on: has(s, 'load'), dash: true, label: 'open: load', at: [677, 146], anchor: 'start' }),
    arrow('replay', [[wal.x + wal.w, wal.y + 12], [graph.x + 14, graph.y + graph.h]], { on: has(s, 'replay'), dash: true, label: 'open: replay', at: [466, 176], anchor: 'end' }),
    arrow('recycle', [[snap.x, 250], [wal.x + wal.w, 250]], { on: has(s, 'recycle'), dash: true, label: 'recycles', at: [490, 244], anchor: 'middle' }),
    part('statement', statement, 'Statement', statementLines, { on: has(s, 'statement') }),
    part('record', record, 'Commit record', recordLines, { on: has(s, 'record') }),
    part('graph', graph, 'In-memory graph', graphLines, { on: has(s, 'graph'), gone: s.graphLsn === null }),
    part('wal', wal, 'Write-ahead log (WAL)', [], { on: has(s, 'wal') }, walExtra),
    part('snapshot', snap, 'Snapshot', snapLines, { on: has(s, 'snapshot') }),
  ].join('');
  const segs = s.segments.map((g) => `${segmentName(g.id)} ${g.records.length ? `holding LSN ${g.records.join(', ')}` : 'with no records'}${g.closed ? ' (closed)' : ' (open)'}`).join('; ');
  const desc =
    `In memory: a statement, its commit record, and the in-memory graph (${s.graphLsn === null ? 'gone after a crash' : `commits up to LSN ${s.graphLsn}`}). ` +
    `On disk: the WAL (${segs}) and the snapshot at checkpoint LSN ${s.checkpointLsn}. ` +
    'A commit record is appended to the WAL, then applied to the graph; a checkpoint writes the graph to the snapshot and recycles the segments it covers; an open loads the snapshot and replays the WAL.';
  return { width: W, height: H, body, desc };
}

/** What each mode can lose: one timeline row per mode, the crash at `crash` seconds. `width` follows the column live. */
export function drawDurability(modes: readonly Mode[], crash: number, width = 760, selected: Mode | null = null): Drawing {
  const W = Math.max(300, Math.round(width));
  const narrow = W < 460;
  const left = narrow ? 94 : 116;
  const right = W - 18;
  const top = 34;
  const rowH = 74;
  const x = (t: number) => left + ((right - left) * t) / TIMELINE.seconds;
  const out: string[] = [];
  // The crash line through every row, labelled at the top.
  const cx = x(crash);
  const labelRight = cx < right - 90;
  out.push(text('ct', labelRight ? cx + 6 : cx - 6, 18, `crash at ${secs(crash)}`, labelRight ? 'start' : 'end'));
  modes.forEach((mode, i) => {
    const y0 = top + i * rowH;
    const base = y0 + 44;
    const l = loss(mode, crash);
    const row: string[] = [];
    row.push(text('mode', 12, base + 4, mode));
    row.push(`<line class="axis" x1="${left}" y1="${base}" x2="${right}" y2="${base}"/>`);
    if (l.lost.length && l.from !== null) {
      row.push(`<rect class="win" x="${x(l.from)}" y="${base - 22}" width="${Math.max(2, cx - x(l.from))}" height="34" rx="3"/>`);
      const say = `can lose ${writes(l.lost.length)}`;
      const sayW = say.length * 6.6;
      // Centred over a wide window; beside the crash line, clear of it, over a narrow one.
      if (cx - x(l.from) >= sayW + 8) row.push(text('wt', (x(l.from) + cx) / 2, base - 28, say, 'middle'));
      else if (cx - left >= sayW + 8) row.push(text('wt', cx - 6, base - 28, say, 'end'));
      else row.push(text('wt', cx + 6, base - 28, say, 'start'));
    } else {
      const say = mode === 'full' ? 'no acknowledged write lost' : 'nothing acknowledged lost';
      const fits = cx + 8 + say.length * 6.4 < right;
      row.push(text('note', fits ? cx + 8 : cx - 8, base - 28, say, fits ? 'start' : 'end'));
    }
    if (mode === 'everysecond') for (const t of TIMELINE.syncs) row.push(`<line class="sy" x1="${x(t)}" y1="${base - 9}" x2="${x(t)}" y2="${base + 9}"/>`);
    row.push(`<line class="cp" x1="${x(0)}" y1="${base - 16}" x2="${x(0)}" y2="${base + 16}"/>`);
    for (const t of l.acked) {
      const lost = l.lost.includes(t);
      const px = x(t);
      row.push(
        lost
          ? `<circle class="lost" cx="${px}" cy="${base}" r="5.5"/><line class="x" x1="${px - 3.4}" y1="${base - 3.4}" x2="${px + 3.4}" y2="${base + 3.4}"/><line class="x" x1="${px - 3.4}" y1="${base + 3.4}" x2="${px + 3.4}" y2="${base - 3.4}"/>`
          : `<circle class="ok" cx="${px}" cy="${base}" r="5"/>`,
      );
    }
    out.push(`<g class="row${selected === mode ? ' on' : ''}" data-mode="${mode}">${row.join('')}</g>`);
  });
  const end = top + modes.length * rowH;
  out.push(`<line class="crash" x1="${cx}" y1="24" x2="${cx}" y2="${end}"/>`);
  // The time axis, once, under the rows.
  for (let t = 0; t <= TIMELINE.seconds; t++) {
    if (narrow && t % 2) continue;
    out.push(`<line class="tick" x1="${x(t)}" y1="${end}" x2="${x(t)}" y2="${end + 5}"/>${text('tl', x(t), end + 18, `${t}`)}`);
  }
  out.push(text('tl', (left + right) / 2, end + 34, 'seconds since the last completed checkpoint'));
  // A legend, flowed into rows: shape and line style carry the meaning, not colour alone.
  const cross = (px: number, py: number) =>
    `<line class="x" x1="${px - 3.4}" y1="${py - 3.4}" x2="${px + 3.4}" y2="${py + 3.4}"/><line class="x" x1="${px - 3.4}" y1="${py + 3.4}" x2="${px + 3.4}" y2="${py - 3.4}"/>`;
  const items: { mark: (mx: number, my: number) => string; label: string }[] = [
    { mark: (mx, my) => `<line class="cp" x1="${mx}" y1="${my - 12}" x2="${mx}" y2="${my + 4}"/>`, label: 'completed checkpoint' },
    { mark: (mx, my) => `<circle class="ok" cx="${mx}" cy="${my - 4}" r="5"/>`, label: 'acknowledged, survives' },
    { mark: (mx, my) => `<circle class="lost" cx="${mx}" cy="${my - 4}" r="5.5"/>${cross(mx, my - 4)}`, label: 'acknowledged, can be lost' },
  ];
  if (modes.includes('everysecond')) items.push({ mark: (mx, my) => `<line class="sy" x1="${mx}" y1="${my - 11}" x2="${mx}" y2="${my + 3}"/>`, label: 'background sync' });
  let lx = 16;
  let ly = end + 58;
  for (const it of items) {
    const w = 14 + it.label.length * 6.4 + 22;
    if (lx + w > W - 8 && lx > 16) {
      lx = 16;
      ly += 22;
    }
    out.push(it.mark(lx + 4, ly) + text('note', lx + 14, ly, it.label));
    lx += w;
  }
  const desc = `Acknowledged writes on a ten-second timeline after a completed checkpoint, with a crash at ${secs(crash)}. ` + modes.map((m) => lossSentence(loss(m, crash))).join(' ');
  return { width: W, height: Math.ceil(ly + 12), body: out.join(''), desc };
}

/** One `.rl` file's parts, top to bottom (a logical view, not byte positions), in drawing units; the file's outline is the high-water mark. */
const RL = { pad: 10, superblock: 46, snapshot: 64, newSnapshot: 50, walHead: 30, segRow: 26, gap: 8 };

function rlContentHeight(s: StoreState): number {
  const newSnap = s.checkpoint && s.checkpoint.stage === 'write' ? RL.newSnapshot + RL.gap : 0;
  return RL.pad * 2 + RL.superblock + RL.gap + RL.snapshot + RL.gap + newSnap + RL.walHead + s.segments.length * RL.segRow + 6;
}

/** The parts of one `.rl` file: superblock, snapshot, WAL, and the space it keeps and reuses. `width` follows the column live. */
export function drawRlFile(s: StoreState, width = 760): Drawing {
  const W = Math.max(300, Math.round(width));
  const notes = W >= 600;
  const fx = 16;
  const fw = notes ? 330 : W - 32;
  const fy = 40;
  const iw = fw - RL.pad * 2;
  const ix = fx + RL.pad;
  let y = fy + RL.pad;
  const parts: string[] = [];
  const band = (id: string, h: number, title: string, lines: string[], on: boolean, extra = '') => {
    parts.push(
      `<g class="part${on ? ' on' : ''}" data-part="${id}"><rect class="band" x="${ix}" y="${y}" width="${iw}" height="${h}" rx="4"/>${text('t', ix + 10, y + 19, title)}` +
        lines.map((l, i) => text('s', ix + 10, y + 36 + i * 14, l)).join('') +
        extra +
        '</g>',
    );
    y += h + RL.gap;
  };
  band('superblock', RL.superblock, 'Superblock', [`${FACTS.rlMagic}, version ${FACTS.rlVersion}`], has(s, 'superblock'));
  band('snapshot', RL.snapshot, 'Snapshot', ['manifest.json and the codec\'s files', `checkpoint LSN ${s.checkpointLsn}`], has(s, 'snapshot'));
  if (s.checkpoint && s.checkpoint.stage === 'write') band('new-snapshot', RL.newSnapshot, 'New snapshot files', [`LSN ${s.checkpoint.pinned}, under temporary names`], true);
  const walH = RL.walHead + s.segments.length * RL.segRow;
  const synced = has(s, 'sync');
  const syncBadge = synced ? `<rect class="sync" x="${ix + iw - 80}" y="${y + 5}" width="70" height="20" rx="10"/>${text('syt', ix + iw - 45, y + 19, 'synced', 'middle')}` : '';
  band('wal', walH, 'WAL', [], has(s, 'wal'), segmentRows(s, ix + 8, y + 26, iw - 16) + syncBadge);
  const used = y - fy - RL.gap + RL.pad + 6;
  const high = Math.max(s.rlHigh, used);
  const free = high - used;
  if (free >= 16) {
    const fyy = y - RL.gap + 6;
    const fh = free - 6;
    parts.push(
      `<g class="part${has(s, 'free') ? ' on' : ''}" data-part="free"><rect class="free" x="${ix}" y="${fyy}" width="${iw}" height="${fh}" rx="4"/>` +
        (fh >= 20 ? text('s', ix + 10, fyy + Math.min(fh - 6, 16), 'space it keeps and reuses') : '') +
        '</g>',
    );
  }
  const fh = high;
  const H = fy + fh + 30;
  const out = [
    text('t', fx, 24, 'team.rl: one file'),
    `<rect class="file" x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="8"/>`,
    ...parts,
    text('note', fx, fy + fh + 20, 'A logical view of its parts, not to scale.'),
  ];
  if (notes) {
    const nx = fx + fw + 24;
    const lines = [
      ['The writer holds the file itself:', 'no lock files sit beside it.'],
      ['A --read-only open is refused', 'while a writer holds the file.'],
      ['It grows to the most space its', 'snapshot and WAL needed at once,', 'then reuses it; it never shrinks.'],
      ['relate clone writes a compact copy', 'that holds only the current state.'],
    ];
    let ny = fy + 18;
    for (const group of lines) {
      group.forEach((l, i) => out.push(text('note', nx, ny + i * 16, l)));
      ny += group.length * 16 + 14;
    }
  }
  const segs = s.segments.map((g) => `${segmentName(g.id)}${g.records.length ? ` holding LSN ${g.records.join(', ')}` : ' with no records'}`).join('; ');
  const desc =
    `One .rl file holding, top to bottom: the superblock (${FACTS.rlMagic}, version ${FACTS.rlVersion}); the snapshot (manifest.json and the codec's files) at checkpoint LSN ${s.checkpointLsn}; ` +
    `the WAL (${segs})${free >= 16 ? '; and space the file keeps from parts it no longer needs and reuses for later writes' : ''}. The parts are drawn in logical order, not to scale.`;
  return { width: W, height: Math.ceil(H), body: out.join(''), desc };
}
