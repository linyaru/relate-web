# ADR-0050: The reader's own question is embedded in the browser with the docs' own model on the query-the-relate-docs recipe, fetched from the Hugging Face hub behind a button and checked against pinned hashes

Status: Proposed

Date: 2026-11-09

## Context

DOCS-PLAN.md §7.3 keeps "embed your own sentence" for phase 3: a small model
loaded on demand, button-gated, desktop first, feeding a live `SEARCH`,
built on transformers.js, on the vector-search guide. A reader's vector is
only comparable with vectors from the same model, revision and pooling. The
guide's vectors are hand-written 3-d ones and 40 hashed word vectors from
the hybrid-recall recipe, not a model's output. The one model-made corpus
on the site is the query-the-relate-docs recipe: docs sections carrying the
committed bge-small-en-v1.5 vectors (ADR-0028: its ONNX conversion at a
pinned revision, CLS pooling, normalized, made by transformers.js in Node),
and recipes take elements (ADR-0046).

Five facts shape the rest. Every ONNX file of that revision is over
Cloudflare Pages' 25 MiB per-file limit (fp32 133 MB, fp16 66.7 MB, the
8-bit files about 34 MB), so the site cannot serve the weights. Measured
against the committed vectors, on the recipe's two questions: the fp16
weights give cosine 0.9999999 on onnxruntime-web's WebAssembly build and
the same five sections in the same order; of the 8-bit files only
`model_quantized` keeps the order, at 0.9986 on the native runtime and
0.9968 on the WebAssembly one, moving scores in the third decimal; the
other 8-bit files and the 4-bit ones reorder the top five.
transformers.js depends on the native Node runtime and an image library,
which would join the site's install for code no browser runs; its browser
build fetches its runtime from a CDN. The site loads no third-party script
(ADR-0013), and nothing is written to the reader's browser storage
(ADR-0035). A WebAssembly memory never shrinks until its worker ends
(ADR-0048).

## Decision

**On the recipe, over its own step.** `:::embed-question{cell=<step>}`
names the recipe's vector search step, whose first line matches one stored
question by `$q` and whose search reads that node's vector. Live, the step
runs on the page's database with its first line replaced by
`WITH {embedding: vector($embedding, 384, FLOAT32)} AS question`; every
other line runs as written, and the element shows the statement it sends.
Where the page stores a vector for the same text, the element prints the
cosine similarity of the two. The vector-search guide links to it. The
step may do more than search: the recipe points it at the step that also
walks the graph from the hits to their pages, prerequisites and terms, so a
reader's question comes back with that context.

**The same model, as half-precision weights.** The worker tokenizes with
`@huggingface/tokenizers` (the library transformers.js 4.3.1 runs), runs
the fp16 ONNX file on onnxruntime-web 1.30.0 (the release of the native
runtime that made the committed vectors), takes the first token's hidden
state and normalizes it: the feature-extraction pipeline's CLS pooling for
one text. A question is capped at 200 characters, so nothing truncates.

**Where the files come from.** The weights and tokenizer come from
`huggingface.co` at the pinned revision (its content delivery network
serves the weights), with no cookies and no referrer. The runtime's
WebAssembly file and the code are bundled from the exactly pinned npm
packages into a worker chunk the site serves. Each file's size and
SHA-256 are pinned in one helper and checked before any byte is used;
unit tests hold the model fields to the committed artifact's and the
runtime pin to the installed package. Privacy and telemetry names the
request precisely.

**Behind a button that states the size.** Nothing loads with the page or
the element: "Download the model (82 MB)" starts the worker, the size
summed from the pins. The button stays at every width; a narrow screen's
note says the download is the same and meant for a desktop browser.
Unload, and leaving the page, end the worker and return its memory; the
engine bar's Reset brings back the recording and keeps the model.

**Static form and checks.** The form says what the button downloads, from
where and at what size, shows the swapped line, and holds the step's
recorded rows; no timing (ADR-0045). In cookbook:browser the worker
downloads the files from the hub and embeds both stored questions; each
vector must reach cosine 0.9999 with the committed one as the recipe holds
it and return the same five sections in the same order as that vector
(grouped by page, as the step returns them), and the step's own question
its recorded rows, every score within 0.0002. 0.9999 sits under
what float16 storage and four-decimal rounding cost (under 1e-6) and over
what another pooling of the same model gives (about 0.95) or any 8-bit or
4-bit file of the revision (0.98 to 0.999).

## Alternatives considered

- **Re-embed the vector-search guide's 40 notes with the model.** The
  element would sit where the plan put it. Rejected: it changes the
  hybrid-recall recipe's data, whose hashed vectors teach shared-word
  recall, and a model-made corpus already exists on the recipe.
- **The fp32 or 8-bit weights.** fp32 is exact; `model_quantized` halves
  the download and keeps the order. Rejected: fp32 is 133 MB for a cosine
  fp16 matches to seven decimals; the 8-bit vector depends on the
  runtime's integer kernels, so the live scores would not match the
  recording the page shows.
- **Self-host the weights, split under 25 MiB.** No third-party request.
  Rejected: tens of megabytes of binaries in the repository and on every
  deploy, and a reassembly step the hub already makes unnecessary.
- **transformers.js itself.** The authoring library. Rejected: its
  native-runtime and image dependencies would join the site's install, and
  its browser build fetches its runtime from a CDN.
- **Cache the model in the browser.** No second download. Rejected: tens
  of megabytes written to the reader's storage, which the framework does
  not write.

## Consequences

- The site makes its first third-party request from a docs or recipe page,
  only after the press; the privacy page says what Hugging Face sees.
- A hub outage or a removed revision breaks the live element and fails
  cookbook:browser, which needs the network for this case; the static form
  is unaffected.
- Re-embedding with another model or revision means new pins here, new
  sizes in the static form, and new hashes, held by the unit tests.
- The vector explorer is not on the recipe, so the question is not drawn
  as a point; placing it there is a separate change.
