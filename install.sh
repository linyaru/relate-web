#!/bin/sh
# cypherlite installer:
#   curl -sSfL https://neo4j-labs.github.io/cypherlite/install.sh | GITHUB_TOKEN=$(gh auth token) bash
set -eu

REPO=neo4j-labs/cypherlite
ASSET_PREFIX=cypherlite
BIN_NAME=cypherlite
INSTALL_DIR="$HOME/.local/bin"

# Pinned release signing public key (ADR-0115). Verification never fetches the
# key from the release. The signer identity and the SSH signature namespace are
# both `cypherlite-release`; changing either, or this key, requires a new ADR.
SIGNING_KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHgv/GHY5mtv/HopH/J/T7KrTT7eOVFEG2ueT4iRKwbK cypherlite-release'

die() {
	echo "install.sh: $1" >&2
	exit 1
}

case "$(uname -s)" in
Darwin) os=darwin ;;
Linux) os=linux ;;
*)
	die "unsupported OS: $(uname -s). Supported: Darwin, Linux."
	;;
esac

case "$(uname -m)" in
x86_64 | amd64) arch=amd64 ;;
arm64 | aarch64) arch=arm64 ;;
*)
	die "unsupported architecture: $(uname -m). Supported: amd64, arm64."
	;;
esac

command -v curl >/dev/null 2>&1 ||
	die "curl is required. Install it and retry."

command -v ssh-keygen >/dev/null 2>&1 ||
	die "ssh-keygen (openssh-client) is required to verify release signatures; install openssh-client and retry."

tmp=$(mktemp -d)
tmp_out=""
trap 'rm -rf "$tmp"; [ -z "$tmp_out" ] || rm -f "$tmp_out"' EXIT

# curl|sh: no script path on disk, so all state lives in $tmp.
# gh_get is the single place the Authorization header is constructed: the
# bearer token is sent only when GITHUB_TOKEN is set. $1 is the URL; $2, if
# given, is one extra header (used for the asset-download Accept override).
gh_get() {
	if [ -n "${GITHUB_TOKEN:-}" ]; then
		curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" ${2:+-H "$2"} "$1"
	else
		curl -fsSL ${2:+-H "$2"} "$1"
	fi
}

# Download a release asset by its API asset id, asking for the raw bytes with
# Accept: application/octet-stream. The browser download URL does not honor
# tokens for internal repos (it 404s), and the API endpoint also works
# unauthenticated on public repos, so this single endpoint serves both cases.
download_asset() {
	gh_get "https://api.github.com/repos/$REPO/releases/assets/$1" \
		"Accept: application/octet-stream"
}

# Fragile-but-accepted dependency-free parse of the release JSON from the API.
# Each asset object is serialized with its "url" (ending in
# /releases/assets/<id>) and its "name" on nearby lines, so derive the asset
# id from the most recent asset "url" and print it when the wanted name
# appears. The JSON "id" field is never read.
# A parse that yields nothing is a hard failure for the callers below, never a
# fallback to a guessed URL.
asset_id_for() {
	awk -v want="$1" '
		match($0, /\/releases\/assets\/[0-9]+/) {
			s = substr($0, RSTART, RLENGTH)
			sub(/.*\//, "", s)
			id = s
		}
		match($0, /"name"[[:space:]]*:[[:space:]]*"[^"]*"/) {
			s = substr($0, RSTART, RLENGTH)
			sub(/.*"name"[[:space:]]*:[[:space:]]*"/, "", s)
			sub(/"$/, "", s)
			if (s == want) { print id; exit }
		}
	'
}

# Raw binaries, no archive concatenation: cypherlite publishes
# cypherlite-<os>-<arch>.
asset="${ASSET_PREFIX}-${os}-${arch}"

resolve_fail_msg="could not resolve latest release for $REPO. If the repo is private, set GITHUB_TOKEN (e.g. GITHUB_TOKEN=\$(gh auth token))."

# The repository is internal, so an unauthenticated request 404s. Fetch the
# latest release JSON once: it carries both tag_name and the asset ids.
release_json=$(gh_get "https://api.github.com/repos/$REPO/releases/latest" || true)
[ -n "$release_json" ] ||
	die "$resolve_fail_msg"

tag=$(printf '%s\n' "$release_json" |
	sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
	head -n 1)
[ -n "$tag" ] ||
	die "$resolve_fail_msg"

echo "Installing cypherlite $tag ($os/$arch) to $INSTALL_DIR"

# Resolve the asset ids (binary, manifest, signature) from the release JSON we
# already have, and die on an empty id rather than downloading the wrong thing.
asset_id=$(printf '%s\n' "$release_json" | asset_id_for "$asset")
sums_id=$(printf '%s\n' "$release_json" | asset_id_for SHA256SUMS)
sig_id=$(printf '%s\n' "$release_json" | asset_id_for SHA256SUMS.sig)
[ -n "$asset_id" ] ||
	die "release $tag from $REPO API has no asset named $asset"
[ -n "$sums_id" ] ||
	die "release $tag from $REPO API has no asset named SHA256SUMS"
[ -n "$sig_id" ] ||
	die "release $tag from $REPO API has no asset named SHA256SUMS.sig"
# Cheap first: the manifest and its signature are small; the binary is the
# large download and must not start until the manifest is authenticated.
download_asset "$sums_id" >"$tmp/SHA256SUMS" ||
	die "failed to download SHA256SUMS via API asset $sums_id"
download_asset "$sig_id" >"$tmp/SHA256SUMS.sig" ||
	die "failed to download SHA256SUMS.sig via API asset $sig_id"

# Authenticate the manifest before trusting any checksum it carries (ADR-0115).
# The pinned key is written in the identity form ssh-keygen's allowed_signers
# expects, and SHA256SUMS is fed on stdin. Fail closed: a missing, invalid or
# wrong-key signature installs nothing — and never downloads the binary.
printf 'cypherlite-release %s\n' "$SIGNING_KEY" >"$tmp/allowed_signers"
ssh-keygen -Y verify -f "$tmp/allowed_signers" -I cypherlite-release \
	-n cypherlite-release -s "$tmp/SHA256SUMS.sig" <"$tmp/SHA256SUMS" ||
	die "SHA256SUMS signature verification failed for $tag; installing nothing"

# The manifest is authenticated; only now is the binary download worth
# paying for.
download_asset "$asset_id" >"$tmp/$asset" ||
	die "failed to download $asset via API asset $asset_id"

# SHA256SUMS lines are "<64-hex>  <name>" (shasum -a 256, two spaces, no
# binary-mode asterisk).
expected=$(grep -E "^[0-9a-fA-F]{64}[[:space:]]+\*?${asset}\$" "$tmp/SHA256SUMS" |
	head -n 1 | awk '{print $1}')
[ -n "$expected" ] ||
	die "SHA256SUMS from $tag has no entry for $asset"

printf '%s  %s\n' "$expected" "$asset" | (
	cd "$tmp" &&
		if command -v sha256sum >/dev/null 2>&1; then
			sha256sum -c -
		else
			shasum -a 256 -c -
		fi
) || die "checksum verification failed for $asset; installing nothing"

# Atomic install: stage the verified binary at a temp name inside INSTALL_DIR
# (same filesystem) and rename it into place, so an interrupted install never
# leaves a partial binary at the final path. The EXIT trap removes the temp
# name on failure.
mkdir -p "$INSTALL_DIR"
tmp_out=$(mktemp "$INSTALL_DIR/.$BIN_NAME.XXXXXX")
cp "$tmp/$asset" "$tmp_out"
chmod +x "$tmp_out"
mv "$tmp_out" "$INSTALL_DIR/$BIN_NAME"
tmp_out=""

case ":$PATH:" in
*":$INSTALL_DIR:"*) ;;
*)
	echo "NOTE: $INSTALL_DIR is not in your PATH." >&2
	echo "Add it to your shell profile, e.g.:" >&2
	echo "  export PATH=\"$INSTALL_DIR:\$PATH\"" >&2
	;;
esac

echo "Installed cypherlite $tag at $INSTALL_DIR/$BIN_NAME"
