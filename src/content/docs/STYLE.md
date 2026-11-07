# relate docs style guide

Copied verbatim from DOCS-PLAN.md §4 (decided in ADR-0008 and ADR-0009). A change needs an ADR first, then lands in both copies.

This is the writing contract for every docs page. Phase 0 copies it to
`src/content/docs/STYLE.md` unchanged, and `docs:check` enforces the
mechanical parts (§4.10). It extends `MAINTAINING.md`'s tone contract
(no marketing fluff, only substantiated claims, "full" is a reserved word,
positive framing of limits) rather than replacing it.

Where it comes from: the Google and Microsoft developer style guides
(conversational, second person, active, sentence case, contractions, "get to
the point"), GitLab (concise, global audience, Vale in CI), Mintlify (one
term per concept, intent headings, warmer in tutorials and denser in
reference), Mailchimp (voice is constant, tone adapts; "if in doubt, keep a
straight face"), Diátaxis (the language of each quadrant), and the
agent-readability guidance of 2025–26 (self-contained sections, exact error
strings, importance words, tables for constraints, positive examples first).

### 4.1 Who reads this

Two readers see the same text: a developer in a hurry, and an agent that
fetched the page as markdown and will act on it literally. Everything below
serves both. When they pull in different directions, the agent's reading
wins on *facts and structure* (exact strings, one name per thing, no
"see above") and the human's reading wins on *warmth* (contractions,
a light touch, a finish line worth reaching).

### 4.2 Voice

Voice is constant across the docs. Four words, each with its limit:

| We are | Which means | We are not |
|---|---|---|
| **Plainspoken** | Say what the thing does, then show the command. Short words, short sentences, facts before adjectives. | Hype, superlatives, "powerful", "seamless", "blazing". Marketing lives on the home page, and not much there either. |
| **Helpful** | Write like a colleague who has done this before and wants you to finish. Anticipate the next question. Say what to do when it goes wrong. | Condescending ("simply", "just", "obviously"), or pushy ("you should really"). |
| **Optimistic** | Lead with what works. Describe a limit as the shape of the tool, next to what to use instead. Confident present tense: "relate opens the store", not "relate should be able to". | Hedging, apologising, or hiding a limit. Optimism is not a reason to leave the limits page thin. |
| **A little fun** | Dry, warm, occasional. A wink in a sentence closer, a tutorial milestone that enjoys itself, example data with some life in it. | Zany. Puns in headings. Jokes about the reader. Exclamation marks. Emoji. Anything that needs a cultural reference to land. |

The fun has a budget and a place:

- **Where it lives:** tutorial openings and finish lines, tips, example data,
  the occasional closing sentence of a concept page.
- **Where it never goes:** headings, reference pages, warnings, error text,
  anything an agent will copy, limits, security, telemetry, and the sentence
  right after something went wrong.
- **The test:** it must still be true and still be clear if read with a
  straight face by someone whose first language is not English, or by a
  model that takes it literally. Irony and sarcasm fail that test, so they
  are out. Understatement and a true, slightly surprising fact pass it.
- **If in doubt, keep a straight face.** A page with no jokes is on-brand. A
  page with a forced one is not.

Samples, in relate's voice:

| Instead of | Write |
|---|---|
| Boom! Your graph is ALIVE 🎉 | You have a graph. It lives in one file, and you can email it. |
| Simply run the following command to easily create a database. | Create a store: `relate query --database ./friends` |
| Unfortunately, relate does not support cross-graph queries at this time. | A statement runs against one graph. To combine data from two stores, `clone` one into the other or query each and join in your code. |
| `:memory:` is a great option for quick experiments! | `:memory:` forgets everything when the process exits. That's the feature. |
| Please note that the row cap applies only when an agent harness is detected. | Under a detected agent harness, a statement prints at most 100 rows and says so in-band. `--max-rows 0` prints them all. |
| relate is a blazing-fast, powerful graph database. | relate is an embedded graph database. Queries run in your process; there is nothing to deploy. |

### 4.3 Tone by page type

Voice stays; tone moves with the Diátaxis quadrant and with the reader's
situation.

| Section | Tone | Person and phrasing | Personality allowed |
|---|---|---|---|
| Get started (tutorials) | Warm, encouraging, unhurried. Nothing is optional, nothing is explained at length. | "We" and "let's" for the shared path, "you" for what the reader does. "First, create… Now run… Notice that… The output should look like…" | Most. An opening that says what you'll have built, a finish line that enjoys it. |
| Guides (how-to) | Direct, practical, assumes competence. | "You" and imperatives. Open with "This guide shows you how to…" or the goal in one sentence. Conditional imperatives: "If you want X, pass Y." Link to reference instead of listing options. | A tip can smile. The steps do not. |
| Reference | Austere, neutral, complete. No opinion, no persuasion, no instruction. | Third person and tables. "`--max-rows N` prints at most N rows." States facts about behaviour, options, errors, limits. | None. Not even a little. |
| Concepts (explanation) | Thoughtful, candid, allowed to have a view. Can discuss trade-offs, history and alternatives. | "Relate does X because Y." Comparison tables. "The reason for X is…" | Some. A well-placed closing sentence. |

Tone by situation, on any page:

- **Something went wrong:** calm, specific, remedy first. Quote the exact
  error. "If you see `conflict` (exit code 5), another process holds the
  store. Close it, or open yours with `--read-only`."
- **A limit:** state it plainly, next to the alternative, in the same
  paragraph as the example it affects. Never in a footnote, never as an
  apology.
- **A preview feature:** the status and the opt-in in the first sentence:
  "Ontology procedures are a preview feature; set `RELATE_PREVIEW=ontology`
  to use them."
- **Security, data loss, telemetry:** plain, complete, no lightness.

### 4.4 Words

**The product.** The name is `relate`, lowercase, in prose and at the start
of a sentence. In code font only when it names the command. Never "Relate
DB", "RelateDB", or "the relate database"; "relate" is enough. (Upstream
writes "Relate" in its README; the site has used lowercase since the rename,
and this guide follows the site. Decision 12.)

**One name per thing.** The glossary (§4.11) is the source: each term's
`aliases` are the banned spellings, and `docs:check` flags them. These are
the ones that matter most; the table is the glossary's seed.

| Say | Not |
|---|---|
| store (a directory store, a single-file `.rl` store, an in-memory store) | database file, graph file, db, bundle (except in "`.rl` bundle" when the format itself is meant) |
| `.rl` | `.cl`, `.rl file` when "store" is meant |
| statement (what you run); query (the `query` command, or a reading statement when the contrast with writing matters) | mixing them inside one page |
| surface (any front door: CLI, Python, Bolt, MCP…) | binding, interface, API (except in "C API", "HTTP Query API") |
| client (a language package: the Python client, the Go client) | binding, driver, SDK, wrapper |
| Cypher, openCypher, Neo4j, Node.js, WebAssembly (WASM after first use) | cypher, OpenCypher, neo4j, Node (ambiguous with a graph node), Wasm |
| node, relationship, label, type, property | vertex, edge, link, attribute |
| namespace | database (when `neo4j` / `system` is meant) |
| snapshot, checkpoint, WAL, codec | dump, backup (when a checkpoint is meant), format (when codec is meant) |
| agent, agent harness | AI, LLM (when the tool running the model is meant), bot, assistant |
| skill, the skill bundle | plugin, extension (reserved for `relate run` packages) |
| extension (a `relate run` package) | plugin, add-on |
| envelope (the `--mode envelope` object) | wrapper, response object |
| exit code, error code, error kind | status, return value |

**Banned words and phrases**, enforced: simply, just (as a minimiser), easy,
easily, quick, quickly, obviously, of course, please, note that, it's worth
noting, in order to, utilize, leverage, robust, powerful, seamless, blazing,
revolutionary, fastest, best-in-class, world-class, cutting-edge,
state-of-the-art, "we're excited", "let's dive in", "unlock", "supercharge",
"full" (reserved: only where 100% is true, per `MAINTAINING.md`), e.g., i.e.,
etc., "and more". Also: a "Note:" prefix in body text (use a callout), and
any exclamation mark outside a tutorial's final paragraph (one per tutorial,
maximum, and only if it earns it).

**Fine, and encouraged:** contractions (it's, you'll, don't), "you", "we" in
tutorials, short fragments in tables, the Oxford comma, American spelling
(decision 13).

### 4.5 Sentences and structure

- One idea per sentence, under 25 words. Paragraphs of two to four
  sentences. Split anything that needs two commas and a semicolon.
- Active voice, present tense. "The CLI prints an error object" not "An
  error object is printed". Passive is fine only when the actor is unknown
  or beside the point.
- Start with the verb in steps. Edit out "you can" where it adds nothing.
- Lead every page and every section with its answer. A how-to's first code
  block is the task.
- Headings in sentence case, phrased as the reader's intent ("Import a CSV",
  "Serve a store over Bolt"), no trailing punctuation, no skipped levels,
  never a joke. Heading ids are stable: renaming one is a redirect.
- Lists for parallel things, tables for options, defaults and comparisons,
  prose for an argument. A paragraph is not a list in disguise.
- Define a term where it first appears, in the sentence, then link to the
  glossary. Don't send the reader away to learn a word.
- No "above", "below", "earlier", "as mentioned", "here". Say what you
  mean or link to it by name.
- Numbers as digits. Dates as `2026-11-07`. Units with a space: `2.3 MB`.
- Spell out an acronym on first use per page, except Cypher-world ones
  everyone knows (CLI, JSON, CSV, WAL, MCP, HTTP, URL).

### 4.6 Code, commands and output

- Every fenced block has a language: `bash`, `cypher`, `python`, `js`,
  `rust`, `java`, `go`, `swift`, `c`, `json`, `yaml`, `text` (for output).
  Fence meta drives behaviour: ```` ```cypher run ```` is a runnable cell,
  `title="…"` names a file.
- Shell blocks are copyable: no `$` prompt, one command per line, long
  commands broken with `\`. Output goes in its own `text` block directly
  after, pasted from a run against the page's `verified:` version, never
  retyped or tidied. If output varies (timings, paths, versions), say which
  part varies in the sentence before it.
- Cypher: uppercase keywords, lowercase variables, `$parameters` for every
  value that is not a literal in a teaching example. Examples that write
  state what they write in the sentence before.
- Placeholders in `<angle-brackets>` with a noun: `<path>`, `<token>`. Never
  `foo`, `xxx`, or a plausible-looking fake secret.
- Inline code for commands, flags, file names, paths, environment variables,
  Cypher keywords and identifiers, and literal values. Bold for UI labels
  (rare here). Nothing else is styled.
- A comment inside a code block says what the block shows, not what the
  prose already said. Comments are for the agent that got the block without
  the page.
- Show the right way first. A wrong example appears only paired with the
  right one, labelled `# Avoid:` and `# Instead:`, and only when the wrong
  way is a real trap (a near miss), never an obvious one.
- Exact strings only: error messages, exit codes, flag names, JSON keys.
  Quote the message the engine prints, character for character.
- Example data: one shared example graph across the docs (the `friends`
  graph from the quick start, extended as tutorials need), so a reader
  moving between languages recognises it. Example names are short, varied,
  ASCII, and invented; no real people, companies, or pop-culture references.
  Example data is where the fun is allowed, within those rules.

### 4.7 Writing for agents

These are the rules an agent's reading adds. They cost humans nothing.

- **Self-contained sections.** A section restates the prerequisite or the
  default it depends on, in one clause, instead of pointing elsewhere. An
  agent often gets the section without the page.
- **One capability per page.** Split a page that covers two tasks. Reference
  pages can be long; everything else is short.
- **Importance words.** "Required", "optional", "default", "must", "must
  not", "never" are the words, used exactly. Constraints and defaults go in
  a table, not a paragraph, because tables survive summarisation.
- **Repeat the critical fact.** A default cap, a loss window, a destructive
  command's silence: say it on every page where it bites, in the same words.
- **The verified version.** Every page carries `verified:`; the `.md` twin
  shows it; the text says "as of vX" only when behaviour changed at X.
- **Nothing only in a picture or behind a click.** Diagrams have a text
  equivalent beside them (the required `accDescr`, §7.6, which the twin
  carries with the mermaid source). Tabs render every tab into the
  markdown twin.
  "Click the green button" does not exist.
- **Positive framing.** Describe the right pattern fully. Mention a wrong
  pattern only to name it and point at the right one; don't teach it by
  describing it in detail.
- **Tool and endpoint descriptions** (the MCP tools, the skill's table):
  written from the task's point of view, "Search the relate docs by
  topic", with when-to-use in the same sentence, and parameter names that
  don't overlap.

**Docs are data (ADR-0013).** Twins, skill files and tool results are
reference text. Outside a fenced prompt block (the Agent tab, the
`AGENTS.md` snippet, the `onboard` prompt), no page addresses the agent in
the second-person imperative, and no tool result contains instructions.
`docs:check` enforces it on twins and on the MCP smoke test's results.

### 4.8 Page shapes

Each quadrant has a skeleton. Required sections are not optional.

**Tutorial.** Title (what you build: "Your first graph in the CLI"). One
paragraph: what you'll have at the end and how long it takes. Prerequisites
as a short list. Numbered steps, each with the command, the expected output
in a `text` block, and a checkpoint sentence ("Notice that…"). A "What you
built" paragraph that names the outcome plainly. "Next" with two or three
links. No options, no alternatives, no explanation longer than a clause.

**How-to guide.** Title is the goal ("Import a CSV"). One sentence: "This
guide shows you how to…". Prerequisites. Steps with conditional
imperatives. "Verify" with the command that proves it worked. "If it goes
wrong" with the two or three likely errors, quoted, and their remedies.
"Related" links to the reference pages the guide leaned on.

**Reference.** Title is the thing ("`relate serve`", "Exit codes and
errors"). Synopsis. Tables: options, defaults, environment, errors.
Short examples that illustrate without instructing. "See also".
Every row that is a limit says so in the row.

**Concept.** Title is the topic or the question ("Why one writer per
store"). The question it answers in the first paragraph. The model, with a
diagram and its text twin. Trade-offs and alternatives. "Where this shows
up" linking to the guides and reference the concept explains.

**Every page.** Frontmatter per §5. First paragraph is the answer. No page
ends on a warning; end on the next step.

### 4.9 Callouts, links, accessibility

- Callouts: `note` (context that doesn't change the steps), `tip` (a better
  way, allowed to smile), `warning` (data loss, security, cost, or a trap;
  placed before the step it concerns), `preview` (status + opt-in). At most
  two per section; a section that needs more is two sections.
- Link text says where it goes ("the exit code table"), never "here" or
  "this page". Guides link to reference rather than restating it. External
  links only to primary sources.
- Images carry alt text that states the information, not "screenshot".
  Meaning is never carried by colour alone. Diagrams have the light/dark
  pair and the text equivalent.
- Global audience: no idioms, no culturally specific references, no Latin
  abbreviations, no humour that depends on a shared background.

### 4.10 What `docs:check` enforces

Vale, with the Google base style plus a relate vocabulary, runs on every
PR; the custom checks live in `scripts/docs.ts`:

| Check | Rule |
|---|---|
| Banned words and synonyms | §4.4 lists, with the preferred term in the message |
| Headings | sentence case, no trailing punctuation, no skipped level, no `!`/`?` |
| Exclamation marks | zero outside Get started; one, in the last paragraph, inside it |
| Fences | every block has a language; `bash` blocks have no `$` prompt; a `run` cell is Cypher |
| Frontmatter | the schema of §5, `verified:` present, `description` 60–160 characters |
| Links | no "here"/"click here"/"this link"; internal links resolve; no bare URLs in prose |
| Self-reference words | "above", "below", "earlier", "as mentioned" flagged |
| Acronyms | first use per page expanded, except the allowlist |
| Page shape | required sections present for the page's `type` |
| Glossary | the checks of §4.11: links resolve, short definitions well-formed, aliases flagged, unused terms reported, the twin's Terms section matches |

The non-mechanical rules (voice, the fun budget, tone by situation) are
reviewed by a person, with this section as the checklist. The release-time
update agent gets the same checklist in its brief.

### 4.11 Glossary and terms

**What the research says.** Kubernetes keeps one file per term and a
shortcode that renders a term as a link to the glossary with the short
definition as a tooltip; GitLab tooltips the first occurrence of a
product-specific term on a page and sends longer definitions to a glossary
page; Mintlify's `<Tooltip>` wraps a term with a short tip and an optional
"read more" link; MDN gives every term its own page and splits ambiguous
terms by context. Google and Mintlify both say to define a term in the
sentence where it first appears rather than linking away. The accessibility
guidance (WCAG 1.4.13, Sarah Higley on tooltips) says hover-only content
fails keyboard and touch users, must be dismissable, hoverable and
persistent, and that a definition popup is better built as a *toggletip*:
a button that opens a small panel on click, tap or Enter and closes on
Escape or a click outside. The HTML Popover API (baseline since April 2024)
gives exactly that with no JavaScript. For agents, the guidance is that a
glossary helps them interpret terms that arrive from other pages, and that
hidden-until-hover content is invisible to a fetcher, so the definition has
to be in the static HTML and the markdown.

**The rule for prose stays first.** A term is defined in the sentence where
a page first uses it, in a clause, the way §4.5 says. The glossary
machinery is the safety net for a reader (or an agent) who landed
mid-page, not a substitute for writing the definition.

**One source for every term.** `src/content/docs/_glossary/<id>.mdx`, a
content collection with this frontmatter:

```yaml
id: store                       # stable; renaming needs an alias and an anchor redirect
term: store
short: A relate database on disk or in memory: a directory, a single `.rl` file, or `:memory:`.
                                # one sentence, under 160 characters, plain text, ends with a period
aliases: [database file, graph file, db]   # what people say instead; feeds the banned-synonym check
context: storage                # cypher | storage | cli | agents | surfaces | engine; disambiguates "node" vs Node.js
see: reference/storage/formats  # the reference page that owns the detail
related: [directory-store, single-file-store, in-memory-store]
```

The body is the full definition: two to four paragraphs, links and a short
example allowed, written in reference tone (§4.3). The seed list is about
sixty terms: store and its three forms, `.rl`, namespace, snapshot,
checkpoint, WAL, codec, durability mode, read-only and follow opens,
statement, query, parameter, envelope, agent mode, agent harness, row cap,
exit code, error object, skill and skill bundle, surface, client,
extension, MCP, Bolt, HTTP Query API, Cypher, openCypher, GQL, Cypher 25,
preview feature, label expression, quantified path pattern, `SEARCH`,
vector index, full-text index, point index, ontology, schema folder, graph
type, index, constraint, notification, plan, node, relationship, label,
relationship type, property, path, element id, bookmark, transaction,
conflict, safe mode, TOON, logical graph size, pull, push, clone,
telemetry.

**What the glossary file produces.**

| Output | Form |
|---|---|
| `/docs/reference/glossary` | one page, alphabetical, a filter box, every term at a stable anchor `#<id>`, the short definition first and the full one under it, "see" and "related" links; JSON-LD `DefinedTermSet` in the head (cheap; the search benefit is unproven, so it is not a reason on its own) |
| `/docs/reference/glossary.md` | the twin, as for every page |
| `/docs/glossary.json` | `{id, term, short, aliases, context, url}` per term: the machine form the Vale vocabulary, the banned-synonym check, the term component and the docs graph all read |
| the docs graph (§3.5) | `(:Term)` nodes with `DEFINED_ON` the glossary page and `USED_ON` every page that links the term, so "which pages use *envelope* without defining it" is a query |
| the `.md` twin of every page | the term's first use renders as a plain link to its anchor, and the twin ends with a `## Terms used on this page` section listing each linked term with its `short`, so the page is self-contained for an agent that fetched only it |

**How a page references a term.** Authors write an ordinary markdown link
to the glossary anchor: `[a store](/docs/reference/glossary#store)`. No
component, no shortcode. The build recognises links into the glossary and
renders them as the term control; in the markdown twin they stay links.

**How it renders in HTML.** The first reference on a page becomes a
*toggletip*, not a hover tooltip:

- A `<button>` with the term text, styled with a dotted underline in the
  muted foreground colour so it reads as a definition, not a link, and
  `popovertarget` pointing at a `<div popover="auto">` that holds the
  `short` definition and a "Read more in the glossary" link to the anchor.
  Click, tap or Enter opens it; Escape or a click outside closes it; focus
  stays on the button. Declarative, so it works with JavaScript off, and
  the definition is in the static HTML for any fetcher.
- No hover behaviour at launch. Hover previews for mouse users can be added
  later as a progressive enhancement that does not change the keyboard or
  touch path.
- Later references of the same term on the page are plain text. One
  toggletip per term per page, the Kubernetes and GitLab practice; more is
  noise.
- Never inside headings, code, tables' header cells, or callout titles.
  Inside a reference table cell it renders as a plain link, not a
  toggletip, because tables are scanned.

**Checks** (added to §4.10's table):

| Check | Rule |
|---|---|
| Glossary links | every link into the glossary resolves to a term id |
| Short definitions | one sentence, under 160 characters, no links, ends with a period, does not start with the term |
| Aliases | an alias appearing in page prose is flagged with the preferred term (this replaces the hand-kept list in §4.4; the table there becomes the seed of the glossary) |
| First use | a page whose prose uses a glossary term three or more times and never links it gets a warning, not a failure |
| Unused terms | a term no page links is reported, so the glossary does not grow stale |
| Twin | the `## Terms used on this page` section matches the page's linked terms |

**Decision 16** records this. At launch the glossary ships `short`
definitions only (the toggletip content); full bodies and the toggletip
control itself are phase 2 (ADR-0015), so phase 1 pages link the term
plainly. Decided 2026-11-07: anchors only, one glossary page; a URL per term (MDN style) is revisited if the glossary
passes about a hundred terms or search data shows people arriving at terms
directly.

