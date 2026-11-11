#!/usr/bin/env bash
# Pulls the release-discovery files from upstream's release assets into public/
# (ADR-0546, upstream): the site's deploys run this before the build, so a
# release goes live without a pull request or a human in the path.
#
#   public/install.sh              the newest stable core release (vX.Y.Z)'s
#   public/releases.json           install.sh and releases.json assets
#   public/extensions.json         the signed pair on the newest stable extension
#   public/extensions.json.sig     release (tags relate-extensions-*)
#
# Newest means by publication date, never by the tag a dispatch named, so a
# backfill that re-attaches files to an old release cannot move the site back.
# The checked-in copies are the seed for local work and for the time before
# the first release; a deploy overwrites them.
#
#   bash scripts/fetch-discovery.sh                  # all four files
#   bash scripts/fetch-discovery.sh --repo OWNER/NAME --dest public
#
# What it does when something is missing:
#   - no stable core release yet            -> keep the seed files, say so (exit 0)
#   - no extension release carries the pair -> keep the seed pair, say so (exit 0)
#   - a release exists but lacks its files, a file is not valid JSON, releases.json
#     does not list that release as latest, install.sh pins no SIGNING_KEY, or the
#     extensions.json signature does not verify (SSHSIG namespace relate-release,
#     key pinned in install.sh) -> fail (exit 1) and touch nothing. A failed
#     deploy leaves the live site as it was; the next dispatch retries.
# Files are written only after every check passes.
#
# Needs gh (GH_TOKEN, any token that can read the public upstream releases), node
# and ssh-keygen. Honours $RELATE_UPSTREAM_REPO (default relatedb/relate) and
# writes a summary to $GITHUB_STEP_SUMMARY when set.
set -euo pipefail
export LC_ALL=C

repo="${RELATE_UPSTREAM_REPO:-relatedb/relate}"
dest=public
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) repo="${2:?--repo needs OWNER/NAME}"; shift 2 ;;
    --dest) dest="${2:?--dest needs a directory}"; shift 2 ;;
    -h | --help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) echo "fetch-discovery: unknown option $1 (see --help)" >&2; exit 2 ;;
  esac
done
for tool in gh node ssh-keygen; do
  command -v "$tool" >/dev/null 2>&1 || { echo "fetch-discovery: $tool is required" >&2; exit 2; }
done

cd "$(dirname "${BASH_SOURCE[0]}")/.."
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/fetch-discovery.XXXXXX")"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/core" "$work/ext" "$dest"

lines=()
log() { echo "fetch-discovery: $*" >&2; lines+=("$*"); }
fail() { log "FAILED: $*"; summary; exit 1; }
summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    { echo "### Release-discovery files"; echo; printf -- '- %s\n' "${lines[@]}"; } >>"$GITHUB_STEP_SUMMARY"
  fi
}

# Newest published, non-draft, non-prerelease release whose tag matches $1, with
# the asset names it must carry ($2...). Prints the tag, or nothing.
newest() { # TAG_REGEX ASSET...
  local re="$1"
  shift
  local list
  list="$(gh release list -R "$repo" --limit 100 --json tagName,isDraft,isPrerelease,publishedAt \
    -q "[.[] | select((.isDraft|not) and (.isPrerelease|not) and (.tagName|test(\"$re\")))] | sort_by(.publishedAt) | reverse | .[].tagName")" ||
    fail "could not list the releases of $repo (is GH_TOKEN set?)"
  printf '%s\n' "$list" | sed '/^$/d'
}
has_assets() { # TAG ASSET...
  local tag="$1" names
  shift
  names="$(gh release view "$tag" -R "$repo" --json assets -q '.assets[].name')" || return 1
  local a
  for a in "$@"; do printf '%s\n' "$names" | grep -qx "$a" || return 1; done
}
json_ok() { node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$1" 2>/dev/null; }
signing_key() { sed -n "s/^SIGNING_KEY='\(.*\)'$/\1/p" "$1"; }

# ---- core: install.sh + releases.json
core_tag="$(newest '^v[0-9]+\\.[0-9]+\\.[0-9]+$' | head -n 1)"
install_src="$dest/install.sh"
if [ -z "$core_tag" ]; then
  log "no stable core release yet: install.sh and releases.json left as checked in"
else
  has_assets "$core_tag" install.sh releases.json ||
    fail "$core_tag is the newest core release but has no install.sh and releases.json assets (has upstream's publish-releases-json job run?)"
  gh release download "$core_tag" -R "$repo" --pattern install.sh --pattern releases.json --dir "$work/core" --clobber >/dev/null ||
    fail "could not download install.sh and releases.json from $core_tag"
  json_ok "$work/core/releases.json" || fail "releases.json from $core_tag is not JSON"
  latest="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).latest?.tag ?? "")' "$work/core/releases.json")"
  [ "$latest" = "$core_tag" ] || fail "releases.json on $core_tag lists '$latest' as latest"
  [ -n "$(signing_key "$work/core/install.sh")" ] || fail "install.sh from $core_tag pins no SIGNING_KEY"
  install_src="$work/core/install.sh"
  log "core: install.sh and releases.json from $core_tag"
fi

# ---- extensions: the signed pair
ext_tag=""
ext_tags="$(newest '^relate-extensions-')"
for t in $ext_tags; do
  if has_assets "$t" extensions.json extensions.json.sig; then ext_tag="$t"; break; fi
done
if [ -z "$ext_tag" ]; then
  log "no extension release carries extensions.json + extensions.json.sig: left as checked in"
else
  gh release download "$ext_tag" -R "$repo" --pattern extensions.json --pattern extensions.json.sig --dir "$work/ext" --clobber >/dev/null ||
    fail "could not download the extensions pair from $ext_tag"
  json_ok "$work/ext/extensions.json" || fail "extensions.json from $ext_tag is not JSON"
  key="$(signing_key "$install_src")"
  [ -n "$key" ] || fail "no pinned SIGNING_KEY in install.sh to verify extensions.json against"
  printf 'relate-release %s\n' "$key" >"$work/allowed_signers"
  ssh-keygen -Y verify -f "$work/allowed_signers" -I relate-release -n relate-release \
    -s "$work/ext/extensions.json.sig" <"$work/ext/extensions.json" >/dev/null 2>&1 ||
    fail "extensions.json.sig from $ext_tag does not verify against the pinned release key (namespace relate-release)"
  log "extensions: signed pair from $ext_tag, signature verified"
fi

# ---- write, only now
[ -z "$core_tag" ] || cp "$work/core/install.sh" "$work/core/releases.json" "$dest/"
[ -z "$ext_tag" ] || cp "$work/ext/extensions.json" "$work/ext/extensions.json.sig" "$dest/"
summary
