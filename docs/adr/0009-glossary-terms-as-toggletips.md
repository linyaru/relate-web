# ADR-0009: Glossary terms: one source, first-use toggletips, self-contained twins

Status: Accepted

Date: 2026-11-07

## Context

Relate has vocabulary readers meet cold (store, namespace, codec,
envelope, agent mode, surface) and words with two meanings (node, the
graph element and the runtime). Kubernetes keeps one file per term and
renders a term as a glossary link with its short definition as a tooltip;
GitLab tooltips only a term's first occurrence per page; Mintlify wraps
terms with a short tip; MDN gives every term a page. Google and Mintlify
say to define a term in the sentence where it first appears. WCAG 1.4.13
and the tooltip accessibility literature say hover-only content fails
keyboard and touch users and that a definition popup should be a toggletip
opened by click, tap, or Enter. The HTML Popover API provides that
declaratively. Agents fetching markdown cannot see content that appears
only on hover.

## Decision

- The sentence defines a term on first use; the glossary machinery is a
  safety net, not a substitute.
- One file per term under `src/content/docs/_glossary/`, a content
  collection with a stable id, a one-sentence `short` definition under 160
  characters, `aliases` (the banned spellings), a `context`, a `see` link
  to the owning reference page, and a full definition in the body.
- A page references a term with a plain markdown link to the glossary
  anchor. The build turns the first such link on a page into a toggletip:
  a `<button>` with a dotted underline and `popovertarget` pointing at a
  `popover="auto"` panel holding the short definition and a read-more link.
  No hover behaviour at launch. Later uses are plain text. Never in
  headings, code, table headers, or callout titles.
- Outputs: one glossary page with stable anchors, a filter, and JSON-LD;
  `glossary.json` as the machine form read by the Vale vocabulary, the
  checks, the renderer, and the docs graph; `(:Term)` nodes in the graph;
  and a closing "Terms used on this page" section in every markdown twin.
- Checks: links resolve, short definitions well-formed, aliases in prose
  flagged, repeated unlinked use warned, unused terms reported, twin
  section matches.

## Alternatives considered

- **Hover tooltips on glossary links** (the Kubernetes rendering).
  Familiar. Rejected: hover-only fails touch and keyboard users and the
  WCAG dismiss, hover, and persist rules need JavaScript to meet; the
  toggletip meets them with none.
- **A `<Term>` component authors call.** Explicit. Rejected: a plain link
  survives in the markdown twin unchanged, needs no component import, and
  the build can find it.
- **One page per term** (MDN). Deep links and search. Deferred: anchors
  until the glossary is large or search data shows direct arrivals.
- **A hand-kept banned-synonym list in the style guide.** Rejected: two
  sources drift; the glossary's aliases are the list.

## Consequences

- The style guide's vocabulary table becomes the glossary's seed; the
  seed list is about sixty terms.
- Component and twin renderers must emit the Terms section and keep the
  first-use link a link.
- The hosted MCP's `get_page` returns the Terms section, so a page is
  self-contained over MCP too.
