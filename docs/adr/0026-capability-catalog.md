# ADR-0026: The capability catalog is a collection rendered into one page's generated section and capabilities.json

Status: Proposed

Date: 2026-11-07

## Context

ADR-0011 adopts a capability catalog so that an agent can choose relate by
the problem it has, in its own words, rather than by product terms; ADR-0015
moves it to phase 2 and keeps three forms of it: the "Problems relate
solves" page, `/docs/capabilities.json` and the `discover_capabilities`
tool, dropping the well-known manifest. DOCS-PLAN.md §3.8 lists the fields
(problem, capability, intents, guides, recipes, reference, a recommended
data model, the verifying cell, surfaces) and about twenty entries; §2 puts
the cards on their own page, not on the docs landing.

Four constraints shape it. The page and its markdown twin must say the same
thing, and every docs check (words, imperative and injection rules, links,
anchors, diagrams, the twin round-trip) must see the entries. ADR-0015 caps
JSX components, and each needs a second renderer for the twin. Each entry
needs a stable anchor that pages, the JSON and the docs graph can cite. And
a capability is only as credible as the recorded run that proves it, yet
some cannot be recorded here: `relate pull` and `relate push` need a Neo4j
or Aura server the checks do not run.

## Decision

- **A collection, one file per problem.** `_capabilities/<id>.mdx` holds
  `id`, `title`, `order`, `problem`, `capability`, 4 to 8 `intents`,
  `surfaces` (the docs vocabulary), `guides` and `reference` (published page
  ids), `recipes` (cookbook slugs), `schema` (a mermaid flowchart whose
  nodes are all circles, or null) and `verify`, plus a body of two to four
  plain paragraphs. `id` is the slug of `title`, so the heading's anchor is
  the id. `verify` names one recorded run that exercises the capability
  itself: a recipe cell (`<slug>#<cell>`), a cell or sample recorded in a
  docs page's sidecar (`<page>#<cell>`), or a page's n-th `bash verify`
  step with expected output, as docs:cli-check last replayed it
  (`<page>#step-<n>`; the list quotes the first line of its output, so a
  renumbered step makes the section stale). Where no recorded run exercises
  the capability, `verify` is null and the list and the JSON say so; a run
  that merely exists on a cited page is not cited instead. The checks prove
  the run exists; review decides that it shows the capability. Cited pages
  must be published; an entry whose guide is not written yet cites what
  exists and gains the link when the page lands.
- **Intents are quoted user requests.** They read like requests ("run
  graph queries in CI") because they are what a user or agent says, so they
  are exempt from the imperative rule, like prompt fences (ADR-0013).
  They appear in no twin, only in the JSON and the Worker's answers, so the
  catalog check runs the docs:check injection patterns on every intent, and
  on `problem` and `capability`.
- **A generated section, not a directive or a component.** The page
  `concepts/problems-relate-solves` is ordinary MDX with an authored
  opening, "How an entry is built", "What the catalog leaves out" and
  "Where this shows up". Between two marker comments sits a section written
  from the collection by a command: per entry an H2, the body, the data
  model as a mermaid block, and a list of the problem, the capability, the
  surfaces, the links and the verifying run. docs:check fails when the
  section differs from what the files give. The page is the canonical
  citation: every entry's URL is the page plus `#<id>`.
- **`/docs/capabilities.json`** carries `kind: "documentation"`, `format`,
  `verified`, an in-band `note` (reference text, the source page, that
  intents are examples and an empty match is not a "no"), the page URL, and
  per entry the fields above with canonical URLs, the data model as mermaid
  source with its caption and words, `schema_url` (the light SVG, served
  beside the page) and the verify reference with its kind (`cookbook-cell`,
  `docs-cell`, `docs-sample` or `cli-step`), or null. It is listed in
  `docs-artifacts.json` and in `llms.txt`.
- **The landing carries no cards.** It links the page from its task index,
  in the Evaluate group; the page sits first in Concepts.
- **`discover_capabilities` ranks** by intent match first: the query
  against each entry's intents and problem text (exact phrase, then token
  overlap), then the capability and title; `requirements` filter by
  surface and `language` by the client surface. Results quote the entry
  and cite its `urls.page`; no match returns an empty list, not the
  nearest entry. The Worker implements it over `capabilities.json`.
- **The docs graph** gains `Capability` and `Problem` nodes, `SOLVES`,
  `CITES` (to the guide and reference pages), `DEMONSTRATES` (from a
  recipe), `VERIFIED_BY` and `HAS_CAPABILITY` (from the catalog page), and
  reuses `APPLIES_TO` for surfaces (ADR-0020's rule: a label joins when its
  data source exists). The page links get their own types rather than
  `RELATED_TO` and `DOCUMENTS`, so the page graphs, which list the pages
  linking to a page and the commands it documents, never list a
  Capability.

## Alternatives considered

- **A `::capabilities` directive expanded at render time.** No copy of the
  entries in the page source. Rejected: the twin renderer, the remark
  plugin and the anchor and link checks would each need to learn it, and a
  diagram drawn by a directive has no place in the page's diagram sidecar.
- **A sixth JSX component.** The pattern `<Errors />` uses. Rejected: it
  adds a JSX component beyond ADR-0015's phase 1 set of five, its
  headings are invisible to the table of contents and the anchor check, and
  it needs its own markdown renderer.
- **Only entries a recorded run verifies.** A cleaner rule. Rejected: it
  drops the Neo4j subgraph mirror, which DOCS-PLAN §3.8 names, for want of
  a server in the checks; an entry that says it is unverified is more
  useful to an agent than a missing one, and citing an unrelated cell to
  fill the field would mislead it.
- **Cards on the docs landing.** Outcome-led entry. Rejected per DOCS-PLAN
  §2: the landing's one navigation scheme is the task index, and twenty
  cards would bury it.
- **The body only in the JSON, not on the page.** A shorter page. Rejected:
  `?section=<id>` and `get_page` return the page's section, and an entry
  without its explanation would answer an agent with a list of links.

## Consequences

- Adding or editing a capability means editing its file and rewriting the
  section (`node src/lib/docs/capabilities.ts --write`), then rendering the
  data models (`npm run docs:diagrams`); docs:check names both steps.
- The page carries the entries twice in source (the files and the section);
  the staleness check keeps them equal.
- An entry's id is a public anchor and JSON key from launch; renaming it is
  a breaking change, like a docs graph label.
- `_capabilities/` is not a page directory; the content reader and the
  docs collection skip it as they skip `_glossary/`.
- A guide or recipe that a capability cites is expected to cite it back
  (`related:` or a link); docs:check warns until it does.
- This amends ADR-0011's decision, which put outcome cards on the docs
  landing and named the recipe cell as the proof: there are no cards, and
  `verify` may name a docs cell, a sample or a CLI step, or be null. ADR-0011
  and ADR-0020 gain Later references pointers.
- An unverified entry is a standing to-do: when a page gains a recorded run
  that exercises it (a `bash verify` step for the schema mirror, say), the
  entry's `verify` changes to it.

## Later references

- ADR-0033: `discover_capabilities` meets a requirement by naming one of an
  entry's surfaces or by all of its words appearing in the entry's text, so
  plain-word needs filter as well as surfaces.
