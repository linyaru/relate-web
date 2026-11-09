# ADR-0030: Glossary bodies, the §4.11 checks as built, and the toggletip's markup

Status: Proposed

Date: 2026-11-07

## Context

ADR-0009 set the glossary rules: one file per term, a first-use toggletip,
self-contained twins, and six checks. Phase 2 (DOCS-PLAN.md §10, ADR-0015)
builds the full definitions, the toggletip and the checks. Building them
meets questions ADR-0009 left open. A toggletip sits inside a paragraph,
where a `<div>` is not allowed. Counted literally, the First-use check warns
about "node", "path" and "index" on almost every page, often in another
sense (a file path, a list of pages), while the twin's Terms section holds
five terms at most. A banned spelling has plural forms, and some aliases
differ from their term only in case (`cypher`). A full definition rendered
into the glossary twin must keep one entry one section, because
`?section=<id>` and the docs MCP's `get_page` cut entries by heading. Vale
lints front-matter string values, and a term's `id`, `context` and `see` are
lowercase identifiers that collide with capitalized vocabulary (`bolt`,
`cypher`).

## Decision

- **Bodies.** A term's body is its full definition: paragraphs, lists, code
  blocks and inline markup, with `:term` links to other entries. No
  headings, block directives, JSX, expressions or images; docs:check fails
  a body that has one. A body's prose gets the page prose's word rules and
  its code blocks the page fences' trust rules (ADR-0013), so a block that
  starts `relate serve` or a host config carries `--read-only`. A `:term`
  inside code is not a link. The glossary page shows the short definition, then
  the body, then the facts; the twin gives the same order under one `###`
  heading per term.
- **Toggletip markup.** The panel is a `<span popover="auto">` after the
  `<button popovertarget>`, both phrasing content, so the paragraph stays
  whole. In a table body cell or a tab panel a term renders as a plain link
  and does not use up the page's toggletip; in a heading, a table header, a
  callout title, a tab label or a link it is plain text. The first other use
  is the toggletip; later uses are plain text. No JavaScript is involved.
- **Aliases.** The glossary's aliases are the banned-synonym list. An alias
  matches as a word with an optional plural; it matches case-insensitively
  unless it carries a capital or differs from its term only by case. The
  hand-kept list keeps only what an alias cannot say: a preferred word that
  is not a term, two preferred terms for one word, or a pattern with an
  exception. An alias must be wrong in every context, so "wrapper" is no
  longer one.
- **First use.** One warning per page, listing each unlinked term used three
  times or more with its count. It is silent once the page links five terms.
  A named list of common words is not counted: words the pages also use in
  another sense, and the basic graph words every Cypher reader brings.
- **Twin.** The Terms section must list exactly the linked terms, in order of
  first use, each with its current short definition.
- **Machine form.** `/docs/glossary.json` wraps the per-term rows with
  `kind: "documentation"`, its source page, its twin, its limits, the
  verified version and a count; it carries no timestamp and is listed in
  `docs-artifacts.json`. The JSON-LD `DefinedTermSet` is returned by the
  generated page's renderer for the page head.
- **Vale.** docs:lint gives Vale copies of the term files with the
  frontmatter blanked out, line for line, so every Vale rule, the
  vocabulary's case check included, reads the bodies, and the printed paths
  and lines are the real ones.

## Alternatives considered

- **`<div popover>` as DOCS-PLAN.md §4.11 writes it.** Matches the plan text.
  Rejected: the HTML parser closes the paragraph at the `<div>`, splitting
  the sentence around the term.
- **Counting every term for First use.** Literal to §4.11. Rejected: dozens
  of warnings per page about words readers know, many in another sense,
  bury the ones that matter, and the five-term cap makes them unactionable.
- **Free markdown in bodies, headings included.** More expressive. Rejected:
  a heading inside an entry splits its `?section=` slice and its MCP
  section.
- **Renaming the ids and contexts to avoid Vale's case check.** Rejected: ids
  are stable anchors, and `context` is an enum the schema fixes.
- **Turning Vale's case check off for the term files.** One line of
  `.vale.ini`. Rejected: it also turns the check off for the bodies, and
  docs:check's alias rules do not cover the vocabulary's case rules ("mcp",
  "toon" would pass). A `TokenIgnores` pattern for the frontmatter lines does
  not stop Vale 3.25.1 from flagging them.

## Consequences

- Adding a term needs a body that renders, or docs:check fails.
- Changing the First-use exemptions or the alias matching changes a glossary
  rule and needs a new ADR that names this one.
- ADR-0009's "Later references" can point here; nothing in it is reversed.
