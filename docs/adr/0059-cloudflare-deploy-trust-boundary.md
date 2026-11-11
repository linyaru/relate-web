# ADR-0059: Cloudflare deploys trust write access only, and the token never shares a job with the build

Status: Proposed

Date: 2026-11-11

## Context

`deploy-cf.yml` publishes the site to Cloudflare Pages with an API token:
production on pushes to `main` and on upstream's release dispatch, a
preview for each pull request. The repository is public, so anyone can open
a pull request, and the question is who can make the workflow deploy, and
what can reach the token while it runs.

GitHub already answers the first part. A pull request from a fork runs
with no repository secrets under the `pull_request` event, and the job also
skips fork pull requests explicitly. Only a branch in this repository gets
a preview, and only someone with write access can push one. A check inside
the workflow for "members only" adds nothing: whoever can push a branch can
also edit the workflow on that branch. The boundary is write access to the
repository, enforced by GitHub, and the work is to keep it that way and
make the most of it.

The second part was weaker. The build, the deploy and the dependency
install shared one job. `npm ci` runs every dependency's install scripts,
and a step can change the environment of the steps after it, so one
compromised package could reach the token when the deploy step ran. The
upstream token was in the same position, fetched after the install.
Cloudflare tokens cannot be limited to preview branches: any token that can
publish a preview can publish production.

## Decision

1. Deploys run only for pushes and dispatches on this repository and for
   pull requests whose head branch is in it. The workflow never uses
   `pull_request_target`, and fork pull requests never get a preview.
2. The build and the deploy are separate jobs. The build job holds no Cloudflare secret: it
   installs, checks, builds and uploads `dist/`. The deploy job is the only
   one that reads the token; it installs the root dependencies with install
   scripts off (the Pages Functions need one of them to bundle), takes
   `dist/` from the build at the same commit, and runs the pinned wrangler.
3. The upstream token is used before any dependency is installed.
4. Least privilege in the workflow: no default token scopes, checkout
   credentials not kept on disk, and the branch name passed to the shell as
   data.
5. A third job, on pull requests only, posts the preview's URLs as one
   pull request comment and edits it on later pushes. It holds no secret,
   checks out nothing and has only the scope to write pull request
   comments; it takes the URLs from the deploy job only when they are on
   the project's `pages.dev` host.
6. The token is scoped to Cloudflare Pages edit on the one account, and
   `main` requires a reviewed pull request. Both are settings outside the
   repository, named here so the boundary in 1 holds.

## Alternatives considered

- **An org-membership or author-association check in the workflow.** It
  reads like a lock. Rejected: anyone who can trigger the run can delete
  the check on their branch, and fork pull requests are already excluded.
- **`pull_request_target` with a membership check, to preview outside
  contributions.** Rejected: it runs with secrets, and building a fork's
  code there hands that code the token.
- **A GitHub environment with required reviewers on preview deploys.**
  Rejected for now: every preview waits for a person, and it protects
  nothing a write-access holder cannot already do by pushing to a branch.
- **Separate tokens for preview and production in branch-limited
  environments.** Rejected: Cloudflare Pages tokens cannot be limited by
  branch, so the preview token could still publish production.

- **Cloudflare's Git integration, which builds and comments on pull
  requests itself.** Rejected: it builds on Cloudflare with no access to
  the checks this workflow runs first, and a direct-upload project cannot
  switch to it.
- **A marketplace action for the preview comment.** Rejected: one more
  third-party dependency with a write scope, for a few lines of `gh`.

## Consequences

- A dependency's install script no longer runs on a runner that holds the
  Cloudflare or upstream token.
- A deploy is two more jobs and an artifact upload, about a minute longer.
- A preview's link is on its pull request; nobody looks it up in the run log.
- The trust boundary is the list of people with write access and the
  protection on `main`; both are reviewed as part of launch.
- `runbooks/deploy-failed.md` and `AGENTS.md` describe the jobs.
