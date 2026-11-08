# ADR-0021: Verified language samples, and a release refresh that opens a pull request

Status: Proposed

Date: 2026-11-07

## Context

ADR-0002 kept language samples hand-written and deferred checking them "if
drift appears"; ADR-0015 moved the verified Python and Node samples into the
launch set, and DOCS-PLAN.md §6 replaced the upstream website agent with a
deterministic release signal. Two shapes had to be settled: how a sample is
authored, run and recorded, given that the clients are not published before
launch; and what the release signal does, given that several files the site
serves come from the release pipeline and must never be edited here.

Constraints: the required check (`cookbook.yml`) needs no secrets and no
other repository; the engine repository is not public before launch; the
pages must be complete without JavaScript and carry every output in the
twin (ADR-0005); every example states the version it ran on (ADR-0013).

## Decision

1. A ```` ```python run ```` or ```` ```js run ```` fence is a verified
   sample: a whole program, run alone in a fresh directory against the
   client, passing when it exits 0 and prints something. Its standard
   output is recorded in the page's results sidecar in the cells' format,
   kind `text`, with the client version that ran it and a SHA-256 of the
   program, so a sample edited after its run fails the required check and
   drops its language from `verified_by`. The page and twin show the code
   and that output. `verified_by` in the twin is generated from
   which checks a page's examples passed at the docs' version.
2. Replaying samples is a separate command (`docs:samples`) and a scheduled,
   non-required workflow that builds the clients from the upstream checkout
   at the docs' version, with a read token. The required check only asserts
   that every sample has a record. After launch the clients come from the
   published packages.
3. A release triggers a workflow here (`repository_dispatch`, type
   `relate-release`, payload version and tag) that runs one script and opens
   a pull request. The synced files are copied byte for byte from where the
   upstream pipeline publishes them, and a signed file is copied only when
   its signature verifies against the key pinned in `install.sh`. The binary
   is installed through that `install.sh`. Every recording is regenerated
   with the existing recorders. engine.json is merged, not replaced, so its
   recorded runs survive until they are re-recorded. Each step's result goes
   in the pull request body with a review checklist, and the pull request is
   a draft when any step failed. The release notes are never written by the
   script: the changelog entry is a to-do row, the one docs:check error the
   refresh downgrades (`DOCS_CHANGELOG_PENDING`), and the required check,
   which never sets it, blocks the merge until a person writes it. Nothing
   is committed to `main`.

## Alternatives considered

- **Samples as data (expected values asserted inside the code).** Keeps
  the sidecar out of it. Rejected: the reader would never see output, and
  the twin rule that every result appears beside its example would not hold.
- **Samples replayed in the required check.** Catches drift on every PR.
  Rejected: it would need the private engine repository and a Rust build
  (several minutes) in a check that needs no secrets.
- **Samples sharing state like cells.** Shorter samples. Rejected: a
  language sample is meant to be copied whole and run, so it must stand alone.
- **The release workflow commits the refresh directly.** Fewer steps.
  Rejected: the skill bundle and recordings are reviewed as diffs (ADR-0013),
  and a failed step should be visible next to the diff, not silent.
- **Downloading each synced file from the release's assets.** One source.
  Rejected: `releases.json` and `extensions.json` are not release assets;
  the publishers write them only to the upstream pages branch.

## Consequences

- The results sidecar holds two kinds of entry, and each recorder keeps the
  other's: the cells recorder keeps `text` entries, `docs:samples` keeps
  cell entries.
- Sample drift shows within a week, not on the PR that causes it; a release
  refresh replays the samples when the token is available.
- A pull request opened with the default token does not start the required
  check, so the workflow uses a dedicated token when one is configured.
- Upstream's release pipeline needs one step that sends the dispatch; until
  it exists, the workflow is run by hand.
- `install.sh` installs the latest release, so the refresh works for the
  newest release only; an older one needs a manual refresh.
