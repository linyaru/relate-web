# ADR-0004: Diátaxis sections with plain URL names

Status: Accepted

Date: 2026-11-07

## Context

Relate has many front doors (the CLI, eight language clients, three server
protocols, an extension mount) and several kinds of reader (agents,
developers embedding it, CLI users, evaluators). Documentation organised
by surface becomes eight parallel manuals; organised by reader it
duplicates content. Diátaxis separates content by the reader's need
(learning, doing a task, looking something up, understanding) and gives
each kind its own writing rules, which keeps a tutorial from turning into
a reference and a reference from turning into a sales page.

Diátaxis's quadrant names (tutorials, how-to guides, reference,
explanation) are for authors; the framework says readers need not see
them. URLs are permanent.

## Decision

Four sections, one per quadrant, under plain names:

| Quadrant | Section | URL |
|---|---|---|
| Tutorials | Get started | `/docs/get-started/` |
| How-to guides | Guides | `/docs/guides/` |
| Reference | Reference | `/docs/reference/` |
| Explanation | Concepts | `/docs/concepts/` |

The cookbook stays at `/cookbook/` as a fifth door: tested, task-shaped
recipes that are Diátaxis-ambiguous by design and already their own
pipeline. "Agents" is a door on the docs landing page and the first path
in `llms.txt`, not a fifth section: agent pages live in their quadrants so
the writing rules hold.

Every binding gets a full tutorial under Get started, sharing one outline
and one example graph. No docs versioning at launch: one current version,
a `since` badge where a feature has a version, and a changelog page.

## Alternatives considered

- **The Diátaxis words as URLs** (`/tutorials`, `/how-to`,
  `/explanation`). Faithful to the framework. Rejected: `explanation` and
  `how-to` read awkwardly in a sidebar and a URL, and the framework itself
  says the names are not for readers.
- **A fifth "Agents" section.** Puts the product's lede first. Rejected:
  audience sections cut across the quadrants, so each agent page would
  have to be a tutorial, a guide, and a reference at once; a landing-page
  door and an index path give the prominence without breaking the rules.
- **Short quickstarts for the less common languages instead of full
  tutorials.** Less to write. Rejected by the maintainers: every binding
  is a first-class surface and gets the same treatment.
- **Versioned docs from day one.** Rejected: nothing is published yet, so
  there is nothing to version against; revisit at the first breaking
  release.

## Consequences

- Each section has a writing contract in the style guide (ADR-0008);
  pages that mix kinds are split.
- The sidebar, `llms.txt`, and the landing page are generated from the
  section a page sits in, so section membership is the only structural
  metadata a page needs.
- Changing a URL later means a redirect; heading ids are treated the same
  way.

## Later references

- Amended by ADR-0015: the launch set is about 30 pages, listed in
  DOCS-PLAN.md §10; ADR-0014 adds the fit and performance pages.
