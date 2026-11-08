#!/usr/bin/env bash
# The writing fixture: pass.sh, except that under the `none` condition the
# read-only-answer task gets the right answer from a query that writes to the
# store it was told not to change (no --read-only; a SET that keeps every node
# and relationship count) and records no transcript. So
# `node scripts/docs-evals.ts --dry-run` must report exactly two red
# assertions, both in read-only-answer under `none`: store-unchanged (the
# store's content differs from the setup's) and opened-read-only (no relate
# command named team.rl), and exit 1.
if [ "${DOCS_EVALS_CONDITION:-}" = none ]; then export DOCS_EVALS_FIXTURE_BREAK=read-only-answer; fi
exec bash "$(dirname "$0")/pass.sh"
