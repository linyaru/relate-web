# ADR-0063: Google Tag Manager measures page views, behind a consent banner

Status: Proposed

Date: 2026-11-11

## Context

The marketing team needs page-level measurement of the site, managed in a tag container
rather than in code. Until now the docs, cookbook and playground pages loaded nothing from a
third party with the page, and `reference/privacy-and-telemetry` says so. Adding a tag
manager changes that claim for the pages that carry it, and previews and staging builds
should never send hits.

## Decision

Pages measure with Google Tag Manager, and the container loads only after the visitor
accepts. A small inline script in the head defaults every consent signal to denied, loads the
container when a stored choice says granted, and exposes the choice to the rest of the page.
A banner offers Reject and Accept with equal weight until the visitor has chosen, and a
"Cookie settings" button in the footer reopens it. Nothing is sent to Google before an
accept, and a reject after the tag has loaded reloads the page so it stops. The choice lives
in the browser's local storage and is never sent anywhere. A visitor without scripts is
never measured, so there is no `noscript` frame.

The loader, the banner and the footer button render nothing when the build is not indexable,
so the existing indexing switch (ADR-0058) also keeps previews out of measurement. The
section layout and the home page include them; the container's own tags and triggers are
managed outside this repository.

The playground is a separate static page and carries neither the tag nor the banner. The
embedding-model download in the docs is unchanged and remains a user-initiated request.

## Alternatives considered

- **A direct `gtag.js` snippet.** Rejected: it ties every tag change to a code release,
  which is what the container is for.
- **A second environment variable for analytics.** Rejected: the indexing switch already
  names "a build that is not the public site", and two switches would drift.
- **Loading the container at once with consent signals denied.** Rejected: the request to
  Google itself carries the visitor's address, so the stricter reading is to load nothing
  before consent.
- **A third-party consent platform.** Not chosen here: a banner this small needs no vendor
  and no second third-party script. The loader sets standard consent signals, so a platform
  can replace the banner without touching the container.
- **Leaving consent to the container's own tags.** Rejected: the page would still load
  Google's script for every visitor.
- **Tagging the playground too.** Rejected for now: it is a separate page and needs its own
  review of what its sessions may reveal.

## Consequences

- Visitors who reject, or have not chosen, load nothing from `googletagmanager.com`; the
  privacy page says when it loads.
- Measurement covers only visitors who accept, so counts understate traffic.
- Withdrawing consent stops the tag but cannot remove cookies the container already set.
- A preview build (`PUBLIC_INDEXABLE=false`) loads no third-party script and shows no banner.
- A page that bypasses `Base.astro` must include the loader and the banner itself.
- The container ID is in the loader; changing containers is a one-line change.
