# ADR-0049: A twin links a data block over 2 KiB to a per-page data file instead of inlining it

Status: Proposed

Date: 2026-11-09

## Context

A docs page's twin carries every fenced block the page shows (ADR-0005),
and every surface that serves a twin repeats it: the `.md` URLs, content
negotiation and `?section=` (ADR-0025), the docs MCP server's `get_page`
(ADR-0023), `llms-full.txt`, the docs graph's sections and their
embeddings (ADR-0020, ADR-0028). A cell's parameters block (ADR-0017) is
usually a few lines, but the vector search guide's `notes` block holds 40
vectors of 384 dimensions: 76,107 of its twin's 99,818 bytes, over the MCP
server's 96 KiB result cap, so `get_page` with `expand` cut that page.
Measured over the 33 blocks on the published pages, 31 are 1,749 bytes or
less; the other two are that 76 KB dataset and the agent-memory page's
3,881-byte agent trace, whose every step the trace element's recorded text
already prints in the same twin.

The cookbook already draws this line: a data block over 2,048 bytes is a
dataset, served at `/cookbook/<slug>/data/<name>.json`, and the MCP
server's example resources inline parameters up to 2 KiB and link larger
ones (ADR-0033). Recipe twins are the recipe files and keep their blocks.

## Decision

The build serves every `json data=<name>` block of every docs page at
`/docs/<page>/data/<name>.json`, beside the page's other files (its static
graph pictures live under the same URL): the block's text exactly as the
page holds it and its cells run it, `application/json`, nothing added, so
a hash of the file is a hash of what the cells take.

A twin inlines a block of up to 2,048 bytes, the cookbook's dataset line,
and replaces a larger block with a stub: a `json` fence whose info string
is `data=<name> src=<canonical URL of the file>` and whose body is a JSON
object naming the block, its URL, media type, size in bytes, SHA-256, the
type of each top-level key ("array of 40 objects") and the first item of
each top-level array, with any array of more than 8 items or 256 bytes in
it replaced by its description ("array of 384 numbers"). The stub is data:
it says what the block is and where its bytes are, and addresses no one
(ADR-0013).

The stub is rendered where the twin's constructs are, so every surface
built from the twin carries the same bytes: the `.md` files, `?section=`,
`get_page`, `llms-full.txt`, the docs graph's section text and the vectors
computed from it. The playground's twin hand-off (ADR-0017) reads a stub's
`src`, fetches the file from its own site and checks its size and SHA-256
before the engine runs it. A fetch of a data file is logged as its own
agent-path kind, so the logs show whether agents follow the links.

`docs:check` fails when a block over the line is inline in the twin, when
its stub is missing, doubled or names another URL, or when the stub's size
or SHA-256 is not the block's; with `--built`, when a block's built file
is not the block's bytes or a built twin's stub disagrees with the file it
links. The negotiation check serves the largest file untouched whatever
the Accept, and the MCP check reads that page through `get_page` byte for
byte.

## Alternatives considered

- **Keep inlining every block.** Simplest, and a twin stays one file.
  Rejected: one page's dataset is three quarters of its twin, is paid for
  on every fetch and every section of the page's `llms-full.txt`, and no
  longer fits one MCP result.
- **Drop large blocks from the twin with a sentence pointing at the page.**
  Smallest twin. Rejected: an agent could not see the data's shape, and
  the playground could not run the page from its twin.
- **A threshold of its own, such as 4 or 8 KiB.** Would keep the agent
  trace inline. Rejected: that trace is already printed by its element in
  the same twin, and one dataset line across the cookbook, the docs and
  the MCP server is easier to state and check than two.
- **Serve the files as `/docs/<page>.data.json`, one file per page.**
  One fetch per page. Rejected: a stub could not hash one block, and the
  cookbook's `data/<name>.json` shape is the one agents already meet.
- **MCP resources for the data files.** Reachable without HTTP. Rejected
  for now: the stub's shape is enough to read the page, the server's
  resource list is a decided surface, and an agent that runs the data
  needs relate, which reaches the URL anyway.

## Consequences

- A docs twin is no longer self-contained for a block over 2 KiB: the
  block is one HTTPS fetch away, named by URL and hash.
- Editing a large block changes its stub, so the section's embedding goes
  stale like any text edit and `docs:embeddings` re-embeds it.
- The `json data=<name> src=<url>` info string is part of the twin format;
  the playground and any other reader of twins parse it with the shared
  cell parser.
- Recipe twins still inline their datasets; changing that is a cookbook
  decision.
