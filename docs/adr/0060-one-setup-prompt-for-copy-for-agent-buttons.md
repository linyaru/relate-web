# ADR-0060: One unpinned setup prompt and one unpinned AGENTS.md block for every surface that hands an agent relate

Status: Proposed

Date: 2026-11-11

## Context

Four surfaces offered something to copy for a coding agent, each written on its own. The home
hero's "Copy for agent" and the Quickstart's "Copy prompt for agent" carried the same string,
typed twice: "Set up relate for me. Read /skill.md, install the relate agent skill, …". It never
asked for the relate CLI, and `/skill.md`, the skill's index, began its install section with the
CLI already on the machine, so an agent could install the skill and stop without a binary. The
docs landing's "Copy instructions for your agent" copied the AGENTS.md block (DOCS-PLAN.md §3.4):
repository configuration in the third person, with no request in it, and an install line that
pointed at the pinned steps while the card above it showed `install.sh`. The install page's Agent
tab held the one install prompt, pinned and hand-verified, about twenty lines long. Feedback on
the home page named the first two problems; nothing tied the surfaces together.

## Decision

One prompt, `setupPrompt()` in `src/components/docs/install.ts`, is what the hero, the Quickstart
and the docs landing copy, what the landing's twin carries in a fenced block, and the install
page's Agent tab. It is written
to be pasted unedited, in four numbered steps: install the CLI with `install.sh` (which verifies
the release), stop on a failure, and report the version `relate --version` prints; install the
skill with `relate skill install --agent <name>`, naming the agents the CLI accepts, read its
`SKILL.md` and run `relate agent-context`; use `./graph.rl`, and if it exists inspect its schema
and ask before importing, never replacing or clearing data without asking, otherwise ask what to
load and the first question, import in a transaction and verify the counts; answer with Cypher
on `--database ./graph.rl --read-only --mode envelope`, following the skill (schema first,
parameters, `LIMIT`), and write only for the requested change. It cites the agent-quickstart
twin and `llms.txt` as reference text, not instructions.

One AGENTS.md block, `agentsMd()`, is what the docs landing's second button copies and what the
install page and agent-quickstart show. Its install line is `install.sh`, and its check is that
`relate --version` runs.

Neither names a version. `install.sh` installs the latest release, and the site is re-pinned only
when `scripts/release-refresh.sh` runs, so a pinned version check would fail between the two;
`relate agent-context` prints the reference for the version that is installed. The install page
follows: it has no Pinned binary tab, its Swift line takes `<version>`, and its `relate --version`
step is not compared byte for byte. The pinned, hand-verified steps stay on agent-quickstart
("Install a pinned relate"), which the pages that cited the install page's steps now link.

This amends ADR-0013 decision 1 ("the prompt pins a version", "a second tab shows the pinned
binary") for these two texts and the install page: `docs:check` skips its `trust-pin` rule for a
fence that is byte for byte `setupPrompt()` or `agentsMd()`, and still applies it to every other
pasted install prompt. The safe defaults the same decision asks for stay: `--read-only` until
asked to write, the verification `install.sh` makes, the PATH line, and docs as reference text.

`/skill.md` says the skill does not install the CLI, and gives the install line first.
`src/lib/docs/setup-prompt.test.ts` fails if a surface types its own prompt, the prompt stops
installing the CLI before the skill, either text names a version, or the install page grows a
Pinned binary tab again.

## Alternatives considered

- **The pinned Agent-tab prompt on every button.** Exact and auditable. Rejected: about twenty
  lines of signature checks in a hero prompt, for a check `install.sh` already makes.
- **Pin the version check (`prints Relate vX.Y.Z`).** Rejected: it breaks every paste between a
  release and the site's re-pin.
- **Name the docs version in a sentence ("these docs describe 0.1.2").** Passes `trust-pin`.
  Rejected: it meets the check's letter without pinning anything, since `install.sh` still
  installs the latest release; an explicit amendment says what the prompt does.
- **A fill-in placeholder for the data.** Saves a round trip. Rejected: most pastes are unedited,
  and the agent then receives a literal placeholder.
- **Keep the landing's AGENTS.md copy, relabelled.** The smallest change. Rejected: the landing
  and the home page would still hand an agent different things.
- **Keep the install page's pinned Agent tab and Pinned binary tab.** Rejected: the install page
  would hand an agent a third text, and the AGENTS.md block pointed at steps only a pinned page
  can keep true; one exact release is an agent-quickstart and CI concern.

## Consequences

- A change to the setup steps is one edit in `install.ts`; the test keeps the surfaces on it.
- The setup prompt and the AGENTS.md block are unpinned by design; a reader who needs one exact
  release uses the pinned steps on agent-quickstart, which `<Install part="pinned">` still renders.
- `agentPrompt`, the pinned prompt, is removed. A repository's AGENTS.md no longer records a
  version, so an upgrade does not move a pin there.
- run-in-a-sandbox, use-in-ci and reference/security link agent-quickstart's pinned steps.
- The Quickstart shows the whole prompt, so its panel is taller.
- ADR-0013 gains a Later references entry naming this amendment.
- DOCS-PLAN.md §3.4 describes the Agent tab as the setup prompt and the AGENTS.md block as unpinned.
