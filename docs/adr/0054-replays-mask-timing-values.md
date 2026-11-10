# ADR-0054: CLI replays compare output with timing values masked, and pages show a real run's timings

Status: Proposed

Date: 2026-11-09

## Context

ADR-0016 makes every CLI fact a recorded run that `docs:cli-check` replays,
comparing stdout, stderr and the exit code byte for byte. That works only
while the output is the same on every run. From relate 0.1.0 every
machine-readable result carries per-phase timings (upstream ADR-0540): the
`envelope` and `json` modes add a nested `timings` object and a `planCache`
outcome, `jsonl` closes each statement with a line holding them, `toon`
ends with `timings:` and `planCache:` entries, and the canonical envelope
(MCP, WASM, the C ABI's wire form) extends its flat `*_ms` keys. The
numbers change on every run, so the first replay against relate 0.1.2
drifted on 175 page steps and on the recordings in `errors.json`. The WASM
cell recordings already drop four named `*_ms` keys (ADR-0016's sibling
check in `docs:check`), and the new keys slipped past that list. The MCP
reference page and the MCP tryout already print timings as `<ms>`, through
a `sed` in the page's command and a mask in the element.

## Decision

- A replay compares a recorded output with the binary's after masking every
  timing value on both sides: the number after a JSON key ending `_ms`, in
  compact JSON, in pretty JSON and in JSON quoted inside a JSON string, is
  written `<ms>`. Nothing else is masked: `planCache` and every other key,
  value and line are compared as printed. The mask is one function in the
  CLI check library, used by the data-file and page-step replays.
- A page shows the output of the run it was written from, timings included,
  so a reader sees what the command prints. A page may still write `<ms>`
  itself (the MCP page does), since the mask leaves `<ms>` as it is.
- `--record` rewrites a data-file recording only when the masked output, or
  the exit code, changed, so a re-record does not churn timing digits.
- The WASM cell recordings leave out every `*_ms` key, not a fixed list;
  `plan_cache` stays, since a page's cells replay in the same order on a
  fresh database.

## Alternatives considered

- **Mask in each page's command (`| sed …`), as the MCP page does.**
  Rejected: it would add a filter to about 150 commands, and the reader would
  copy a command that is not the one they would type.
- **Record without timings by asking the binary to leave them out.**
  Rejected: relate has no such flag (upstream ADR-0540 keeps the timings
  always on), and a page would then show output no reader ever sees.
- **Compare parsed JSON and ignore the `timings` and `planCache` members.**
  Rejected: page output is a mix of JSON, `toon`, tables and stderr lines,
  and dropping `planCache` would hide a real change in the plan cache's
  behaviour.

## Consequences

- An engine bump that changes only timing digits produces no drift and no
  diff. A new timing key, a renamed one or a changed `planCache` outcome
  still drifts and is reviewed.
- A non-JSON timing rendering, such as the table mode's `.timer` line, is
  not masked; a page that shows one must keep it out of a `verify` pair.
- A timing key that does not end in `_ms` (Bolt's `*_time` seconds) is not
  masked; no recording holds one, since Bolt is not replayed.
