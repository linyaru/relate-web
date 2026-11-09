// `:::storage-animator{[scenes="write-path,durability,rl-file"]}`: the
// storage animator (DOCS-PLAN.md §7.3; the hero of
// concepts/storage-and-durability, §7.4). Three views of one documented
// mechanism: the write path (a commit goes to the WAL, then the in-memory
// graph; a checkpoint writes the snapshot; an open loads it and replays the
// WAL), what a crash can lose under each durability mode, and the parts of
// one `.rl` file. `scenes` picks the views and their order (default: all
// three).
//
// It runs no engine (`engine: false`). The WASM build's store is in memory,
// with nothing to sync or checkpoint to disk, so a live run could show none
// of this; the element is a diagram of what the release binary does, stated
// as the storage pages state it. The facts live in the shared model
// (_storage-animator-model.ts); `validate` holds the mode names, the default
// mode and the default checkpoint interval to _data/cli.json, the binary's
// recorded help, so a release that renames a mode fails the check.
//
// The static form is the whole explanation: each view's steps as text, and
// one picture with a panel per view (the write path after two commits, the
// three modes' loss windows for one crash, the `.rl` file after a
// checkpoint), drawn by the same code the browser draws its frames with.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT } from '../content.ts';
import { bothThemes, markdownTable, svgFrame, type DiagramColors } from '../element-kit.ts';
import type { ElementInput, ElementSpec } from '../elements.ts';
import {
  DEFAULT_MODE,
  drawDurability,
  drawRlFile,
  drawWritePath,
  FACTS,
  loss,
  MODES,
  pictureStore,
  SCENES,
  secs,
  svgStyle,
  TIMELINE,
  type Drawing,
  type Mode,
  type Palette,
  type Scene,
} from './_storage-animator-model.ts';

const CLI_JSON = 'src/content/docs/_data/cli.json';
const ATTRIBUTES = new Set(['id', 'scenes']);
const MONO = '"Relate Mono",ui-monospace,monospace';
const FONT = '"Relate Sans",system-ui,sans-serif';

/** The views a directive asks for, in its order; unknown names are left for `validate` to report. */
function scenesOf(input: ElementInput): Scene[] {
  const raw = input.attributes.scenes;
  if (raw === undefined) return [...SCENES];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Scene => (SCENES as readonly string[]).includes(s));
}

/** Where the mode names, the default mode and the checkpoint period disagree with the binary's recorded flags, or none. */
function cliProblems(): string[] {
  const cli = JSON.parse(readFileSync(join(ROOT, CLI_JSON), 'utf8')) as {
    global_flags: { id: string; value?: string; default?: string }[];
    environment_variables: { name: string; default?: string }[];
  };
  const flag = (id: string) => cli.global_flags.find((f) => f.id === id);
  const env = (name: string) => cli.environment_variables.find((e) => e.name === name);
  const out: string[] = [];
  const mode = flag('durability-mode');
  if (mode?.value !== MODES.join('|')) out.push(`cli.json's --durability-mode takes \`${mode?.value}\`; the storage animator draws ${MODES.join(', ')}`);
  if (mode?.default !== DEFAULT_MODE || env('RELATE_DURABILITY_MODE')?.default !== DEFAULT_MODE) out.push(`cli.json's default durability mode is not \`${DEFAULT_MODE}\`, the one the storage animator draws`);
  const period = String(FACTS.checkpointIntervalSecs);
  if (flag('checkpoint-interval-secs')?.default !== period || env('RELATE_CHECKPOINT_INTERVAL_SECS')?.default !== period) {
    out.push(`cli.json's default checkpoint interval is not ${period} seconds, the one the storage animator states`);
  }
  return out;
}

// ---------------------------------------------------------------- the text

function writePathText(): string {
  return [
    `**The write path**, under the default durability mode, \`${DEFAULT_MODE}\`. One commit:`,
    '',
    '1. The statement runs and collects its changes privately; nothing is written yet.',
    '2. At commit, the changes become one record, numbered by its log sequence number (LSN). It holds physical changes to nodes, relationships, labels and properties, not Cypher text.',
    '3. The record is appended to the open WAL segment, `wal/NNNNNNNN.log`.',
    '4. The WAL is synced to disk before the commit returns; commits waiting together share one sync.',
    '5. The changes are applied to the in-memory graph, where every query reads.',
    '6. The commit is acknowledged.',
    '',
    'A checkpoint:',
    '',
    '1. The open segment closes, and new commits go to the next one, so writers do not stop.',
    "2. The checkpoint pins the LSN of the newest closed segment's last record.",
    "3. The committed state up to that LSN goes through the store's codec into snapshot files, under temporary names.",
    '4. The files are renamed into place, `manifest.json` last. A crash before the renames leaves the previous snapshot in force.',
    '5. Closed segments whose last record is at or below the pinned LSN are deleted.',
    '',
    `A checkpoint runs when the open segment reaches ${FACTS.segmentBytes} or ${FACTS.segmentCommits} commits, every ${FACTS.checkpointIntervalSecs} seconds by default, when a writable store closes cleanly, and on \`.checkpoint\`.`,
    '',
    'After a crash, the next open:',
    '',
    '1. Loads the latest snapshot: the state at its checkpoint LSN.',
    '2. Replays every WAL record with a higher LSN, in LSN order.',
    `3. Drops a record the crash cut short at the very end of the WAL. Under \`${DEFAULT_MODE}\` that commit was never acknowledged, so every acknowledged commit is back.`,
  ].join('\n');
}

const writesWord = (n: number) => (n === 1 ? '1 write' : `${n} writes`);

function durabilityText(): string {
  const crash = TIMELINE.crash;
  const all = loss('full', crash).acked.length;
  const every = loss('everysecond', crash);
  const synced: Record<Mode, string> = {
    full: 'Before each commit, or group of commits, is acknowledged',
    everysecond: 'About once a second, in the background',
    snapshot: 'Never on commit; only a completed checkpoint is durable',
  };
  const lost: Record<Mode, string> = {
    full: `None: all ${all} come back`,
    everysecond: `The ${writesWord(every.lost.length)} after the last sync, at ${secs(every.from ?? 0)}`,
    snapshot: `All ${all}, every write since the checkpoint`,
  };
  return [
    `**What a crash can lose.** The durability mode decides when a commit is acknowledged relative to the WAL sync. It is a setting of the process that opens the store (\`--durability-mode\` or \`RELATE_DURABILITY_MODE\`, default \`${DEFAULT_MODE}\`), not of the store.`,
    '',
    `The picture's timeline: ${all} writes are acknowledged in the ${secs(crash)} after a completed checkpoint, then the process crashes. A killed process can lose the window as well as a power cut.`,
    '',
    markdownTable(
      ['Mode', 'The WAL is synced', `Acknowledged writes the crash at ${secs(crash)} can lose`],
      MODES.map((m) => [`\`${m}\``, synced[m], lost[m]]),
    ),
    '',
    `Under \`everysecond\`, slow storage or a delayed sync makes the window longer than about a second. Under \`snapshot\`, the window runs until the next completed checkpoint: up to ${FACTS.checkpointIntervalSecs} seconds of writes under the default timer, fewer when a WAL segment fills first.`,
  ].join('\n');
}

function rlFileText(): string {
  return [
    '**One `.rl` file.** A single-file store keeps in one file the same tree a directory store spreads over a folder, WAL included. Its parts, in logical order rather than by byte position:',
    '',
    markdownTable(
      ['Part', 'Holds'],
      [
        ['Superblock', `The container's version marker: magic \`${FACTS.rlMagic}\`, version \`${FACTS.rlVersion}\` (\`relate info\` prints \`superblock version: ${FACTS.rlVersion}\`)`],
        ['Snapshot', "`manifest.json` and the codec's files (with the default `parquet` codec, the files under `nodes/` and `relationships/`): the state at the last checkpoint"],
        ['WAL', '`wal/NNNNNNNN.log` segments: every commit since the last checkpoint'],
        ['Space it reuses', 'The most space the snapshot and WAL have needed at once; later writes reuse what they no longer hold, and the file does not shrink'],
      ],
    ),
    '',
    'A commit appends its record to the open segment inside the file. A checkpoint writes the new snapshot files inside it, publishes them with `manifest.json` last, and deletes the segments the snapshot covers. A writer holds the file itself, with no lock files beside it, so a `--read-only` open is refused while a writer has it, and `--wal-dir` is refused for a `.rl` path. `relate clone` writes a compact copy that holds only the current state.',
  ].join('\n');
}

const TEXT: Record<Scene, () => string> = { 'write-path': writePathText, durability: durabilityText, 'rl-file': rlFileText };

// ---------------------------------------------------------------- the picture

/** The model's palette from a theme's diagram colours. */
const palette = (c: DiagramColors): Palette => ({
  surface: c.surface,
  node: c.node,
  secondary: c.secondary,
  fg: c.fg,
  fgMuted: c.fgMuted,
  line: c.line,
  rule: c.rule,
  accent: c.flow.accent.stroke,
  accentFill: c.flow.accent.fill,
  good: c.flow.good.stroke,
  goodFill: c.flow.good.fill,
  bad: c.flow.bad.stroke,
  badFill: c.flow.bad.fill,
  font: FONT,
  mono: MONO,
});

const PANEL_TITLES: Record<Scene, string> = {
  'write-path': 'The write path, after two commits',
  durability: `What a crash ${secs(TIMELINE.crash)} after a checkpoint can lose`,
  'rl-file': 'One .rl file, after a checkpoint',
};

const CAPTIONS: Record<Scene, string> = {
  'write-path': 'the write path',
  durability: 'what each durability mode can lose in a crash',
  'rl-file': 'the parts of one .rl file',
};

/** Each view's drawing for the picture, at the picture's width. */
function drawing(scene: Scene, width: number): Drawing {
  if (scene === 'write-path') return drawWritePath(pictureStore('write-path'));
  if (scene === 'durability') return drawDurability(MODES, TIMELINE.crash, width);
  return drawRlFile(pictureStore('rl-file'), width);
}

function picture(id: string, scenes: Scene[]) {
  const width = 760;
  const title = 32;
  const panels = scenes.map((s) => ({ scene: s, d: drawing(s, width) }));
  let y = 0;
  const placed = panels.map(({ scene, d }) => {
    const at = y;
    y += title + d.height + 16;
    return `<text class="pt" x="12" y="${at + 22}">${PANEL_TITLES[scene]}</text><g transform="translate(0 ${at + title})">${d.body}</g>`;
  });
  const height = y - 16;
  const caption = captionOf(scenes);
  const desc = panels.map(({ scene, d }) => `${PANEL_TITLES[scene]}: ${d.desc}`).join(' ');
  return {
    caption,
    ...bothThemes((theme, c) => {
      const sid = `${id}-${theme}`;
      return svgFrame({ id: sid, width, height, title: caption, desc, style: svgStyle(sid, palette(c)), body: placed.join('') });
    }),
  };
}

function captionOf(scenes: Scene[]): string {
  const parts = scenes.map((s) => CAPTIONS[s]);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `${list[0].toUpperCase()}${list.slice(1)}, as relate documents ${scenes.length > 1 ? 'them' : 'it'}`;
}

export default {
  live: 'Commit, Checkpoint and Crash step through what relate does with the WAL, the in-memory graph and the snapshot (inside one `.rl` file in the file view), and a mode switch with a crash slider shades what `full`, `everysecond` and `snapshot` can lose; under reduced motion each step waits for Next. It is a diagram of documented behaviour: no engine runs.',
  engine: false,
  inputs: [CLI_JSON],
  validate(input) {
    const out: string[] = [];
    for (const k of Object.keys(input.attributes)) if (!ATTRIBUTES.has(k)) out.push(`takes \`scenes="${SCENES.join(',')}"\` and \`id\`, not \`${k}\``);
    const raw = input.attributes.scenes;
    if (raw !== undefined) {
      const names = raw.split(',').map((s) => s.trim());
      if (!names.length || names.some((n) => !n)) out.push('`scenes` is a comma-separated list of views');
      for (const n of names) if (n && !(SCENES as readonly string[]).includes(n)) out.push(`\`scenes\` names \`${n}\`; the views are ${SCENES.map((s) => `\`${s}\``).join(', ')}`);
      if (new Set(names).size !== names.length) out.push('`scenes` names a view twice');
    }
    out.push(...cliProblems());
    return out;
  },
  staticForm(input) {
    const scenes = scenesOf(input);
    return { text: scenes.map((s) => TEXT[s]()).join('\n\n'), ...picture(input.id, scenes) };
  },
} satisfies ElementSpec;
