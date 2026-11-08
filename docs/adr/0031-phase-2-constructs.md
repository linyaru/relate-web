# ADR-0031: Phase 2 constructs: the agentic and deeplink directives, a sixth JSX component for the matrix, and a language picker on the tab memory

Status: Proposed

Date: 2026-11-07

## Context

DOCS-PLAN.md §3.4 and §7.3 give phase 2 four constructs: a dual view that
shows one tutorial step as a person runs it and as an agent runs it, host
install buttons whose link is generated from a config the reader can see,
a capability matrix of every surface, and one language picker for the
page. ADR-0015 put prose constructs in remark directives rendered by one
pipeline to the page and the twin, kept JSX for generated and interactive
components, and capped phase 1 at five components; the five are taken, so
the dual view was deferred and recorded as "to be a directive".

Three constraints shape the answer. Every element is complete without
JavaScript and its twin carries what the page shows (ADR-0005, ADR-0010,
DOCS-PLAN.md §7.1). Every pastable config opens the store read-only and an
opaque deeplink is not acceptable (ADR-0013). And the page's own script
budget is small, so a construct should reuse what the layout already runs.

## Decision

1. **`::::agentic` is a directive** holding `:::human[Label]` and
   `:::agent[Label]`, once each (labels default to "As a person" and "As an
   agent"). The page renders it as a two-tab set in the existing tabs
   structure with the reserved keys `agentic-human` and `agentic-agent`, so
   the layout's tab script switches it, keeps every set on the page in step
   and remembers the choice; without JavaScript both views show, each under
   its label. The twin gives each view a heading one level below the step's
   heading, in the order written.
2. **`:::deeplink{host=… name=…}` is a directive** around one JSON fence,
   the server entry the link adds. The page renders the host's button with
   its href generated at build from that JSON, the JSON itself beside it,
   and the link as text; the twin keeps the fence and prints the link as
   inline code. Hosts: Cursor, in the form its documentation gives
   (base64 of the entry; the base64 is percent-encoded so any query parser
   restores it), and VS Code, in the form its extension guide gives. An
   entry that starts a command without `--read-only` fails the build, and
   so does one with `env` or `headers` (a link is public, so it carries no
   credential); a remote `url` entry opens no store and is allowed.
3. **`<Matrix />` is a sixth JSX component.** It is generated from a data
   file of surfaces, features and cells (yes, no, partial or unknown, each
   with a note and named sources), which is the case ADR-0015 reserves JSX
   for; it ships a `toMarkdown` (a GFM table) like the five, takes `rows`
   and `columns` to narrow, and gives each row a stable anchor. The cap
   moves from five to six for this reason only: the next component is again
   a decision.
4. **The language picker writes the tab memory, it does not keep its own.**
   A shared vocabulary maps tab keys to languages (`node`, `js` and
   `javascript` are one language). The picker appears in the page header
   only where a tab set names two or more languages, found at build from the
   page's tab directives and its install blocks; its space is held while its
   script loads, so nothing moves. Choosing a language clicks that
   language's tabs through the layout's script and puts every spelling of it
   first in the same `docs-tab` storage entry, which the layout already
   reads before it chooses a tab on the next page. The layout rewrites that
   entry one key per click from the list it read at page load, so after
   every tab click the picker rewrites it again with every spelling of each
   language in it, keeping the order and the layout's eight choices (a
   language counts once). Every set keeps its own tabs; the twin is
   unchanged.
5. **Browser storage** holds only that one per-reader convenience entry,
   read and written inside try/catch; blocked storage leaves the choice for
   the current page.

## Alternatives considered

- **`<Agentic>` as a JSX component.** Rejected: it is prose, not generated
  data, and ADR-0015 and LAUNCH.md already decided it is a directive.
- **A separate toggle script and storage key for the dual view.** Rejected:
  the tab script already switches, syncs, remembers and degrades; a second
  mechanism doubles the code and the states a reader can end up in.
- **Reusing the install block's `agent` key for the dual view.** Rejected:
  choosing the agent view would also switch every install block to its Agent
  tab.
- **A deeplink written by hand beside its JSON.** Rejected: the link and the
  JSON can drift, which is the opacity ADR-0013 forbids.
- **The matrix as authored markdown tables.** Rejected: 180 cells retyped per
  page drift from each other and from their sources; one data file is
  checked once.
- **A picker with its own storage key, applied after load.** Rejected: the
  layout would choose a tab first and the picker would switch it again, a
  visible jump on every page.

## Consequences

- README "Constructs" documents both directives with their syntax, the
  sixth component and the picker's key vocabulary; a new language key goes
  in the vocabulary, not in a page.
- The surfaces data file names its checked date and engine version; a cell
  nobody has checked is "unknown" and the matrix says so.
- A deeplink carries the JSON exactly as shown, placeholders included; the
  page says when a path needs editing after the entry is added.
- The browser check covers the dual view's switch and memory, the picker
  switching every set on a page, and a deeplink's href decoding to its JSON.
