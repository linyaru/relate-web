# ADR-0005: Markdown-first delivery for agents: twins, negotiation, indexes, the skill

Status: Accepted

Date: 2026-11-07

## Context

Relate's product category is the agent-native graph database, so the first
reader of its docs is often an agent that fetched a page. Checked on
2026-11-07, the major developer-tool docs (Next.js, Vercel, Cloudflare,
Claude Code, Stripe, Mintlify, E2B) answer `Accept: text/markdown` with
markdown, most serve a `.md` twin of every page, and skills are published
at `/.well-known/skills/`. Request-log evidence says `llms.txt` is a small
fraction of bot traffic, so the cheap conventions are worth adopting and
anything needing infrastructure needs its own reason.

The CLI already ships a skill bundle that `relate skill install` writes
into eleven agents. The site is static; the host is not yet chosen
(`LAUNCH.md`).

## Decision

Every docs page is built with a markdown twin at `/docs/<path>.md` (and
`/docs/<path>/index.md`): the page as authored, with components rendered
to markdown equivalents, YAML frontmatter an agent can parse (including
the relate version the examples were verified against), and a closing
"Terms used on this page" section (ADR-0009). The HTML page is complete
without JavaScript.

The canonical URL answers `Accept: text/markdown` with the twin, `Vary:
Accept`, and a token-count header, implemented at the host. This is an
input to the host decision: GitHub Pages cannot do it; Cloudflare Pages
and Vercel can. Until the host is chosen, the twins carry the benefit.

Indexes: a curated `/docs/llms.txt` grouped by task; `/docs/llms-full.txt`
plus one per section and per reference group; `/docs/feedback.md` telling
an agent where and how to report a problem.

The skill bundle is published on the site unchanged from upstream, at
`/.well-known/skills/index.json`, `/skills/relate/`, and `/skill.md`,
copied in the same step that refreshes the WASM. Install blocks gain an
"Agent" tab holding a prompt to paste, with one-click or one-line paths
per host where a deeplink or a CLI command exists.

## Alternatives considered

- **HTML only, converted at the edge** (Cloudflare's zone-level markdown
  conversion). No build work. Rejected: converted HTML is not the authored
  page; components, recorded outputs, and frontmatter would be lost or
  mangled, and the feature needs a paid plan on a host not yet chosen.
- **A single `llms-full.txt`.** Simplest. Rejected: one file of the whole
  docs is too large to fetch for one question; per-section files let an
  agent take the CLI reference without the Swift tutorial.
- **A docs-specific skill, separate from the CLI's.** Could be richer.
  Rejected: two bundles drift; the CLI's bundle is already the cheat
  sheet, and it links to the docs for depth.

## Consequences

- The build emits the twins and indexes from the same collection as the
  pages, so they cannot go stale independently; `docs:check` verifies the
  twins round-trip and the indexes resolve.
- Component authors must provide a markdown rendering for every component.
- Request logs by path and user agent are the evidence for later
  investment; the host must expose them.
- The home page's `cli | agentic` toggle gains a sibling in the docs'
  three-tab install block.

## Later references

- Amended by ADR-0012: the host is Cloudflare, so content negotiation on
  `Accept: text/markdown` is in at phase 1, no longer conditional.
