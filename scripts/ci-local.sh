#!/usr/bin/env bash
# Runs the required check (.github/workflows/cookbook.yml) on this machine, in
# the same order, so a branch that passes here passes there: the unit tests,
# adr:check, docs:check, docs:lint (Vale), cookbook:check, the type checks,
# the build, docs:check --built, the docs MCP Worker's bundle and type check,
# and cookbook:browser.
#
#   npm run ci                        the whole required check
#   npm run ci -- --no-browser        everything but the headless Chrome run
#   npm run ci -- --cli               also docs:cli-check against $RELATE_BIN
#                                     (or `relate` on PATH): docs-cli-check.yml
#   npm run ci -- --agent-endpoints   also docs:mcp-check and
#                                     docs:negotiation-check: docs-mcp.yml
#   npm run ci -- --from <step>       start at a step (its name as printed)
#
# Needs what CI installs: `npm ci`, `npm ci --prefix playground`, `npm ci
# --prefix workers/docs-mcp`, Vale 3.25.1 (bash scripts/vale/install.sh), and
# Chrome for cookbook:browser (CHROME_PATH). It never commits or records:
# a failing step prints its output and the run stops there, with the step to
# resume from.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here/.."

browser=1
cli=0
endpoints=0
from=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-browser) browser=0; shift ;;
    --cli) cli=1; shift ;;
    --agent-endpoints) endpoints=1; shift ;;
    --from) from="${2:?--from needs a step name}"; shift 2 ;;
    -h | --help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "ci-local: unknown option $1 (see --help)" >&2; exit 2 ;;
  esac
done

# CI sets CI=true; scripts that soften a missing tool off CI do not here.
export CI="${CI:-true}"
export DO_NOT_TRACK=1

steps=(
  "unit-tests|npm run cookbook:test && npm run docs:test && npm test --prefix workers/docs-mcp"
  "adr-check|npm run adr:check"
  "docs-check|npm run docs:check"
  "docs-lint|npm run docs:lint"
  "cookbook-check|npm run cookbook:check"
  "type-check|npm run check"
  "type-check-playground|npm run check:playground"
  "build|npm run build"
  "docs-check-built|npm run docs:check -- --built"
  "mcp-bundle|npm run bundle --prefix workers/docs-mcp"
  "mcp-type-check|npm run check --prefix workers/docs-mcp"
)
if [ "$browser" = 1 ]; then steps+=("browser|npm run cookbook:browser"); fi
if [ "$endpoints" = 1 ]; then
  steps+=("mcp-check|npm run docs:mcp-check")
  steps+=("negotiation-check|npm run docs:negotiation-check")
fi
if [ "$cli" = 1 ]; then steps+=("cli-check|npm run docs:cli-check"); fi

started=$([ -z "$from" ] && echo 1 || echo 0)
t0=$SECONDS
for entry in "${steps[@]}"; do
  name="${entry%%|*}"
  cmd="${entry#*|}"
  if [ "$started" = 0 ]; then
    [ "$name" = "$from" ] && started=1 || continue
  fi
  echo
  echo "=== ci-local: $name: $cmd"
  t=$SECONDS
  if ! bash -c "$cmd"; then
    echo
    echo "ci-local: FAILED at $name after $((SECONDS - t))s; resume with: npm run ci -- --from $name" >&2
    exit 1
  fi
  echo "=== ci-local: $name ok ($((SECONDS - t))s)"
done
if [ "$started" = 0 ]; then
  echo "ci-local: no step is named '$from'" >&2
  exit 2
fi
echo
echo "ci-local: every step passed ($((SECONDS - t0))s)"
