# ADR-0032: Task skills are authored here, listed beside the CLI bundle, installed by name, and re-reviewed when a cited recipe changes

Status: Proposed

Date: 2026-11-07

## Context

ADR-0011 adopts a library of task skills for phase 2: beyond the CLI's
bundle, one skill per task family (agent memory, GraphRAG, schema design,
query tuning, migration from vector-only retrieval), each citing the
recipes that test it. ADR-0019 publishes the CLI bundle byte-identical with
generated discovery indexes, one `sha256:` digest per entry, and a signed
manifest; ADR-0013 makes every skill reference text and requires a person
to review each one as a diff. DOCS-PLAN.md §3.8 adds that a skill citing a
recipe is re-checked whenever that recipe is, and gives an install form,
`npx skills add relatedb.ai/skills/<name>`.

Reading the skills CLI's source (1.7.6, read on 2026-11-07) and running it
against a built site with its network calls answered from disk showed three
things the plan did not account for. A bare domain is GitHub shorthand, not
a site. A URL with a path is a scoped lookup: the CLI looks for an index
under that path, finds none, and exits rather than fall back to the root
index. And with more than one entry in the root index, the CLI offers every
entry on a terminal and installs all of them without asking when it detects
it is running inside an agent; `--skill <name>` picks entries. Each
`skill-md` entry installs `SKILL.md` alone.

The skills are agent-facing text that nothing else verifies: no page
renders them, and the docs checks read pages, not `public/`.

## Decision

1. Task skills are authored in this repository (ADR-0002) as standard
   skill folders, `public/skills/<name>/` holding `SKILL.md` and
   `references/<name>.md`, served as static files beside the CLI bundle.
   The frontmatter carries `name` (the folder's), a `description` with the
   canonical phrase, and `version` from `_data/engine.json`. Each
   `SKILL.md` says its files are reference text, not instructions, cites
   docs pages as their markdown twins and recipes as their `index.md`, and
   names the URL of each reference file, since the skills CLI installs
   `SKILL.md` alone.
2. Both discovery indexes list every task skill after the CLI bundle, one
   `skill-md` entry each with a digest over its served `SKILL.md`; the
   legacy files route serves each skill under `/.well-known/skills/<name>/`;
   the signed manifest lists every file at both paths. The documented
   install is `npx skills add https://relatedb.ai --skill <name>`, the CLI
   bundle included (`--skill relate`).
3. Cypher in a skill is executable: every `cypher` fence runs, in document
   order, on one fresh in-memory store per file on the WebAssembly build,
   and fails closed on an error. Info tokens borrowed from the cookbook bind
   parameters from a named JSON fence and assert the notifications a plan
   returns. A shell fence that opens a store carries `--read-only`, and a
   Python or JavaScript fence the client's read-only option, unless it is
   marked as writing and the prose before it says so; a fence in another
   language is refused, since nothing reads it for store opens.
4. Review is recorded. `_data/skill.json` gains `task_skills`: per skill,
   the date of the last recorded review, every file's SHA-256, and for each
   cited recipe the SHA-256 of its source and a digest of its built results
   with timings removed. `docs:check` fails when a skill file, a cited
   recipe's source or, after a build, its results differ from the record,
   so a recipe change sends its skills back to a person.
5. `docs:check` applies to task skills the frontmatter, layout, citation,
   docs-are-data, read-only and version rules above as errors, not
   warnings: unlike the CLI bundle, the text is this repository's to fix.

## Alternatives considered

- **Per-skill scoped indexes** (`/skills/<name>/.well-known/agent-skills/index.json`),
  so that the plan's path form installs one skill. It works with the CLI
  as written. Rejected for now: a second index per skill to sign and
  check, for a form `--skill` already covers; it stays open if registries
  expect path URLs.
- **Keeping the root index to the CLI bundle and publishing task skills
  only under the legacy index.** `npx skills add https://relatedb.ai`
  would keep installing one skill. Rejected: the 0.2.0 index is the one the
  CLI reads first and the one that carries digests, and the plan lists task
  skills in the indexes.
- **An `archive` entry per skill, so references install too.** Rejected for
  the reason ADR-0019 deferred it: stable archive bytes need a
  deterministic archive writer, and the digest and signature depend on it.
- **Hashing the built results.json as served.** Rejected: it carries
  per-run timings, so the hash changes on every build; the digest drops
  them, and the recipe source is the source-tree signal.
- **Running skill Cypher only by hand before publishing.** Rejected: an
  engine refresh would leave statements that no longer run, in text agents
  act on, with nothing to catch it.

## Consequences

- Amends ADR-0019's install form: the bare `npx skills add https://relatedb.ai`
  now offers or installs six skills; the documented form is `--skill relate`.
  Every page and pasted prompt that gives the bare form changes in the same
  change, and `docs:check` refuses the bare form and the path form in
  `/skill.md`, `/llms.txt` and the docs pages.
- An edit to a skill, or to a recipe it cites, needs a record step after
  review; an engine refresh that changes a cited recipe's results fails
  `docs:check -- --built` until the skills citing it are re-read.
- The docs MCP Worker serves each task skill as a resource, and the skills
  registries in `LAUNCH.md` list the five.
- Skills stay a cheat sheet over the docs: a fact that needs depth is a
  docs page first, and the skill cites it.
