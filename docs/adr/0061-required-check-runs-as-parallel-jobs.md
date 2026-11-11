# ADR-0061: The required check runs as parallel jobs, with the browser run in shares

Status: Proposed

Date: 2026-11-11

## Context

`cookbook.yml` is the check every pull request waits on. It ran as one job,
every step after the last, and grew to about twenty minutes. Measured on the
runner, most of that is four costs: the headless Chrome run (about nine
minutes: some four hundred checks, each in a fresh tab, one at a time), the
playground's Vite build (about four minutes, nearly all of it terser over
the editor's and the graph view's bundles), installing the playground's
packages (one and a half minutes), and the source checks and unit tests,
which need no build but waited for nothing and blocked everything after
them.

The browser checks are independent by design: each opens its own tab on the
built site, and the few that read what an earlier one left in the profile (a
remembered choice, then the new tab that reopens on it) are written as one
check. The playground build already reuses its last output when none of its
inputs changed, but a fresh runner never has that output. A runner has four
cores, so running the browser checks side by side in one job would trade
time for timing-sensitive failures in the element cases.

## Decision

The check runs as parallel jobs on fresh runners. A source job runs
everything that reads only the sources (unit tests, the decision records,
the docs and recipe checks, the prose lint, the site's types). Beside it, a
build job type-checks the playground, builds the site and uploads `dist/`.
After the build, the built-docs check and four shares of the browser run
start together, each on the uploaded `dist/`.

The browser run takes a share, `<k>/<n>`: its checks are numbered in a fixed
order that depends only on the build and the case files, and dealt round
robin, so the shares together run each check once. The built-files checks,
which take no browser, run in every share.

The build job caches the playground's packages on its lockfile and the
playground's build on the key the build script already computes from its
inputs, so a change that does not touch the playground reuses both.

A final job passes only when every other job passed, a skipped or cancelled
one included. It keeps the job name the single job had, so it is the one
status to require.

## Alternatives considered

- **Browser checks side by side in one job (several tabs or several Chromes
  on one runner).** No artifact hand-off, and it would also speed a laptop
  run. Rejected: four cores shared between Chromes drawing WebGL in software
  make the timing and animation cases flaky, and one job still waits for the
  build and the source checks in turn.
- **Larger runners.** No change to the workflow. Rejected for now: they cost
  money on a public repository whose standard runners are free, and do
  nothing for the serial order.
- **A paths filter that skips the browser run for changes it cannot affect.**
  Rejected: the check must always report to be required, and the browser run
  covers the docs, the cookbook, the playground and the elements, which is
  most of the repository.
- **A faster minifier for the playground.** Rejected: esbuild's minifier
  breaks labelled statements in two of its dependencies (the reason
  `vite.config.ts` names terser); the cache removes the cost for most
  changes without that risk.

## Consequences

- The check takes about as long as the build plus one share of the browser
  run, instead of the sum of every step.
- A failing browser check reports in the share that ran it; `BROWSER_SHARD`
  reproduces that share locally. `npm run ci` still runs everything in one
  process, in the old order.
- A new browser check is a new numbered unit: it must not depend on another
  unit having run first in the same profile, since another share may run it.
- More runner minutes per run (each job sets up and installs on its own),
  spent in parallel.
