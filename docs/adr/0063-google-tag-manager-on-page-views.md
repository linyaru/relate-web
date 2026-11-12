# ADR-0063: Google Tag Manager measures page views on the indexable build

Status: Proposed

Date: 2026-11-11

## Context

The marketing team needs page-level measurement of the site, managed in a tag container
rather than in code. Until now the docs, cookbook and playground pages loaded nothing from a
third party with the page, and `reference/privacy-and-telemetry` says so. Adding a tag
manager changes that claim for the pages that carry it, and previews and staging builds
should never send hits.

## Decision

Pages carry the standard Google Tag Manager container snippet: a script at the end of the
head and the `noscript` frame at the start of the body. One component renders both, and it
renders nothing when the build is not indexable, so the existing indexing switch
(ADR-0058) also keeps previews out of measurement. The section layout and the home page
include it; the container's own tags and triggers are managed outside this repository.

The playground is a separate static page and does not carry the tag. The embedding-model
download in the docs is unchanged and remains a user-initiated request.

## Alternatives considered

- **A direct `gtag.js` snippet.** Rejected: it ties every tag change to a code release,
  which is what the container is for.
- **A second environment variable for analytics.** Rejected: the indexing switch already
  names "a build that is not the public site", and two switches would drift.
- **Loading the tag only after consent.** Deferred: it depends on a consent decision this
  record does not make; the container can gate its own tags in the meantime.
- **Tagging the playground too.** Rejected for now: it is a separate page and needs its own
  review of what its sessions may reveal.

## Consequences

- Pages other than the playground load a script from `googletagmanager.com`; the privacy
  page says so.
- A preview build (`PUBLIC_INDEXABLE=false`) loads no third-party script.
- A page that bypasses `Base.astro` must include the component itself.
- The container ID is in the component; changing containers is a one-line change.
