#!/usr/bin/env bash
# Installs the Vale release docs:lint is pinned to, checked against the SHA-256
# the Vale project publishes for it (vale_<version>_checksums.txt on the
# release), so a laptop lints with the same binary CI does. CI runs this script
# too (.github/workflows/cookbook.yml).
#
#   bash scripts/vale/install.sh               installs into ~/.local/bin
#   bash scripts/vale/install.sh --dir <dir>   installs into <dir>
#
# macOS and Linux, on amd64 or arm64. Prints the directory to put on PATH when
# it is not there yet. Needs curl, tar and shasum or sha256sum.
set -euo pipefail

VALE_VERSION='3.25.1'
# From https://github.com/vale-cli/vale/releases/download/v3.25.1/vale_3.25.1_checksums.txt
SHA_Linux_64_bit='4bf5c5176b682b1da0830f471584d3494f1c2e27ee3029e1ad6f6661d4962182'
SHA_Linux_arm64='2a69755b68118c612c455fc0c5ea1b9438519aa1c852e3fb303b3ad97141bbb0'
SHA_macOS_64_bit='e27097e84a812d45546de8d6a4ffa75538cab39c96f79b153b601240f8cefaf9'
SHA_macOS_arm64='fbcaa68d9b9e229b9c8dc918f209e93572ce943039700b7e04a423ff12f684cd'

dir="$HOME/.local/bin"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) dir="${2:?--dir needs a directory}"; shift 2 ;;
    -h | --help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "vale/install.sh: unknown option $1" >&2; exit 2 ;;
  esac
done

case "$(uname -s)" in
  Linux) os=Linux ;;
  Darwin) os=macOS ;;
  *) echo "vale/install.sh: no pinned Vale build for $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=64-bit ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "vale/install.sh: no pinned Vale build for $(uname -m)" >&2; exit 1 ;;
esac
var="SHA_${os}_${arch//-/_}"
want="${!var}"
tarball="vale_${VALE_VERSION}_${os}_${arch}.tar.gz"

if command -v vale >/dev/null 2>&1 && [ "$(vale --version 2>/dev/null)" = "vale version $VALE_VERSION" ] && [ "$(command -v vale)" = "$dir/vale" ]; then
  echo "vale $VALE_VERSION is already installed at $dir/vale"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -sSfL -o "$tmp/$tarball" "https://github.com/vale-cli/vale/releases/download/v${VALE_VERSION}/${tarball}"
if command -v sha256sum >/dev/null 2>&1; then
  got="$(sha256sum "$tmp/$tarball" | cut -d' ' -f1)"
else
  got="$(shasum -a 256 "$tmp/$tarball" | cut -d' ' -f1)"
fi
if [ "$got" != "$want" ]; then
  echo "vale/install.sh: $tarball has SHA-256 $got, not the pinned $want; installing nothing" >&2
  exit 1
fi
tar -xzf "$tmp/$tarball" -C "$tmp" vale
mkdir -p "$dir"
install -m 0755 "$tmp/vale" "$dir/vale"
echo "installed $("$dir/vale" --version) at $dir/vale"
case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "put $dir on PATH: export PATH=\"$dir:\$PATH\"" ;;
esac
