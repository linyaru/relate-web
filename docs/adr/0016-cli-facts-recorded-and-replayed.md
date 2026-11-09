# ADR-0016: CLI facts are recorded runs, replayed against a relate binary

Status: Proposed

Date: 2026-11-07

## Context

The docs state many facts about the relate CLI: flags and defaults, error
messages, exit codes, the error object, and the envelope bytes an agent
checks after it installs relate. The first data files (`_data/cli.json`,
`_data/errors.json`) were written from upstream's documents, which disagreed
with each other on several points (whether `--format` exists, the piped
`toon` default, whether `agent-context` ships, the envelope's fields). The
first pages pasted CLI output recorded from a source build. DOCS-PLAN.md §6
makes `relate --help` on the release binary the final word on CLI facts. It
asks for a check that diffs `--help` and `agent-context` against the data
and replays the pages' command and output pairs. The check must be
deterministic, and it must not depend on who runs it: an agent harness's
environment variables turn agent mode on, which changes the default output
mode and the row cap. Most of it must run without network, and it must
exist before the first release does. Before launch there is no relate
release to record from: the binary is a release-profile source build of
upstream that reports 0.16.1 and includes engine changes made after the
published v0.16.1, which shipped under the old name.

## Decision

- Every CLI fact the binary can show carries a `recorded` run in its data
  file. A run is one bash command line, run with the binary on PATH as
  `relate`, in a fresh empty directory with a fresh home and an environment
  of PATH, HOME, TMPDIR and DO_NOT_TRACK=1 only, plus the exact stdout,
  stderr and exit code. In the output the directory is written `<dir>` and
  the home `<home>`. An optional `setup` runs first, and an optional `hold`
  keeps a second process on the store (the locked case). The `--help` page
  and the `agent-context` briefing of every command are recorded too.
  engine.json records `relate --version` and the envelope of
  `RETURN 1 AS ok`, and the install block and `llms.txt` print them from
  there.
- A fact the sources disagree on is settled by the binary (`settled_by`),
  not by choosing a source. `verify` marks only what the binary cannot
  show, such as a build bundle without a command.
- A page marks a replayable command with a `bash verify` fence. When the
  next fence is `text`, it holds the expected output: stderr and stdout as
  one stream. A page's verify fences run in order in one directory.
- The data files name the build they were recorded from (`recorded_with`:
  version, commit, and whether it is a source or a release build; engine.json
  `source_build` before launch). `--record` writes it, and records each
  page's verify steps as replayed: the command and a SHA-256 of the expected
  output. A twin claims `verified_by: cli` only while every step on the
  page still matches its record at the engine's version.
- `npm run docs:cli-check` replays all of it against `$RELATE_BIN`, `relate`
  on PATH, or the latest release installed through `public/install.sh`, and
  fails with a unified diff. `--record` rewrites the data files' recordings
  for review. Without a binary it reports a skip and exits 0. It runs
  weekly, by hand, and on pushes to main that touch `public/wasm/` or
  `_data/`. It is not a required check, and it continues on error until the
  first release exists.
- The half that needs no binary runs inside `docs:check`. Recordings are
  well formed. Each quoted message appears in its recorded output and
  agrees with the recorded exit code and error object. The recorded
  `agent-context` lists exactly the commands and flags in cli.json. The
  recorded version and `recorded_with` name engine.json's version. Every
  page's verify steps match their record. Nothing is still disputed.

## Alternatives considered

- **Generate cli.json from parsed `--help` output.** Rejected: the help
  text is wrapped prose with engineering references. A parser would tie the
  data to the help's formatting, and summaries, sources and cross-surface
  facts have no place in it. Recording the exact text and diffing it keeps
  the binary authoritative without a parser.
- **Record argv arrays, with stdin and environment in separate fields.**
  Rejected: a shell line is what a reader types, covers pipes and
  environment prefixes, and has the same form as a page fence.
- **Replay in the caller's environment.** Rejected: a harness's variables
  turn agent mode on, so the result would depend on who ran the check.
- **Make the check required on every pull request.** Rejected: it depends
  on a published binary, not on the change under review. Required checks
  stay reproducible from the repository alone, as `cookbook.yml` is.

## Consequences

- An engine bump is: run `--record`, review the diff, fix the page fences
  the check names, and bump engine.json in the same change.
- Recordings are platform-neutral by choice. Nothing records
  `--version --json`, which names the OS and architecture, or store sizes
  on disk.
- The one timing-sensitive recording (`--timeout`) bounds a statement that
  runs for seconds at 100 ms, so it holds on fast machines.
- The twin keeps `bash verify` as fence meta, which is inert text to a
  reader.
- Facts the binary cannot show stay sourced from upstream and marked
  `verify`, as do the HTTP, Bolt and MCP errors until a replay of
  `relate serve` exists.
