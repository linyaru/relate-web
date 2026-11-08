# ADR-0019: The skill is published byte-identical with generated indexes and a signed artifact manifest

Status: Proposed

Date: 2026-11-07

## Context

Decision 10 of the docs plan publishes upstream's agent skill on the site,
copied unchanged, so an agent can read it before relate is installed
(ADR-0013 decisions 2 and 3). Two discovery formats exist: the 0.2.0 index,
which carries one `sha256:` digest per entry and is what
`npx skills add https://relatedb.ai` reads first, and the legacy 0.1.0
index, which lists every file and has clients fetch them from
`/.well-known/skills/<name>/<file>`. The skills CLI checks the digest and
no signature, so a signed manifest is the only signature over these files.
RFC 9116 requires a Contact field in security.txt, and no disclosure
address exists yet.

This amends ADR-0013 decision 3, which puts a SHA-256 per file in the
skills index and `relate-docs.rl` in the signed manifest: the 0.2.0 index
carries one digest (SKILL.md), the per-file SHA-256 of references/ lives in
the signed `docs-artifacts.json`, and `relate-docs.rl` is listed only once
it is reproducible (ADR-0020).

## Decision

1. `npm run skill:sync` copies `surfaces/relate-cli/src/skill/bundle/` into
   `public/skills/relate/`, stamping SKILL.md's `version:` line with
   `_data/engine.json`'s version the way `relate skill install` stamps the
   binary's, so the served bundle is byte-identical to what the CLI
   installs. It reads the upstream checkout only, refuses a working tree
   that differs from HEAD, and records the commit, date and per-file
   SHA-256 in `_data/skill.json`.
2. Both indexes are build-time endpoints computed from the served bytes.
   The 0.2.0 index has one `skill-md` entry whose `url` is root-relative
   (`/skills/relate/SKILL.md`, resolved against the index URL) and whose
   digest is over that file. The 0.1.0
   index lists every file, and the build serves them under
   `/.well-known/skills/relate/` from the same source.
3. `/docs/docs-artifacts.json` lists every skill and discovery file, the
   docs graph's seed script (`/docs/graph.cypher`, ADR-0015), and
   `relate-docs.rl` and `capabilities.json` once they exist under
   `public/docs/`, with SHA-256 and size, sorted and with no timestamp. The
   release key signs it (identity and namespace `relate-release`) as
   `docs-artifacts.json.sig` beside it. The manifest does not name its
   signature, so signing never changes the signed bytes and an unsigned
   build advertises no file that is not there. `docs:check` verifies the
   signature whenever the file exists.
4. `/.well-known/security.txt` is built only when `_data/project.json`
   names a security contact, with Expires one year out and Policy once
   `reference/security` is published.
5. A skill description without the canonical phrase is a `docs:check`
   warning, not an error.

## Alternatives considered

- **A 0.2.0 `archive` entry (the whole bundle as one tar.gz or zip).** The
  skills CLI would install references/ too, which the `skill-md` entry does
  not. Deferred: the archive bytes must stay stable across builds for the
  digest and the signature, which needs a deterministic archive writer, so
  launch ships the plan's `skill-md` entry.
- **Absolute URLs in the index.** Rejected: a preview host's index would
  point at relatedb.ai, and installs from it would fetch the wrong bytes or
  a 404.
- **A second copy of the bundle under `public/.well-known/`.** Rejected:
  two copies can drift; an endpoint serves one source twice.
- **A hand-written security.txt with a placeholder Contact.** Rejected: RFC
  9116 requires a real Contact, and a placeholder invites reports to
  nowhere.
- **Failing `docs:check` on the description.** Rejected: the description is
  upstream's, so every build would fail on a change this repo cannot make.

## Consequences

- A skill refresh shows up as a reviewable diff of `public/skills/` and
  `_data/skill.json`. `docs:check` compares it with upstream at the
  recorded commit when a checkout is present, and an engine bump without a
  re-sync fails.
- Any change to a listed artifact, a docs page that changes the graph seed
  included, invalidates the manifest signature, so signing is a step after
  the final build in the release workflow.
- `npx skills add https://relatedb.ai` installs SKILL.md without
  references/, and `/skill.md` says so; the legacy index and
  `relate skill install` deliver the full bundle.
- Upstream asks: a description with the canonical phrase and intent
  phrases, and no internal ADR ids in the public bundle.
