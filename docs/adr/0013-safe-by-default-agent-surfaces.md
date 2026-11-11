# ADR-0013: Agent-facing surfaces are safe by default and docs content is data

Status: Accepted

Date: 2026-11-07

## Context

The docs plan (DOCS-PLAN.md §3) gives agents pastable prompts, host config
blocks, a skill, a hosted MCP endpoint and markdown twins. An adversarial
review from a security and enterprise-trust persona found that, as drafted,
every pastable block installed an unpinned binary through `curl | bash`,
opened the store writable, and installed MCP config from an opaque
base64 deeplink; that nothing in the plan treated page text, skill files or
MCP tool results as untrusted input to an agent; that new agent artifacts
(`relate-docs.rl`, the skills index, `capabilities.json`) were unsigned
although upstream signs releases and the site already serves a signed
`extensions.json`; that the hosted MCP had operating rules but no threat
model; and that the privacy story contradicted itself (no query text kept,
yet a metric on search queries). Enterprise agent policies block the first
and audit the rest; unsafe defaults are an adoption blocker for the very
audience the docs target. Upstream already has the primitives: a pinned
SSHSIG signing key for `SHA256SUMS`, `--read-only`, `--safe`, agent mode,
and structurally query-free telemetry.

## Decision

1. **Safe defaults where agents copy from.** Every host config block and
   the pasted install prompt open the store with `--read-only` (and `--safe`
   where it fits), with a one-line "to allow writes, remove `--read-only`"
   toggle. The prompt pins a version, names the verification `install.sh`
   performs (signed checksums against the pinned key; nothing installs on
   failure), states the PATH line, says where `relate skill install`
   writes, and ends with a verify step with the expected bytes. A second
   tab shows the pinned binary with manual `sha256sum -c` and `ssh-keygen
   -Y verify`. Any deeplink's decoded config is rendered beside the button
   and generated from it, so it is reviewable.
2. **Docs are data.** Markdown twins, skill files and MCP tool results are
   reference text, not instructions. Tool results carry
   `kind: "documentation"`; `SKILL.md` and every tool description say so.
   Outside fenced prompt blocks, no page or tool result addresses the agent
   in the second person imperative. `feedback.md` tells an agent to ask its
   operator before posting anywhere. Every refresh of the upstream skill
   bundle, and every skill authored here, is reviewed by a person as a diff
   before it is published; `docs:check` records the upstream commit.
3. **Signed agent artifacts.** The skills index carries a SHA-256 per
   file; a `docs-artifacts.json` manifest listing `relate-docs.rl`,
   `capabilities.json` and the skills index is signed with the release key
   like `extensions.json`; `docs:check` verifies both; the `--load` block
   shows the checksum.
4. **A published threat model for the hosted MCP.** The engine opens
   read-only (`new RelateDb(true)`); statement, memory and traversal caps;
   a per-IP rate limit and a per-tool cost budget (shared egress behind
   cloud harnesses makes per-IP both too strict and too loose); limits
   published with `Retry-After`; CORS `*` with no cookies, stated; what
   Cloudflare logs and for how long; an abuse contact. Tools that execute
   caller input get a fresh engine per request. The smoke test asserts
   write and procedure refusal.
5. **Trust pages at launch.** `reference/security` (signing key
   fingerprint and stable URL, manual verification, notarization,
   supported versions, disclosure address, the MCP threat model),
   `reference/privacy-and-telemetry` (CLI events verbatim from the spec,
   `DO_NOT_TRACK=1`, what never phones home, no third-party scripts, what
   the Worker logs), `security.txt` beside `/.well-known/skills/`, and a
   permission matrix in `agent-safety` (`--read-only`, `--safe`, `LOAD CSV`
   policy, `--fetch-params`/`--load` egress, extension tiers, `upgrade`,
   by CLI, MCP stdio, MCP HTTP and the hosted docs MCP).

## Alternatives considered

- **Writable defaults with a safety note.** Shorter blocks, fewer flags.
  Rejected: agents copy the block and skip the note; the cost of a
  destructive first write is borne by the user.
- **Treat docs as trusted because they are author-controlled.** True today;
  rejected because the skill is re-served from upstream and the skills
  library and MCP results are the injection path a reviewer will test
  first. The rule costs one check and one sentence.
- **No signatures on docs artifacts.** Rejected: the signing key and the
  `.sig` pattern already exist in this repo; omitting them would be the
  only unsigned agent-facing file on the site.

## Consequences

- The install block, the agent quickstart and the MCP guide are written to
  this contract from the first proof pages (phase 0).
- `docs:check` gains: no imperative text in tool results and twins outside
  prompt fences, manifest signature verification, the upstream bundle
  commit record, and the smoke-test refusals.
- The metric "search queries with no good hit" is dropped in favour of a
  zero-result count without query text, so §3.7's "no query text is kept"
  holds.
- Upstream asks: a `SECURITY.md`, statement deadline and memory caps in the
  WASM build, and the `docs` URL in the error object.

## Later references

- Imperative rule, scope (phase 0, 2026-11-07): `docs:check` applies the
  "no second-person imperative outside prompt fences" rule of decision 2
  to twins and tool results of `reference` and `explanation` pages, and
  to every page's prose outside tables and headings. Steps of a
  `tutorial` or `how-to` are imperative by design, a table's remedy
  column is imperative by nature, and headings are phrased as intents
  (STYLE.md §4.5), so those are exempt; the injection patterns apply
  everywhere. The intent of decision 2 is unchanged: an agent reading a
  reference page or a tool result is never addressed as the actor.
- Skills index digest (phase 0 spike, 2026-11-07, DOCS-PLAN.md §9): the
  discovery format carries one `sha256:` digest per entry over the
  artifact's bytes, not one per file as decision 3 says; the CLI verifies
  that digest and no signature, so the signed `docs-artifacts.json` is
  the only signature over the index.
- Read-only open, amended by ADR-0023 (Proposed; phase 1 part C,
  2026-11-07): the WASM build cannot hold content in a read-only in-memory
  store (`new RelateDb(true)` refuses the seed; upstream ADR-0136) and
  cannot open a `.rl` or a snapshot, so the docs MCP Worker replays the
  seed into a writable in-memory handle. The fence of decision 4 is
  structural: no tool accepts Cypher, and the only statement after the
  seed is one constant read with the caller's words bound as a parameter.
  `reference/server/docs-mcp` states this. Upstream ask: a way to freeze a
  seeded handle, or to open a snapshot read-only, in the WASM.
- ADR-0026 (capability catalog): a capability's `intents` are quoted user
  requests, exempt from the imperative rule and checked for injection
  phrasing like every other catalog field.
- ADR-0032 (task skills): the read-only rule covers client fences in a
  task skill (`read_only=True` in Python, `readOnly: true` in
  JavaScript), and a skill fence in another language is refused.
- ADR-0031 (phase 2 constructs): a host deeplink is generated from the
  JSON shown beside it, needs `--read-only` on a command entry, and
  refuses `env` and `headers`.
- Amended by ADR-0060 (one setup prompt): the setup prompt (the home
  page's and the docs landing's copy-for-agent buttons, and the install
  page's Agent tab) and the AGENTS.md block install with `install.sh` and
  pin no version, and the install page has no Pinned binary tab; the
  pinned steps stay on agent-quickstart, and decision 1's pin applies to
  every other pasted install prompt.
