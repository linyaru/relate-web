# ADR-0028: Section embeddings are a committed artifact, and the docs graph carries a vector index over them

Status: Proposed

Date: 2026-11-07

## Context

ADR-0011 puts hybrid search inside relate: section embeddings stored in the
docs graph (ADR-0007, ADR-0020), and `search_docs` fusing vector and
full-text ranks in one statement. ADR-0011 and ADR-0012 assumed a
build-time Workers AI step; DOCS-PLAN.md §8 item 3e replaced it with a
committed artifact from an authoring-only package, so the required CI
workflow needs no secret, no Cloudflare account and no model download.
Three forces shape the rest. A query embedded on the docs MCP Worker
(ADR-0023) must land in the same vector space as the sections embedded on
a maintainer's machine. The Worker replays the seed on every cold isolate,
so every byte and statement the vectors add is cold-start latency. And a
vector computed from text that has since changed is worse than none: it
ranks a section for words it no longer holds.

## Decision

- **Model.** BAAI's bge-small-en-v1.5: 384 dimensions, 512 input tokens,
  MIT licensed. The authoring package runs it through transformers.js
  (`@huggingface/transformers` 4.3.1) from the ONNX conversion
  `Xenova/bge-small-en-v1.5`, pinned to a hub revision, fp32 weights, CLS
  pooling, normalized. The query side is Workers AI's
  `@cf/baai/bge-small-en-v1.5` with `pooling: "cls"`. Both ids and the
  dimension were confirmed on their model pages on 2026-11-07; Cloudflare's
  page says its default is mean pooling and that cls and mean embeddings
  are not compatible, so the Worker passes cls explicitly.
- **Input.** Per section, the page title, the heading (unless it is the
  text before the first heading) and the section's markdown as the graph
  holds it; the model reads its first 512 tokens.
- **Artifact.** `src/content/docs/_data/embeddings.json`: the model record,
  then one line per section with its id, the SHA-256 of the exact text
  embedded, and the vector as float16, little endian, base64 (about 1.2 KB
  a section; 604 KiB for the 525 sections of phase 1, under 2 MB until
  about 1,700). A `queries` list holds the fixed questions the cookbook
  recipe asks, embedded the same way.
- **Staleness.** By content hash only. `npm run docs:embeddings` embeds the
  sections whose hash changed and drops entries for sections that are
  gone; `--force` re-embeds everything. `docs:check` fails on a missing,
  stale, orphaned or malformed vector, naming the command. The seed sets a
  vector only while its hash matches, so a stale vector never ships.
- **Schema (amends ADR-0020).** `Section` gains `embedding`, a
  `VECTOR<FLOAT32>(384)`; the seed sets it in UNWIND statements after the
  rows, each value the shortest decimal that reads back as the same
  float16, and creates `VECTOR INDEX docs_vector` (cosine, 384) beside the
  full-text index `docs`. `graph.json` leaves the vectors out and says so
  in a top-level `embeddings` object. The seed can also be written without
  the vector statements, for a replay that loads the vectors as one
  parameter. The capability catalog's labels join through a marked
  extension point when their source exists, as ADR-0020 says.
- **Filter property.** `docs_vector` declares `page` with `WITH [s.page]`,
  so a vector search can filter inside the search, before it ranks:
  `WHERE s.page IN $pages` searches only the sections of pages a traversal
  chose and still returns `LIMIT` rows. relate filters a vector search
  only on declared properties (`WrongPropertyForVectorSearchFilter`
  otherwise), and the recipe's statements must run unchanged on the whole
  graph. `docs:check` fails when the replayed index covers other
  properties.
- **Recipe.** "Query the relate docs" loads a generated subset: the
  graph's structure without vectors as far as its steps read it (every
  page, term, capability, problem and recipe, with the page links,
  prerequisites, terms, surfaces, citations and proofs), every section of
  five fixed pages with text cut to 480 characters and vectors rounded to
  four decimals, and the two questions with their vectors, under 400 KB.
  The sections stay few because each carries about 3.5 KB of vector; the
  structure costs about 110 KB and lets the steps expand, scope and
  explain the vector hits as they would on the whole graph. `docs:check`
  compares the recipe's data block with the subset the graph gives now.
- **The Worker.** With an AI binding, `search_docs` embeds the query with
  cls pooling and runs the fused statement; without one (local
  development, an outage), it runs full-text only and its result says so
  in a field, never silently. Until it embeds queries, it replays the
  served seed without the vector statements (`seedWithoutVectors`), so its
  cold start does not pay for vectors it cannot use.
- **Glossary and changelog** stay outside the graph's `Page` and `Section`
  nodes in this change: the glossary's page is being rebuilt with full
  bodies in the same phase, and its anchors are term ids, not heading
  slugs. Glossary terms are already `Term` nodes with their definitions.

## Alternatives considered

- **Cloudflare Vectorize beside the graph.** Managed, scales further.
  Rejected, as in ADR-0011: a second store beside the product undercuts
  the demonstration, and this corpus fits in the graph.
- **Workers AI at build time.** One model for both sides by construction.
  Rejected: CI would need an account and a secret, every build would call
  a paid API, and a failing call would block a deploy.
- **Embedding every section in the Worker at cold start.** No artifact.
  Rejected: hundreds of model calls per isolate is the opposite of a fast
  cold start.
- **Decimal floats in the artifact.** Readable. Rejected: six decimals
  cost about 3.6 KB a section, over 2 MB at phase 2's size.
- **Vectors in the artifact only, never in the seed.** Keeps the seed at
  its phase 1 size. Rejected: the `.rl` that `relate --load` opens offline
  would have no vector index.
- **relate's `COMBINE … USING WRRF`.** One clause, the engine's own
  weighted reciprocal rank fusion. Rejected for now: it is a preview
  behind `RELATE_PREVIEW=hybrid-search` (reference/cypher/search), and
  the shipped WASM, which the Worker and the browser run, has no opt-in:
  `RelateDb` takes only a read-only flag, and `COMBINE` fails there with
  the preview error even with the variable set. Revisit when it leaves
  preview.
- **A vector index without filter properties, filtered after the
  search.** One property fewer to maintain. Rejected: a `WHERE` after
  `SEARCH` drops rows from the top `LIMIT` it already chose, so a scoped
  search returns fewer sections, or none, where the scope's best ones
  rank below other pages'.
- **Mean pooling, Workers AI's default.** No parameter to remember.
  Rejected: Cloudflare's page recommends cls for accuracy on longer
  inputs, which sections are.

## Consequences

- Measured on 2026-11-07 (569 vectors, `npm run docs:graph`): the seed
  grows from 1.7 MB to 3.8 MB (0.30 MB to 0.87 MB gzipped); the WASM
  replay from about 230 ms to 950 ms, or about 450 ms when the vectors
  arrive as one parameter; the native `.rl` from 3.1 MB to 15.1 MB. The
  Worker replays the seed without vectors (about 230 ms) until it
  searches by vector; its bundle and cold start are re-measured then.
- Any edit to a page's text needs `npm run docs:embeddings` before
  `docs:check` passes; the first run downloads about 130 MB of weights to
  a gitignored cache. CI only reads the artifact.
- That the two runtimes agree is asserted from the shared weights, not
  measured: no Cloudflare account exists yet. At launch the recipe's
  questions are embedded on Workers AI and compared with the committed
  query vectors.
- A model change is a new artifact (`--force`), a seed and `.rl` change,
  and a changelog entry for agents that embed their own queries.
- `reference/docs-graph` documents the property, the index and the model.

## Later references

- ADR-0033: the Worker's hybrid lane fuses each lane's ten best sections
  (or `limit`), measured on the two committed questions. It loads the
  vectors as one parameter on its first hybrid search (about 188 ms in
  workerd after a 350 ms replay without them), and falls back to full-text
  with `version.retrieval: "full-text"` when Workers AI does not answer,
  including under `wrangler dev --local`.
