#!/usr/bin/env bash
# The failing fixture: pass.sh, except that under the `none` condition it
# leaves Noor's WORKS_ON relationship out of the team-graph task, so
# `node scripts/docs-evals.ts --dry-run` must report exactly one red
# assertion (team-graph / works-on, condition none) and exit 1.
if [ "${DOCS_EVALS_CONDITION:-}" = none ]; then export DOCS_EVALS_FIXTURE_BREAK=team-graph; fi
exec bash "$(dirname "$0")/pass.sh"
