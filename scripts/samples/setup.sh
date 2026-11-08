#!/usr/bin/env bash
# Builds the relate Python and Node clients from an upstream relate checkout,
# outside this repository, for the docs' verified samples
# (npm run docs:samples; the contract is in src/lib/docs/samples.ts).
# macOS and Linux.
#
#   bash scripts/samples/setup.sh --upstream <path to the relate checkout>
#   source "${XDG_CACHE_HOME:-$HOME/.cache}/relate-web-samples/env.sh"
#   npm run docs:samples
#
# What it builds, under --out (default ${XDG_CACHE_HOME:-$HOME/.cache}/relate-web-samples):
#   py/                        a venv with relate-db installed from a wheel that
#                              maturin builds from surfaces/relate-python
#                              (not editable, so nothing is written into the checkout)
#   wheels/                    that wheel
#   node/node_modules/@relate/relate
#                              a copy of clients/javascript with its one
#                              dependency (koffi) installed; the unpublished
#                              platform packages are omitted, so the client
#                              finds the native library through RELATE_LIB
#   env.sh                     the variables docs:samples reads
# and the FFI library with `cargo build -p relate-ffi --release` in the
# checkout's own target directory (or CARGO_TARGET_DIR).
#
# Options:
#   --upstream DIR   the relate checkout (default: $RELATE_UPSTREAM, else ../relate
#                    beside this repository)
#   --out DIR        where to build (default above)
#   --python BIN     the Python to make the venv with (default python3; needs 3.9+)
#   --skip-python, --skip-node   build one client only
#   --github-env     also append the variables to $GITHUB_ENV (GitHub Actions)
#
# Needs: the Rust toolchain the checkout pins (rust-toolchain.toml), Python 3.9+
# with venv, Node 18+ and npm. The first build compiles the engine twice (the
# Python extension and the FFI library) and takes several minutes.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"

upstream="${RELATE_UPSTREAM:-}"
out="${XDG_CACHE_HOME:-$HOME/.cache}/relate-web-samples"
python_bin=python3
do_python=1
do_node=1
github_env=0

die() { echo "setup.sh: $*" >&2; exit 1; }
say() { echo "setup.sh: $*" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --upstream) upstream="${2:?--upstream needs a directory}"; shift 2 ;;
    --out) out="${2:?--out needs a directory}"; shift 2 ;;
    --python) python_bin="${2:?--python needs a binary}"; shift 2 ;;
    --skip-python) do_python=0; shift ;;
    --skip-node) do_node=0; shift ;;
    --github-env) github_env=1; shift ;;
    -h | --help) awk 'NR > 1 && /^#/ { if ($0 ~ /shellcheck/) next; sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

if [ -z "$upstream" ] && [ -d "$repo/../relate/surfaces/relate-python" ]; then
  upstream="$repo/../relate"
fi
[ -n "$upstream" ] || die "no upstream checkout: pass --upstream <path to the relate checkout> or set RELATE_UPSTREAM"
upstream="$(cd "$upstream" && pwd)"
[ -f "$upstream/surfaces/relate-python/Cargo.toml" ] || die "$upstream has no surfaces/relate-python/Cargo.toml; is it a relate checkout?"
[ -f "$upstream/clients/javascript/package.json" ] || die "$upstream has no clients/javascript/package.json; is it a relate checkout?"
case "$out" in
  "$repo" | "$repo"/*) die "--out must be outside this repository ($out)" ;;
esac
mkdir -p "$out"
out="$(cd "$out" && pwd)"

command -v cargo >/dev/null 2>&1 || die "cargo is required (https://rustup.rs); the checkout pins its toolchain in rust-toolchain.toml"

case "$(uname -s)" in
  Darwin) lib_name=librelate_ffi.dylib ;;
  Linux) lib_name=librelate_ffi.so ;;
  *) die "unsupported OS $(uname -s): macOS and Linux only" ;;
esac
target_dir="${CARGO_TARGET_DIR:-$upstream/target}"
export DO_NOT_TRACK=1

py="$out/py/bin/python"
if [ "$do_python" = 1 ]; then
  command -v "$python_bin" >/dev/null 2>&1 || die "$python_bin not found (pass --python)"
  "$python_bin" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' ||
    die "$python_bin is older than 3.9 (relate-db requires-python >=3.9)"
  say "Python: venv at $out/py"
  [ -x "$py" ] || "$python_bin" -m venv "$out/py"
  "$py" -m pip install --quiet --disable-pip-version-check 'maturin>=1,<2'
  say "Python: building relate-db with maturin (release)"
  rm -rf "$out/wheels"
  # From inside the checkout, so rustup picks the toolchain its rust-toolchain.toml pins.
  (cd "$upstream" && "$out/py/bin/maturin" build --release --interpreter "$py" \
    -m surfaces/relate-python/Cargo.toml -o "$out/wheels")
  wheels=("$out"/wheels/relate_db-*.whl)
  wheel="${wheels[0]}"
  [ -f "$wheel" ] || die "maturin produced no wheel in $out/wheels"
  "$py" -m pip install --quiet --disable-pip-version-check --force-reinstall --no-deps "$wheel"
  (cd "$out" && PYTHONDONTWRITEBYTECODE=1 "$py" -c 'import importlib.metadata as m, relate; print("setup.sh: Python: relate-db", m.version("relate-db"))') >&2
fi

lib=""
node_modules="$out/node/node_modules"
if [ "$do_node" = 1 ]; then
  command -v node >/dev/null 2>&1 || die "node is required (18+)"
  command -v npm >/dev/null 2>&1 || die "npm is required"
  say "Node: building the FFI library (cargo build -p relate-ffi --release)"
  (cd "$upstream" && cargo build --release -p relate-ffi)
  lib="$target_dir/release/$lib_name"
  [ -f "$lib" ] || die "the FFI build produced no $lib"
  say "Node: copying clients/javascript to $node_modules/@relate/relate"
  rm -rf "$out/node"
  mkdir -p "$node_modules/@relate"
  cp -R "$upstream/clients/javascript" "$node_modules/@relate/relate"
  rm -rf "$node_modules/@relate/relate/node_modules"
  # `npm install`, as upstream CI does: the lockfile does not list the
  # platform packages, which are not published before launch, so `npm ci`
  # refuses it; --omit=optional leaves them out.
  (cd "$node_modules/@relate/relate" && npm install --omit=optional --no-audit --no-fund --loglevel=error)
  (cd "$out" && NODE_PATH="$node_modules" RELATE_LIB="$lib" node -e \
    'const p=require("@relate/relate/package.json"); const {Database}=require("@relate/relate"); Database.open(":memory:").connect().query("RETURN 1 AS x"); console.error("setup.sh: Node: @relate/relate " + p.version)')
fi

{
  echo "# Written by scripts/samples/setup.sh from $upstream"
  [ "$do_python" = 1 ] && echo "export RELATE_PY='$py'"
  if [ "$do_node" = 1 ]; then
    echo "export RELATE_NODE='$(command -v node)'"
    echo "export NODE_PATH='$node_modules'"
    echo "export RELATE_LIB='$lib'"
  fi
  echo "export DO_NOT_TRACK=1"
} >"$out/env.sh"

if [ "$github_env" = 1 ]; then
  [ -n "${GITHUB_ENV:-}" ] || die "--github-env: GITHUB_ENV is not set"
  sed -n 's/^export \([A-Z_]*\)=.\(.*\).$/\1=\2/p' "$out/env.sh" >>"$GITHUB_ENV"
fi

say "done. To use the clients:"
echo "source '$out/env.sh'"
