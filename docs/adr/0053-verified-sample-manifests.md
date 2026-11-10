# ADR-0053: Each verified language sample is published as a manifest, with the client build it actually ran on

Status: Proposed

Date: 2026-11-09

## Context

A cookbook recipe is already a fetchable unit: `recipe.json`,
`results.json` and its data files, the hand-off the playground and the docs
MCP read. A verified language sample (ADR-0021, ADR-0027) is not: its
program lives in a page's fence and its output in the page's sidecar, and an
agent that wants one program has to parse a twin, count fences to find the
`<lang>-<n>` id, and trust prose for what it ran on. DOCS-PLAN.md §3.8 gives
samples the recipes' treatment in phase 3.

Constraints. Docs are data (ADR-0013): a manifest describes, it never
instructs. Nothing may claim more than a recorded run shows. Before launch
every client is a source build, and not all from one commit: the CLI pages
and `_data/engine.json` name upstream `ac441ec`, while the Java, Go and
Swift reference pages say their clients came from the sibling commit
`6a0c391`, and the sidecar records only the version a client reported, not
the commit it was built from. The docs MCP keeps its five tools
(ADR-0015). `docs-artifacts.json` is the signed list of agent artifacts
(ADR-0019).

## Decision

1. Every verified sample on a published page is served at
   `/docs/<page>/samples/<id>.json`: `kind: "documentation"`, format 1, a
   note saying what the file is. It holds the page and the heading the
   sample sits under, the language, file name and `env`, the program byte
   for byte with its SHA-256, the record's `source_sha256`, the recorded
   output with its SHA-256, what verified it, and how the docs' runner
   builds and runs it (the env.sh variables, the files it writes, the build
   and run steps with placeholders for paths, the pass rule and the output
   normalization), taken from the same functions the runner calls.
2. What verified it comes from a committed facts file,
   `_data/samples.json`, written when the maintainers complete a full
   replay: per language the client package, the upstream commit of the
   engine it ran on, the commit of the client's own source, a sentence on
   how it was built and the toolchain versions; the replay date, the
   platform, and the pins setup installed. A manifest states that build,
   the client version from the record, and `_data/engine.json` beside them
   as the docs' own pin, so a sample whose client came from another commit
   says so. Nothing is inferred from `engine.json`.
3. `/docs/samples.json` indexes every manifest with the SHA-256 of its
   bytes and each client's build once. `docs-artifacts.json` lists the
   index and every manifest.
4. The twin's generated frontmatter gains `samples`: the page's manifest
   URLs in page order. The page links each manifest from the sample's
   output header, typed `application/json`. The llms.txt facts block names
   the index.
5. The docs MCP serves them as resources, byte for byte:
   `relate-docs://samples` and `relate-docs://sample/<page>/<id>`. No tool.
6. `docs:check` makes every manifest from its page and sidecar and fails
   on a fence or output that differs; it holds `_data/samples.json` to the
   pins in `scripts/samples/setup.sh`, so a bumped pin without a replay
   fails. With `--built` it compares every served manifest and the index
   with the source's bytes, refuses a stray file under a `samples/`
   directory, and finds each program and output byte for byte in the built
   page and twin. The Worker bundle fails on a manifest whose bytes do not
   hash to the index, and `docs:mcp-check` reads every sample resource
   against `dist/`.

## Alternatives considered

- **One manifest per page (`/docs/<page>/samples.json`).** Fewer files,
  closer to `recipe.json`. Rejected: a sample is copied and run alone
  (ADR-0021), so the unit is one program; a page file makes an agent fetch
  every language on a reference page to get one, and the index already
  groups by page.
- **A link line after each sample in the twin body**, as a cell links its
  graph picture. Rejected: it changes every sample section's text, and
  with it the section vectors and every `?section=` answer, for a link the
  twin's frontmatter carries as data.
- **Provenance from `engine.json`.** One source, no new file. Rejected: it
  would state `ac441ec` for samples whose clients were built from
  `6a0c391`.
- **The recorder writes the provenance.** No hand-kept file. Deferred:
  setup does not record the commit it built from, and an environment can
  be repointed after setup (the samples environment was, at the pin to
  `ac441ec`); until both are recorded by tools, a reviewed facts file
  checked against setup's pins is the honest record.
- **A `get_sample` tool.** Rejected: the five-tool ceiling (ADR-0015);
  read-only artifacts are resources, as the cookbook cells are.
- **Only the index in `docs-artifacts.json`.** A shorter signed file, the
  manifests pinned through the index's digests. Rejected: listing each
  manifest lets the existing built check verify every served file, and the
  signature covers each one directly.

## Consequences

- A sample edit rewrites its manifest, the index, their
  `docs-artifacts.json` entries and the Worker bundle; all are generated.
- `_data/samples.json` is as good as the replay it describes: docs:check
  catches pin drift against setup, not a wrong commit or toolchain version.
  A re-pin or release refresh rewrites it with the re-recording.
- The Worker bundle grows by about 0.8 MB before compression: each
  manifest repeats its program and run block.
- After launch the clients come from published packages; the `run` block
  then describes those installs, alongside ADR-0027's point 2.
