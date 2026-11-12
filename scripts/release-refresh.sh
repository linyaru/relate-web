#!/usr/bin/env bash
# shellcheck disable=SC2329 # the step functions are called through `step NAME FUNCTION`
# Refreshes the site from a relate release: the deterministic release signal
# of DOCS-PLAN.md §6. Run by .github/workflows/engine-release.yml, which opens
# a pull request with the result; it never commits, and it runs the same way
# on a laptop (with `gh` signed in).
#
#   bash scripts/release-refresh.sh --version 0.17.0
#   bash scripts/release-refresh.sh --version 0.17.0 --report /tmp/report.md
#
# In order, each step recorded in the report:
#   1. reads the release (gh release view): it must be published and stable
#   2. the synced files, byte for byte, never edited here (CLAUDE.md):
#        public/install.sh      by scripts/fetch-discovery.sh (the deploys run it
#        public/releases.json   too, so these reach the live site with no
#        public/extensions.json review): upstream's release assets (ADR-0546),
#        public/extensions.json.sig   the newest stable core and extension releases
#      releases.json must list the release as latest; extensions.json must
#      verify against the release signing key pinned in install.sh
#      (SSHSIG namespace relate-release)
#   3. installs the release's binary for this machine with that install.sh
#      (which verifies SHA256SUMS.sig and the checksum) into a temporary HOME,
#      and checks `relate --version` names the release
#   4. public/wasm/ from the release's @relate/relate-wasm package
#      (asset relate-relate-wasm-<version>.tgz, else npm), the files CLAUDE.md lists
#   5. src/content/docs/_data/engine.json: version, verified, date (the
#      release's publication date, UTC) and commit (the tag's), merged into
#      the file by scripts/engine-bump.ts so its recorded runs survive;
#      source_build is dropped
#   6. the skill bundle: with an upstream checkout at the tag (--upstream),
#      `npm run skill:sync -- --upstream <dir>` publishes it to public/skills/
#      and records the commit; without one, the verified binary's embedded
#      bundle (`relate skill install --agent claude-code` into a temporary
#      HOME) is compared with public/skills/relate/ and a difference fails
#      the step
#   7. `npm run docs:cli-check -- --record` against the binary (RELATE_BIN, and
#      first on PATH), when that script exists
#   8. `npm run cookbook:record`, then `npm run docs:check -- --record` and
#      `npm run docs:check`
#      (with DOCS_CHANGELOG_PENDING=<version>: the release's changelog entry
#      is a `todo` row for the reviewer, not a failure)
#   9. `npm run docs:samples -- --record --require` when RELATE_PY or
#      RELATE_NODE is set (scripts/samples/setup.sh); otherwise skipped, or
#      failed when RELATE_CLIENTS_BUILD (the workflow's client-build outcome)
#      says the build failed
# Every step after 3 runs even when an earlier one failed, so the pull request
# shows everything at once; the exit status is 1 when any step failed, and
# the report says which. A `todo` row (the changelog entry) is work for the
# reviewer, not a failure.
#
# Options:
#   --version X.Y.Z    the release (required; a leading v is accepted)
#   --tag TAG          its tag (default vX.Y.Z)
#   --repo OWNER/NAME  the upstream repository (default $RELATE_UPSTREAM_REPO, else relatedb/relate)
#   --report FILE      write the pull request body (markdown) here
#   --work DIR         scratch directory (default: a new temporary directory)
#   --upstream DIR     an upstream checkout at the tag, for skill:sync
#                      (default $RELATE_UPSTREAM; optional)
#
# Needs gh (GH_TOKEN, or `gh auth login`; the upstream repository is public),
# node and npm (after `npm ci`), curl, tar, ssh-keygen.
# When GITHUB_OUTPUT is set, writes ok=true|false, version and tag to it.
set -euo pipefail
export LC_ALL=C DO_NOT_TRACK=1

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"
cd "$repo_root"

version=""
tag=""
upstream_repo="${RELATE_UPSTREAM_REPO:-relatedb/relate}"
report=""
work=""
upstream_dir="${RELATE_UPSTREAM:-}"

die() { echo "release-refresh: $*" >&2; exit 1; }
say() { echo "release-refresh: $*" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --version) version="${2:?--version needs X.Y.Z}"; shift 2 ;;
    --tag) tag="${2:?--tag needs a tag}"; shift 2 ;;
    --repo) upstream_repo="${2:?--repo needs OWNER/NAME}"; shift 2 ;;
    --report) report="${2:?--report needs a file}"; shift 2 ;;
    --work) work="${2:?--work needs a directory}"; shift 2 ;;
    --upstream) upstream_dir="${2:?--upstream needs a directory}"; shift 2 ;;
    -h | --help) awk 'NR > 1 && /^#/ { if ($0 ~ /shellcheck/) next; sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

version="${version#v}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--version takes X.Y.Z (a stable release), not '${version}'"
tag="${tag:-v$version}"
if [ -n "$upstream_dir" ]; then
  [ -e "$upstream_dir/.git" ] || die "--upstream $upstream_dir is not a git checkout"
  upstream_dir="$(cd "$upstream_dir" && pwd)"
fi
for tool in gh node npm curl tar ssh-keygen; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is required"
done
export GITHUB_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [ -z "$work" ]; then
  work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/release-refresh.XXXXXX")"
fi
mkdir -p "$work"

# ---------------------------------------------------------------------------
# Step bookkeeping: one row per step for the report.

rows=()
failed=0
record() { # status step detail
  rows+=("$1|$2|$3")
  if [ "$1" = failed ]; then failed=1; fi
  say "$1: $2${3:+ ($3)}"
}
# step NAME FUNCTION: runs FUNCTION; its last line of output on fd 3 is the detail.
step() {
  local name="$1" fn="$2" detail_file="$work/.detail"
  : >"$detail_file"
  if "$fn" 3>"$detail_file"; then
    record ok "$name" "$(tail -n 1 "$detail_file")"
  else
    record failed "$name" "$(tail -n 1 "$detail_file")"
  fi
}
note() { echo "$*" >&3; }
has_script() { node -e 'process.exit(require("./package.json").scripts?.[process.argv[1]] ? 0 : 1)' "$1"; }
# The line of a log that says why it failed: the last one naming an error, else the last line.
why() { { grep -E '(^|[^A-Za-z])([Ee]rror|ERR!|FAIL)' "$1" || tail -n 1 "$1"; } | tail -n 1 | cut -c1-300; }

# ---------------------------------------------------------------------------
# 1. The release

say "reading $upstream_repo $tag"
gh release view "$tag" -R "$upstream_repo" --json tagName,publishedAt,isDraft,isPrerelease,url,assets >"$work/release.json" ||
  die "gh release view $tag -R $upstream_repo failed (is GH_TOKEN set?)"
read -r rel_draft rel_pre rel_date rel_url < <(node -e '
  const r = require(process.argv[1]);
  console.log([r.isDraft, r.isPrerelease, (r.publishedAt || "").slice(0, 10) || "-", r.url].join(" "));
' "$work/release.json")
[ "$rel_draft" = false ] || die "$tag is a draft release"
[ "$rel_pre" = false ] || die "$tag is a prerelease; the docs track stable releases"
[ "$rel_date" != - ] || die "$tag has no publication date"
asset_names() { node -e 'for (const a of require(process.argv[1]).assets) console.log(a.name)' "$work/release.json"; }
record ok "Release $tag" "published $rel_date"

# ---------------------------------------------------------------------------
# 2. The synced files

raw() { # PATH REF OUT
  gh api -H 'Accept: application/vnd.github.raw+json' "repos/$upstream_repo/contents/$1?ref=$2" >"$3"
}
signing_key() { sed -n "s/^SIGNING_KEY='\(.*\)'$/\1/p" "$1"; }

# The same script the deploys run (scripts/fetch-discovery.sh): the newest
# stable core release's assets and the newest extension release's signed pair,
# verified. The deploys publish them with no review; they are copied here only
# so the steps below (the binary install, the CLI recordings) read the same files.
sync_discovery() {
  GH_TOKEN="${GH_TOKEN:-}" RELATE_UPSTREAM_REPO="$upstream_repo" bash scripts/fetch-discovery.sh >"$work/fetch-discovery.log" 2>&1 ||
    { tail -n 5 "$work/fetch-discovery.log" >&2; note "$(tail -n 1 "$work/fetch-discovery.log")"; return 1; }
  local latest
  latest="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("public/releases.json", "utf8")).latest?.tag ?? "")')"
  [ "$latest" = "$tag" ] || { note "releases.json lists $latest as latest, not $tag (is $tag the newest core release?)"; return 1; }
  note "$(grep -c . "$work/fetch-discovery.log") lines; releases.json lists $tag as latest"
}
step "install.sh, releases.json, extensions.json (+ .sig)" sync_discovery

# ---------------------------------------------------------------------------
# 3. The binary, through install.sh

bin=""
install_binary() {
  local home="$work/home"
  mkdir -p "$home"
  HOME="$home" sh public/install.sh >"$work/install.log" 2>&1 || { tail -n 5 "$work/install.log" >&2; note "$(tail -n 1 "$work/install.log")"; return 1; }
  local got
  got="$("$home/.local/bin/relate" --version | head -n 1)"
  case "$got" in
    *"v$version") ;;
    *) note "install.sh installed '$got', not v$version (it installs the latest release; is $tag the latest?)"; return 1 ;;
  esac
  bin="$home/.local/bin/relate"
  note "$got, signature and checksum verified by install.sh"
}
step "relate binary (install.sh)" install_binary

# ---------------------------------------------------------------------------
# 4. public/wasm

WASM_FILES=(relate.js relate.d.ts relate_bg.wasm relate_bg.wasm.d.ts opfs.js trap.js)
refresh_wasm() {
  local asset="relate-relate-wasm-$version.tgz" dl="$work/wasm-download" pkg="$work/wasm-package" source
  rm -rf "$dl" "$pkg"
  mkdir -p "$dl" "$pkg"
  if asset_names | grep -qx "$asset"; then
    gh release download "$tag" -R "$upstream_repo" --pattern "$asset" --dir "$dl" || { note "could not download $asset"; return 1; }
    source="release asset $asset"
  elif (cd "$dl" && npm pack "@relate/relate-wasm@$version" --silent >/dev/null 2>&1); then
    source="npm @relate/relate-wasm@$version"
  else
    note "$tag has no $asset asset and npm has no @relate/relate-wasm@$version"
    return 1
  fi
  tar -xzf "$dl"/*.tgz -C "$pkg" --no-same-owner || { note "could not unpack the package"; return 1; }
  local got
  got="$(node -e 'console.log(require(process.argv[1]).version)' "$pkg/package/package.json")"
  [ "$got" = "$version" ] || { note "the package is version $got, not $version"; return 1; }
  local f
  for f in "${WASM_FILES[@]}"; do
    [ -f "$pkg/package/$f" ] || { note "the package has no $f"; return 1; }
  done
  [ -d "$pkg/package/snippets" ] || { note "the package has no snippets/"; return 1; }
  for f in "${WASM_FILES[@]}"; do cp "$pkg/package/$f" "public/wasm/$f" || return 1; done
  rm -rf public/wasm/snippets
  cp -R "$pkg/package/snippets" public/wasm/snippets || return 1
  note "$source"
}
step "public/wasm/" refresh_wasm

# ---------------------------------------------------------------------------
# 5. engine.json (before the skill, which skill:sync stamps with its version)

write_engine() {
  # Merged, never replaced: the recorded runs in engine.json are read by the
  # build and re-recorded by step 7 (src/lib/docs/release.ts).
  local commit
  commit="$(gh api "repos/$upstream_repo/commits/$tag" --jq '.sha[0:7]' 2>/dev/null || true)"
  node scripts/engine-bump.ts --version "$version" --date "$rel_date" ${commit:+--commit "$commit"} >"$work/engine-bump.log" 2>&1 ||
    { cat "$work/engine-bump.log" >&2; note "failed: $(why "$work/engine-bump.log")"; return 1; }
  if [ -n "$commit" ]; then
    note "version and verified $version, date $rel_date, commit $commit"
  else
    note "version and verified $version, date $rel_date; no commit (could not read the commit of $tag)"
  fi
}
step "_data/engine.json" write_engine

# ---------------------------------------------------------------------------
# 6. The skill bundle

sync_skill() {
  if [ -n "$upstream_dir" ]; then
    has_script skill:sync || { note "package.json has no skill:sync script"; return 1; }
    local head
    head="$(git -C "$upstream_dir" describe --tags --exact-match 2>/dev/null || git -C "$upstream_dir" rev-parse --short HEAD)"
    npm run --silent skill:sync -- --upstream "$upstream_dir" >"$work/skill-sync.log" 2>&1 ||
      { tail -n 20 "$work/skill-sync.log" >&2; note "skill:sync failed: $(why "$work/skill-sync.log")"; return 1; }
    note "skill:sync from the upstream checkout at $head; $( (git diff --shortstat -- public/skills 2>/dev/null || true) | sed 's/^ //')"
    return 0
  fi
  # No checkout: the verified binary embeds the same bundle, stamped with the
  # release's version. It shows whether the published copy is current, but
  # skill:sync records an upstream commit, so it is not published from here.
  [ -n "$bin" ] || { note "no upstream checkout (--upstream) and no verified binary: the skill bundle was not checked"; return 1; }
  local home="$work/skill-home" bundle="$work/skill-home/.claude/skills/relate"
  rm -rf "$home"
  mkdir -p "$home"
  HOME="$home" "$bin" skill install --agent claude-code >/dev/null || { note "relate skill install failed"; return 1; }
  rm -f "$bundle/.relate-installed"
  grep -qx "version: $version" "$bundle/SKILL.md" || { note "the binary's SKILL.md does not say version: $version"; return 1; }
  if diff -r "$bundle" public/skills/relate >"$work/skill.diff" 2>&1; then
    note "no upstream checkout; the release binary's bundle equals public/skills/relate/"
  else
    note "no upstream checkout, and the release binary's bundle differs from public/skills/relate/ ($(grep -c '^diff\|^Only in' "$work/skill.diff") file(s)): run skill:sync -- --upstream <checkout at $tag>"
    return 1
  fi
}
step "skill bundle" sync_skill

# ---------------------------------------------------------------------------
# 7–9. Recordings and checks

cli_check() {
  has_script docs:cli-check || { note "package.json has no docs:cli-check script; CLI recordings not regenerated"; return 1; }
  [ -n "$bin" ] || { note "no verified binary (step 3 failed)"; return 1; }
  RELATE_BIN="$bin" PATH="$(dirname "$bin"):$PATH" npm run --silent docs:cli-check -- --record >"$work/cli-check.log" 2>&1 ||
    { tail -n 20 "$work/cli-check.log" >&2; note "failed: $(why "$work/cli-check.log")"; return 1; }
  note "recorded against $("$bin" --version | head -n 1)"
}
step "docs:cli-check --record" cli_check

npm_step() { # LOG ARGS...
  local log="$work/$1.log"
  shift
  npm run --silent "$@" >"$log" 2>&1 || { tail -n 30 "$log" >&2; note "failed: $(why "$log")"; return 1; }
  note "$(tail -n 1 "$log")"
}
cookbook_record() { npm_step cookbook-record cookbook:record; }
docs_record() { npm_step docs-record docs:check -- --record; }
docs_check() { npm_step docs-check docs:check; }
# The refresh never writes release notes, so the changelog entry for the
# release is the one docs:check failure it expects: DOCS_CHANGELOG_PENDING
# turns exactly that error into a warning (src/lib/docs/generated/changelog.ts)
# and the entry is a `todo` row below, not a failure. CI never sets it, so the
# pull request cannot merge until the entry is written.
export DOCS_CHANGELOG_PENDING="$version"
step "cookbook:record" cookbook_record
step "docs:check --record" docs_record
step "docs:check" docs_check
if node -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.exit((c.releases ?? []).some((r) => r.version === process.argv[2]) ? 0 : 1);
' src/content/docs/_data/changelog.json "$version" 2>/dev/null; then
  record ok "changelog entry" "src/content/docs/_data/changelog.json has $version"
else
  record todo "changelog entry" "write the $version entry in src/content/docs/_data/changelog.json from the release notes; docs:check warns until then, and the required check fails"
fi

samples() {
  if [ -z "${RELATE_PY:-}" ] && [ -z "${RELATE_NODE:-}" ]; then
    case "${RELATE_CLIENTS_BUILD:-}" in
      "" | success | skipped)
        note "skipped: no client built (RELATE_PY, RELATE_NODE; scripts/samples/setup.sh needs the upstream checkout)"
        return 0 ;;
      *)
        note "not run: building the clients failed (the workflow's 'Build the clients' step: ${RELATE_CLIENTS_BUILD}); see its log"
        return 1 ;;
    esac
  fi
  local args=(--record)
  if [ -n "${RELATE_PY:-}" ] && [ -n "${RELATE_NODE:-}" ]; then args+=(--require); fi
  npm_step docs-samples docs:samples -- "${args[@]}"
}
if has_script docs:samples; then
  step "docs:samples --record" samples
else
  record skipped "docs:samples --record" "package.json has no docs:samples script"
fi

# ---------------------------------------------------------------------------
# The report (the pull request body)

changed="$( (git status --porcelain -- public src/content scripts 2>/dev/null || true) | wc -l | tr -d ' ')"
skill_stat="$( (git diff --shortstat -- public/skills 2>/dev/null || true) | sed 's/^ //')"
wasm_stat="$( (git diff --stat -- public/wasm 2>/dev/null || true) | tail -n 1 | sed 's/^ //')"
{
  echo "Refreshes the site from relate [$tag]($rel_url), published $rel_date, by \`scripts/release-refresh.sh\` (DOCS-PLAN.md §6). Generated; nothing here was edited by hand."
  echo
  if [ "$failed" = 1 ]; then
    echo "**At least one step failed**, so this pull request is a draft. The failed steps below say why; the logs are in the workflow run."
    echo
  fi
  echo "| Step | Result | Detail |"
  echo "| --- | --- | --- |"
  for row in "${rows[@]}"; do
    IFS='|' read -r st name detail <<<"$row"
    echo "| $name | $st | ${detail//|/\\|} |"
  done
  echo
  echo "$changed changed or new file(s) under public/, src/content/ and scripts/."
  echo
  echo "## Before merging"
  echo
  echo "- [ ] Review the skill bundle diff under \`public/skills/\` line by line (ADR-0013: the published bundle is reviewed as a diff)${skill_stat:+: $skill_stat}"
  echo "- [ ] Review the CLI recordings and \`_data/cli.json\` (docs:cli-check): every changed flag, message and exit code is a change in the engine, not in the docs"
  echo "- [ ] Review the recorded results: cookbook result blocks, docs \`*.results.json\` (Cypher cells and language samples)"
  echo "- [ ] \`public/wasm/\`: ${wasm_stat:-unchanged}. The cookbook CI job runs every recipe and the playground in a browser on the new engine; read its result"
  echo "- [ ] Write the changelog entry for $tag (\`reference/changelog\`) from the release notes"
  echo "- [ ] Pages that describe changed behavior are updated in this pull request or in an issue linked from it"
} >"$work/report.md"
if [ -n "$report" ]; then cp "$work/report.md" "$report"; fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "ok=$([ "$failed" = 0 ] && echo true || echo false)"
    echo "version=$version"
    echo "tag=$tag"
  } >>"$GITHUB_OUTPUT"
fi

say "report: ${report:-$work/report.md}"
exit "$failed"
