#!/usr/bin/env bash
# Sets up the relate clients, outside this repository, for the docs' verified
# samples (npm run docs:samples; the contract is in src/lib/docs/samples.ts):
# Python, Node.js, Rust, C, Java, Go and Swift. macOS and Linux (Swift on
# macOS only). The clients a registry publishes are installed from it at the
# release the docs are pinned to (ADR-0062): relate-db from PyPI,
# @relate/relate from npm and the relate crate from crates.io. The rest are
# built from an upstream checkout at that release's tag: the C library, the
# Java jar (com.relate:relate is not on Maven Central), the Go module (it has
# no module tag) and the Swift package's XCFramework.
#
#   bash scripts/samples/setup.sh --upstream <path to the relate checkout>
#   source "${XDG_CACHE_HOME:-$HOME/.cache}/relate-web-samples/env.sh"
#   npm run docs:samples
#
# What it builds, under --out (default ${XDG_CACHE_HOME:-$HOME/.cache}/relate-web-samples):
#   target/                    the cargo target directory of every Rust build
#                              below (CARGO_TARGET_DIR overrides it), so nothing
#                              is written into the checkout
#   py/                        a venv with relate-db==<version> from PyPI, its
#                              pandas extra, and the frameworks the integration
#                              pages' samples import (pinned below)
#   py-crewai/                 a second venv (Python 3.10 to 3.13) with relate-db
#                              and crewai, for samples fenced ```python run env=crewai:
#                              crewai's pins would hold the frameworks in py/ back
#                              (--skip-crewai leaves it out)
#   node/node_modules/@relate/relate
#                              @relate/relate@<version> from npm, with the
#                              platform package that carries its native library
#   node/node_modules/{ai,zod,@mastra/core}
#                              the frameworks the integration pages' samples
#                              import (pinned below)
#   include/relate.h           the C header the library below was built with
#   rust/                      the template project each ```rust run sample is
#                              built from: Cargo.toml (relate = "=<version>"
#                              from crates.io), Cargo.lock (seeded from
#                              the checkout's on every run and checked to lock
#                              nothing it does not), rust-toolchain.toml (the
#                              checkout's), and target/ with the engine compiled
#                              once, so a sample compiles only itself
#   java/                      a copy of clients/java packaged with Maven against
#                              the library below (client/target/relate-<v>.jar),
#                              its Maven repository (m2/) and runtime classpath
#   go/                        GOPATH, GOMODCACHE and GOCACHE for the Go samples,
#                              which build clients/go in the checkout through a
#                              replace directive
#   swift/relate/              a copy of the checkout's Package.swift and
#                              clients/swift with an XCFramework made from the
#                              library below (macOS); swift/scratch/ is the
#                              shared SwiftPM build directory
#   tools/                     the JDK and Maven, when downloaded (see JDK and
#                              MAVEN below; --jdk and --mvn use installed ones)
#   env.sh                     the variables docs:samples reads
# and the FFI library (librelate_ffi) with `cargo build -p relate-ffi --release`.
#
# env.sh sets, for each client it built:
#   RELATE_PY              Python: the interpreter of py/ (can `import relate`)
#   RELATE_PY_CREWAI       Python: the interpreter of py-crewai/ (env=crewai samples)
#   RELATE_NODE            Node.js: the node binary
#   NODE_PATH              Node.js: node/node_modules (holds @relate/relate)
#   RELATE_LIB             the FFI library (Node.js, C, Java, Go and Swift link it)
#   RELATE_CARGO           Rust: the cargo binary (rustup's, so rust-toolchain.toml applies)
#   RELATE_RUST_PROJECT    Rust: the template project rust/
#   RELATE_CC              C: the C compiler
#   RELATE_C_INCLUDE       C and Go: the directory holding relate.h
#   RELATE_JAVA            Java: the java binary (JDK 17+; samples run as single-file source programs)
#   RELATE_JAVA_CLASSPATH  Java: the client jar and its runtime dependencies
#   RELATE_GO              Go: the go binary
#   RELATE_GO_CLIENT       Go: the checkout's clients/go, the replace directive's target
#   RELATE_GO_HOME         Go: go/ (GOPATH, GOMODCACHE and GOCACHE live under it)
#   RELATE_SWIFT           Swift: the swift binary
#   RELATE_SWIFT_PACKAGE   Swift: swift/relate, the package a sample depends on
#   DO_NOT_TRACK=1
# A run writes env.sh afresh with the clients that run built, so a client
# left out with --skip-<lang> is not set up until a run builds it again.
#
# Options:
#   --upstream DIR   the relate checkout at the release's tag (default:
#                    $RELATE_UPSTREAM, else ../relate beside this repository);
#                    its workspace version must be --version
#   --version X.Y.Z  the release to install from the registries (default: the
#                    version in src/content/docs/_data/engine.json)
#   --out DIR        where to build (default above)
#   --python BIN     the Python to make py/ with (default python3; needs 3.9+)
#   --crewai-python BIN
#                    the Python to make py-crewai/ with (default: the first of
#                    python3.13, python3.12, python3.11, python3.10 found, else
#                    --python when it is 3.10 to 3.13)
#   --jdk DIR        use this JDK (17+) instead of downloading Temurin 21
#   --mvn BIN        use this Maven instead of downloading Maven
#   --skip-python, --skip-crewai, --skip-node, --skip-rust, --skip-c, --skip-java,
#   --skip-go, --skip-swift
#                    leave that client out
#   --github-env     also append the variables to $GITHUB_ENV (GitHub Actions)
#
# Needs: the Rust toolchain the checkout pins (rust-toolchain.toml, through
# rustup), and per client: Python 3.9+ with venv and pip (PyPI); Node 22.13+
# and npm (the npm registry); cargo with crates.io access; a C
# compiler (cc); Go 1.22+ with cgo; Swift 6 with Xcode (xcodebuild); curl and
# tar for the JDK and Maven downloads, which are checked against the SHA-256
# (JDK) and SHA-512 (Maven) their publishers list, pinned below. The first
# build compiles the engine twice (the FFI library and the Rust samples'
# template) and takes several minutes.
set -euo pipefail

# Pinned downloads (checked 2026-11-07). The JDK is Eclipse Temurin 21 from
# the Adoptium API's latest 21 release; each SHA-256 is the one published
# beside the tarball (<tarball>.sha256.txt on the adoptium/temurin21-binaries
# release). Maven's SHA-512 is the one Apache publishes beside the tarball
# (<tarball>.sha512; Apache publishes no SHA-256).
JDK_RELEASE='jdk-21.0.13+9'
JDK_VERSION_FILE='21.0.13_9'
JDK_SHA256_aarch64_mac='bf036b35b071bfb2f54f2c0af8ee8d88afa95ee6eb3dce02c0f94cfc2524d04a'
JDK_SHA256_x64_mac='9aa1d1c17ae5467a022679e7e0af5c00797d94ac462ed1a46f4db07a8a34a6dd'
JDK_SHA256_x64_linux='d7f5d5cf865a2902b70ff549b97586a7d3f234e016f041ab447ea740c7d66d1c'
JDK_SHA256_aarch64_linux='e3522e707fc7dbe2a72c30746b1e7068301a0213ecd213d4491f35a14eb55578'
MAVEN_VERSION='3.10.0'
MAVEN_SHA512='908b1501bfb420bf7c8affb855534a9c407fd6099367bfb9f2f2dcb8e9799102bffb84518cde74c679bd76870247c6528683abdd620581bffa90f95d92d175aa'

# The frameworks the integration pages' samples import, at the versions that
# installed on 2026-11-07 (LAUNCH.md has the re-check item). claude-agent-sdk
# bundles the Claude Code CLI (about 360 MB).
PY_FRAMEWORKS=(
  'pandas>=2.0'
  'langgraph==1.2.20'
  'claude-agent-sdk==0.2.179'
  'pydantic-ai==2.66.0'
  'openai-agents==0.24.0'
  'llama-index-core==0.14.25'
  'langchain==1.4.9'
  'langchain-core==1.7.6'
)
# crewai requires Python <3.14 and its pins hold pydantic-ai, openai-agents
# and pydantic back, so it gets its own venv (py-crewai/).
CREWAI_PIN='crewai==1.15.37'
NODE_FRAMEWORKS=(ai@7.0.165 zod@4.6.7 @mastra/core@1.82.0)

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"

upstream="${RELATE_UPSTREAM:-}"
version=""
out="${XDG_CACHE_HOME:-$HOME/.cache}/relate-web-samples"
python_bin=python3
crewai_python=""
jdk_dir=""
mvn_bin=""
do_python=1 do_crewai=1 do_node=1 do_rust=1 do_c=1 do_java=1 do_go=1 do_swift=1
github_env=0

die() { echo "setup.sh: $*" >&2; exit 1; }
say() { echo "setup.sh: $*" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --upstream) upstream="${2:?--upstream needs a directory}"; shift 2 ;;
    --version) version="${2:?--version needs X.Y.Z}"; shift 2 ;;
    --out) out="${2:?--out needs a directory}"; shift 2 ;;
    --python) python_bin="${2:?--python needs a binary}"; shift 2 ;;
    --crewai-python) crewai_python="${2:?--crewai-python needs a binary}"; shift 2 ;;
    --jdk) jdk_dir="${2:?--jdk needs a directory}"; shift 2 ;;
    --mvn) mvn_bin="${2:?--mvn needs a binary}"; shift 2 ;;
    --skip-python) do_python=0; do_crewai=0; shift ;;
    --skip-crewai) do_crewai=0; shift ;;
    --skip-node) do_node=0; shift ;;
    --skip-rust) do_rust=0; shift ;;
    --skip-c) do_c=0; shift ;;
    --skip-java) do_java=0; shift ;;
    --skip-go) do_go=0; shift ;;
    --skip-swift) do_swift=0; shift ;;
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
# --out is resolved to an absolute physical path before it is compared with
# the two repositories, and before anything is created, so a relative path or
# a symlink cannot place the build inside either one.
abs_path() { # $1 need not exist yet; prints its absolute path with symlinks resolved
  local p="$1" rest=""
  case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
  while [ ! -d "$p" ]; do
    case "$(basename "$p")" in . | ..) die "--out has . or .. after a directory that does not exist yet ($1)" ;; esac
    rest="/$(basename "$p")$rest"
    p="$(dirname "$p")"
  done
  printf '%s%s\n' "$(cd "$p" && pwd -P)" "$rest"
}
outside_repos() { # $1 absolute; dies when it is either repository or under one
  local r
  for r in "$(cd "$repo" && pwd -P)" "$(cd "$upstream" && pwd -P)"; do
    case "$1" in
      "$r" | "$r"/*) die "--out must be outside $r ($1)" ;;
    esac
  done
}
out="$(abs_path "$out")"
outside_repos "$out"
mkdir -p "$out"
out="$(cd "$out" && pwd -P)"
outside_repos "$out"
if [ -z "$version" ]; then
  command -v node >/dev/null 2>&1 || die "node is required to read the docs' version (or pass --version)"
  version="$(node -p 'require(process.argv[1]).version' "$repo/src/content/docs/_data/engine.json")"
fi
version="${version#v}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--version takes X.Y.Z, not '$version'"
# The registry clients and the clients built from the checkout must be one
# release, so the checkout's workspace version is held to --version.
upstream_version="$(sed -n '/^\[workspace.package\]/,/^\[/ s/^version *= *"\(.*\)"/\1/p' "$upstream/Cargo.toml" | head -n 1)"
[ "$upstream_version" = "$version" ] ||
  die "$upstream is at version ${upstream_version:-unknown}, not $version: clone the tag (git clone --branch v$version --depth 1 ...)"

command -v cargo >/dev/null 2>&1 || die "cargo is required (https://rustup.rs); the checkout pins its toolchain in rust-toolchain.toml"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) lib_name=librelate_ffi.dylib ;;
  Linux) lib_name=librelate_ffi.so ;;
  *) die "unsupported OS $os: macOS and Linux only" ;;
esac
if [ "$do_swift" = 1 ] && [ "$os" != Darwin ]; then
  say "Swift: skipped (the Swift client links an XCFramework, which SwiftPM uses on Apple platforms only)"
  do_swift=0
fi
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$out/target}"
export DO_NOT_TRACK=1

built=()   # "<client>: <what> (<seconds> s)" lines for the summary
step_start=0
start_step() { step_start=$SECONDS; }
end_step() { built+=("$1 ($((SECONDS - step_start)) s)"); }

# The checkout's cargo commands run from inside it, so rustup picks the
# toolchain its rust-toolchain.toml pins, with --locked, so its Cargo.lock is
# never rewritten. The Rust template (below) runs in $out/rust with a copy of
# that lockfile and toolchain file.

# --- Python -----------------------------------------------------------------

py="$out/py/bin/python"
if [ "$do_python" = 1 ]; then
  start_step
  command -v "$python_bin" >/dev/null 2>&1 || die "$python_bin not found (pass --python)"
  "$python_bin" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' ||
    die "$python_bin is older than 3.9 (relate-db requires-python >=3.9)"
  say "Python: venv at $out/py"
  # A venv left by an earlier run is reused only when it has the Python
  # --python names, so --python takes effect on every run.
  py_want="$("$python_bin" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
  if [ -x "$py" ] && [ "$("$py" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null)" != "$py_want" ]; then
    say "Python: $out/py is not Python $py_want; recreating it"
    rm -rf "$out/py"
  fi
  [ -x "$py" ] || "$python_bin" -m venv "$out/py"
  say "Python: installing relate-db==$version from PyPI and ${PY_FRAMEWORKS[*]}"
  "$py" -m pip install --quiet --disable-pip-version-check --force-reinstall --no-deps "relate-db==$version"
  "$py" -m pip install --quiet --disable-pip-version-check "relate-db==$version" "${PY_FRAMEWORKS[@]}"
  got="$(cd "$out" && PYTHONDONTWRITEBYTECODE=1 "$py" -c 'import importlib.metadata as m, relate; print(m.version("relate-db"))')"
  [ "$got" = "$version" ] || die "Python: relate-db $got is installed, not $version"
  say "Python: relate-db $got"
  end_step "python: relate-db $got from PyPI in $out/py ($("$py" -c 'import platform; print("Python", platform.python_version())'))"
fi

py_crewai="$out/py-crewai/bin/python"
if [ "$do_crewai" = 1 ]; then
  start_step
  in_range='import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)'
  if [ -z "$crewai_python" ]; then
    for candidate in python3.13 python3.12 python3.11 python3.10 "$python_bin"; do
      if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "$in_range" 2>/dev/null; then
        crewai_python="$candidate"
        break
      fi
    done
  fi
  if [ -z "$crewai_python" ]; then
    say "Python (crewai): skipped (crewai needs Python 3.10 to 3.13 and none was found; pass --crewai-python)"
    do_crewai=0
  else
    "$crewai_python" -c "$in_range" || die "$crewai_python is not Python 3.10 to 3.13 (crewai requires-python <3.14,>=3.10)"
    say "Python (crewai): venv at $out/py-crewai"
    cw_want="$("$crewai_python" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
    if [ -x "$py_crewai" ] && [ "$("$py_crewai" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null)" != "$cw_want" ]; then
      say "Python (crewai): $out/py-crewai is not Python $cw_want; recreating it"
      rm -rf "$out/py-crewai"
    fi
    [ -x "$py_crewai" ] || "$crewai_python" -m venv "$out/py-crewai"
    if ! "$py_crewai" -c 'import sys; v = sys.version_info; sys.exit(0 if (3, 10) <= v[:2] <= (3, 13) else 1)'; then
      die "$out/py-crewai is not Python 3.10 to 3.13; delete it and run again"
    fi
    say "Python (crewai): installing relate-db==$version from PyPI and $CREWAI_PIN"
    "$py_crewai" -m pip install --quiet --disable-pip-version-check --force-reinstall --no-deps "relate-db==$version"
    "$py_crewai" -m pip install --quiet --disable-pip-version-check "relate-db==$version" "$CREWAI_PIN"
    got="$(cd "$out" && PYTHONDONTWRITEBYTECODE=1 "$py_crewai" -c 'import importlib.metadata as m, relate, crewai; print(m.version("relate-db"))')"
    [ "$got" = "$version" ] || die "Python (crewai): relate-db $got is installed, not $version"
    end_step "python (env=crewai): relate-db $got from PyPI and $CREWAI_PIN in $out/py-crewai ($("$py_crewai" -c 'import platform; print("Python", platform.python_version())'))"
  fi
fi

# --- The FFI library (C, Java, Go, Swift) -----------------------------------

lib=""
include_dir="$out/include"
if [ "$do_c" = 1 ] || [ "$do_java" = 1 ] || [ "$do_go" = 1 ] || [ "$do_swift" = 1 ]; then
  start_step
  say "FFI: building the library (cargo build -p relate-ffi --release)"
  (cd "$upstream" && cargo build --release --locked -p relate-ffi)
  lib="$CARGO_TARGET_DIR/release/$lib_name"
  [ -f "$lib" ] || die "the FFI build produced no $lib"
  mkdir -p "$include_dir"
  cp "$upstream/surfaces/relate-ffi/include/relate.h" "$include_dir/relate.h"
  end_step "ffi: $lib and $include_dir/relate.h"
fi
lib_dir="$(dirname "${lib:-.}")"

# --- Node.js ----------------------------------------------------------------

node_modules="$out/node/node_modules"
if [ "$do_node" = 1 ]; then
  start_step
  command -v node >/dev/null 2>&1 || die "node is required (22.13+)"
  node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)' ||
    die "node $(node --version) is older than 22.13 (ai 7 needs 22+, @mastra/core 22.13+)"
  command -v npm >/dev/null 2>&1 || die "npm is required"
  # Built beside the old tree and swapped in, so a run in progress elsewhere
  # keeps a whole node_modules.
  staging="$out/node.new"
  rm -rf "$staging"
  mkdir -p "$staging"
  # The client and the frameworks in one install, so npm resolves them
  # together; npm picks the platform package (@relate/<platform>-<arch>) that
  # carries the native library.
  say "Node: installing @relate/relate@$version from npm and ${NODE_FRAMEWORKS[*]}"
  npm install --no-save --no-package-lock --no-audit --no-fund --loglevel=error --prefix "$staging" "@relate/relate@$version" "${NODE_FRAMEWORKS[@]}"
  rm -rf "$out/node.old"
  [ -d "$out/node" ] && mv "$out/node" "$out/node.old"
  mv "$staging" "$out/node"
  rm -rf "$out/node.old"
  # Without RELATE_LIB, so the probe loads the platform package's library, as
  # the samples do.
  got="$(cd "$out" && env -u RELATE_LIB NODE_PATH="$node_modules" node -e \
    'const p=require("@relate/relate/package.json"); const {Database}=require("@relate/relate"); Database.open(":memory:").connect().query("RETURN 1 AS x"); console.log(p.version)')"
  [ "$got" = "$version" ] || die "Node: @relate/relate $got is installed, not $version"
  say "Node: @relate/relate $got"
  end_step "node: @relate/relate $got from npm in $node_modules ($(node --version))"
fi

# --- Rust -------------------------------------------------------------------

rust_dir="$out/rust"
cargo_bin="$(command -v cargo)"
if [ "$do_rust" = 1 ]; then
  start_step
  say "Rust: template project at $rust_dir"
  mkdir -p "$rust_dir"
  cp "$upstream/rust-toolchain.toml" "$rust_dir/rust-toolchain.toml"
  # Re-seeded from the checkout's lockfile on every run, so the engine's
  # dependencies resolve to the versions upstream builds with; cargo resolves
  # the relate crates from crates.io at the release, adds relate-sample and
  # prunes the rest, which the check after the build holds.
  cp "$upstream/Cargo.lock" "$rust_dir/Cargo.lock"
  # A sample's own crate compiles unoptimized and without debug info, so it
  # links fast; the engine is optimized once. The samples runner writes this
  # manifest per sample with only the [[bin]] path changed (samples.ts).
  cat >"$rust_dir/Cargo.toml" <<EOF
# Written by scripts/samples/setup.sh: the template of a \`\`\`rust run sample.
[package]
name = "relate-sample"
version = "0.0.0"
edition = "2021"
publish = false

[[bin]]
name = "relate-sample"
path = "main.rs"

[dependencies]
relate = "=$version"

[profile.release]
debug = false
lto = false
incremental = false

[profile.release.package.relate-sample]
opt-level = 0

[workspace]
EOF
  cat >"$rust_dir/main.rs" <<'EOF'
fn main() {
    println!("template");
}
EOF
  say "Rust: compiling the relate crate $version from crates.io for the samples (cargo build --release)"
  (cd "$rust_dir" && CARGO_TARGET_DIR="$rust_dir/target" "$cargo_bin" build --release --quiet)
  # Every package the template locks, but its own crate, is a name and version
  # the checkout's lockfile holds; anything else is a dependency cargo resolved
  # on its own, which the samples must not link.
  lock_pairs() { awk '/^\[\[package\]\]/ { n = "" } /^name = / { n = $3 } /^version = / && n != "" { print n " " $3 }' "$1" | sort -u; }
  stray="$(comm -23 <(lock_pairs "$rust_dir/Cargo.lock" | grep -v '^"relate-sample" ') <(lock_pairs "$upstream/Cargo.lock"))"
  [ -z "$stray" ] || die "the Rust template locks packages the checkout's Cargo.lock does not: $stray"
  "$rust_dir/target/release/relate-sample" >/dev/null
  end_step "rust: the relate crate $version from crates.io compiled in $rust_dir/target ($(cd "$rust_dir" && rustc --version))"
fi

# --- C ----------------------------------------------------------------------

cc_bin=""
if [ "$do_c" = 1 ]; then
  start_step
  cc_bin="$(command -v "${CC:-cc}" || true)"
  [ -n "$cc_bin" ] || die "a C compiler is required (cc, or set CC)"
  probe_dir="$(mktemp -d)"
  printf '#include <stdio.h>\n#include "relate.h"\nint main(void) { printf("%%d\\n", relate_abi_version()); return 0; }\n' >"$probe_dir/probe.c"
  "$cc_bin" -I"$include_dir" "$probe_dir/probe.c" -L"$lib_dir" -lrelate_ffi -Wl,-rpath,"$lib_dir" -o "$probe_dir/probe"
  abi="$("$probe_dir/probe")"
  rm -rf "$probe_dir"
  end_step "c: $cc_bin links $lib_name (ABI $abi)"
fi

# --- Java -------------------------------------------------------------------

java_bin=""
java_cp=""
fetch() { # url file
  curl -fsSL --retry 3 -o "$2" "$1"
}
if [ "$do_java" = 1 ]; then
  start_step
  command -v curl >/dev/null 2>&1 || die "curl is required to download the JDK and Maven"
  mkdir -p "$out/tools"
  if [ -z "$jdk_dir" ]; then
    case "$os-$arch" in
      Darwin-arm64) jdk_key=aarch64_mac ;;
      Darwin-x86_64) jdk_key=x64_mac ;;
      Linux-x86_64) jdk_key=x64_linux ;;
      Linux-aarch64 | Linux-arm64) jdk_key=aarch64_linux ;;
      *) die "no pinned Temurin JDK for $os $arch; pass --jdk <JDK 17+ home>" ;;
    esac
    sum_var="JDK_SHA256_$jdk_key"
    jdk_sum="${!sum_var}"
    jdk_tar="OpenJDK21U-jdk_${jdk_key}_hotspot_${JDK_VERSION_FILE}.tar.gz"
    jdk_root="$out/tools/$JDK_RELEASE"
    if [ ! -d "$jdk_root" ]; then
      say "Java: downloading Temurin $JDK_RELEASE ($jdk_tar)"
      tmp="$(mktemp -d)"
      fetch "https://github.com/adoptium/temurin21-binaries/releases/download/${JDK_RELEASE/+/%2B}/$jdk_tar" "$tmp/$jdk_tar"
      got="$(shasum -a 256 "$tmp/$jdk_tar" | cut -d' ' -f1)"
      [ "$got" = "$jdk_sum" ] || die "$jdk_tar: SHA-256 $got, expected the published $jdk_sum; not using it"
      mkdir -p "$tmp/x"
      tar -xzf "$tmp/$jdk_tar" -C "$tmp/x"
      mv "$tmp/x/$JDK_RELEASE" "$jdk_root"
      rm -rf "$tmp"
    fi
    if [ -d "$jdk_root/Contents/Home" ]; then jdk_dir="$jdk_root/Contents/Home"; else jdk_dir="$jdk_root"; fi
  fi
  java_bin="$jdk_dir/bin/java"
  [ -x "$java_bin" ] || die "$java_bin is not executable (--jdk takes a JDK home)"
  "$java_bin" -XshowSettings:properties -version 2>&1 | grep -q 'java.specification.version = \(1[7-9]\|[2-9][0-9]\)' ||
    die "$java_bin is older than 17 (the Java client compiles with --release 17)"
  if [ -z "$mvn_bin" ]; then
    mvn_root="$out/tools/apache-maven-$MAVEN_VERSION"
    if [ ! -d "$mvn_root" ]; then
      say "Java: downloading Maven $MAVEN_VERSION"
      tmp="$(mktemp -d)"
      mvn_tar="apache-maven-$MAVEN_VERSION-bin.tar.gz"
      fetch "https://dlcdn.apache.org/maven/maven-3/$MAVEN_VERSION/binaries/$mvn_tar" "$tmp/$mvn_tar" ||
        fetch "https://archive.apache.org/dist/maven/maven-3/$MAVEN_VERSION/binaries/$mvn_tar" "$tmp/$mvn_tar"
      got="$(shasum -a 512 "$tmp/$mvn_tar" | cut -d' ' -f1)"
      [ "$got" = "$MAVEN_SHA512" ] || die "$mvn_tar: SHA-512 $got, expected the published $MAVEN_SHA512; not using it"
      mkdir -p "$tmp/x"
      tar -xzf "$tmp/$mvn_tar" -C "$tmp/x"
      mv "$tmp/x/apache-maven-$MAVEN_VERSION" "$mvn_root"
      rm -rf "$tmp"
    fi
    mvn_bin="$mvn_root/bin/mvn"
  fi
  [ -x "$mvn_bin" ] || die "$mvn_bin is not executable"
  say "Java: packaging a copy of clients/java with Maven (tests skipped)"
  rm -rf "$out/java/client"
  mkdir -p "$out/java"
  cp -R "$upstream/clients/java" "$out/java/client"
  rm -rf "$out/java/client/target"
  mvn_args=(-B -q -f "$out/java/client/pom.xml" "-Dmaven.repo.local=$out/java/m2" -Dmaven.test.skip=true)
  JAVA_HOME="$jdk_dir" "$mvn_bin" "${mvn_args[@]}" "-Drelate.ffi.dir=$lib_dir" package
  JAVA_HOME="$jdk_dir" "$mvn_bin" "${mvn_args[@]}" dependency:build-classpath \
    -DincludeScope=runtime "-Dmdep.outputFile=$out/java/runtime.classpath"
  jars=("$out"/java/client/target/relate-*.jar)
  client_jar=""
  for j in "${jars[@]}"; do
    case "$j" in *-osx-* | *-linux-* | *-windows-*) ;; *) client_jar="$j" ;; esac
  done
  [ -f "$client_jar" ] || die "Maven produced no client jar in $out/java/client/target"
  java_cp="$client_jar:$(cat "$out/java/runtime.classpath")"
  # Samples may use com.relate.* and the JDK only: no test-scoped jar.
  case "$java_cp" in *junit* | *opentest4j* | *apiguardian*) die "the runtime classpath holds test dependencies: $java_cp" ;; esac
  jar_version="$(basename "$client_jar" .jar)"
  end_step "java: ${jar_version#relate-} jar of com.relate:relate on $("$java_bin" -version 2>&1 | head -1)"
fi

# --- Go ---------------------------------------------------------------------

go_bin=""
go_home="$out/go"
if [ "$do_go" = 1 ]; then
  start_step
  go_bin="$(command -v go || true)"
  [ -n "$go_bin" ] || die "go is required (1.22+)"
  [ -f "$upstream/clients/go/go.mod" ] || die "$upstream has no clients/go/go.mod"
  mkdir -p "$go_home/path" "$go_home/mod" "$go_home/cache"
  # The same environment samples.ts gives a Go sample.
  probe_dir="$(mktemp -d)"
  cat >"$probe_dir/go.mod" <<EOF
module relatesample

go 1.22

require github.com/relatedb/relate/clients/go v0.0.0

replace github.com/relatedb/relate/clients/go => $upstream/clients/go
EOF
  printf 'package main\n\nimport (\n\t"fmt"\n\n\trelate "github.com/relatedb/relate/clients/go"\n)\n\nfunc main() {\n\tdb, err := relate.Open(":memory:")\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tdefer db.Close()\n\tfmt.Println("ok")\n}\n' >"$probe_dir/main.go"
  say "Go: building the client (cgo, against $lib_name)"
  (cd "$probe_dir" && GOPATH="$go_home/path" GOMODCACHE="$go_home/mod" GOCACHE="$go_home/cache" GOFLAGS=-mod=mod \
    GOTOOLCHAIN=local GOPROXY=off GOWORK=off CGO_ENABLED=1 CGO_CFLAGS="-I$include_dir" \
    CGO_LDFLAGS="-L$lib_dir -lrelate_ffi -Wl,-rpath,$lib_dir" "$go_bin" build -o "$probe_dir/probe" . && "$probe_dir/probe" >/dev/null)
  rm -rf "$probe_dir"
  end_step "go: clients/go through a replace directive, $("$go_bin" version)"
fi

# --- Swift ------------------------------------------------------------------

swift_bin=""
swift_pkg="$out/swift/relate"
if [ "$do_swift" = 1 ]; then
  start_step
  swift_bin="$(command -v swift || true)"
  [ -n "$swift_bin" ] || die "swift is required (Swift 6, with Xcode)"
  command -v xcodebuild >/dev/null 2>&1 || die "xcodebuild is required to make the XCFramework (Xcode)"
  [ -f "$upstream/Package.swift" ] || die "$upstream has no Package.swift"
  static_lib="$CARGO_TARGET_DIR/release/librelate_ffi.a"
  [ -f "$static_lib" ] || die "the FFI build produced no $static_lib"
  say "Swift: copying Package.swift and clients/swift to $swift_pkg"
  # The directory is named relate, so the package's identity is `relate`, as
  # for the checkout: a sample names .product(name: "Relate", package: "relate").
  rm -rf "$swift_pkg"
  mkdir -p "$swift_pkg/clients/swift" "$swift_pkg/target/apple/headers/CRelate"
  cp "$upstream/Package.swift" "$swift_pkg/Package.swift"
  cp -R "$upstream/clients/swift/Sources" "$upstream/clients/swift/Tests" "$swift_pkg/clients/swift/"
  # The local binary target the manifest links with RELATE_LOCAL_XCFRAMEWORK=1,
  # made as the checkout's scripts/build-xcframework.sh makes it, from this
  # host's slice only.
  cp "$include_dir/relate.h" "$swift_pkg/target/apple/headers/CRelate/relate.h"
  cat >"$swift_pkg/target/apple/headers/CRelate/module.modulemap" <<'EOF'
module CRelate {
    header "relate.h"
    link "iconv"
    link framework "CoreFoundation"
    export *
}
EOF
  xcodebuild -create-xcframework -library "$static_lib" -headers "$swift_pkg/target/apple/headers" \
    -output "$swift_pkg/target/apple/RelateFFI.xcframework" >/dev/null
  rm -rf "$out/swift/scratch"
  end_step "swift: the Relate package with a local XCFramework at $swift_pkg ($("$swift_bin" --version 2>&1 | grep -o 'Swift version [0-9.]*' | head -1))"
fi

# --- env.sh -----------------------------------------------------------------

{
  echo "# Written by scripts/samples/setup.sh from $upstream"
  echo "# (the variables are described in that script's header)"
  [ "$do_python" = 1 ] && echo "export RELATE_PY='$py'"
  [ "$do_crewai" = 1 ] && echo "export RELATE_PY_CREWAI='$py_crewai'"
  if [ "$do_node" = 1 ]; then
    echo "export RELATE_NODE='$(command -v node)'"
    echo "export NODE_PATH='$node_modules'"
  fi
  [ -n "$lib" ] && echo "export RELATE_LIB='$lib'"
  if [ "$do_rust" = 1 ]; then
    echo "export RELATE_CARGO='$cargo_bin'"
    echo "export RELATE_RUST_PROJECT='$rust_dir'"
  fi
  [ "$do_c" = 1 ] && echo "export RELATE_CC='$cc_bin'"
  { [ "$do_c" = 1 ] || [ "$do_go" = 1 ]; } && echo "export RELATE_C_INCLUDE='$include_dir'"
  if [ "$do_java" = 1 ]; then
    echo "export RELATE_JAVA='$java_bin'"
    echo "export RELATE_JAVA_CLASSPATH='$java_cp'"
  fi
  if [ "$do_go" = 1 ]; then
    echo "export RELATE_GO='$go_bin'"
    echo "export RELATE_GO_CLIENT='$upstream/clients/go'"
    echo "export RELATE_GO_HOME='$go_home'"
  fi
  if [ "$do_swift" = 1 ]; then
    echo "export RELATE_SWIFT='$swift_bin'"
    echo "export RELATE_SWIFT_PACKAGE='$swift_pkg'"
  fi
  echo "export DO_NOT_TRACK=1"
} >"$out/env.sh"

if [ "$github_env" = 1 ]; then
  [ -n "${GITHUB_ENV:-}" ] || die "--github-env: GITHUB_ENV is not set"
  sed -n 's/^export \([A-Z_]*\)=.\(.*\).$/\1=\2/p' "$out/env.sh" >>"$GITHUB_ENV"
fi

say "built:"
for line in "${built[@]}"; do say "  $line"; done

# Each client's engine version, through the samples runner itself (one probe
# program per language), when this repository's dependencies are installed.
if [ -d "$repo/node_modules/mdast-util-from-markdown" ] && command -v node >/dev/null 2>&1; then
  say "the clients as docs:samples sees them:"
  # shellcheck disable=SC1091
  (set +u; source "$out/env.sh"; cd "$repo" && node scripts/docs-samples.ts --clients) || die "a client did not load in docs:samples (above)"
else
  say "(npm ci in $repo, then node scripts/docs-samples.ts --clients, lists the clients as docs:samples sees them)"
fi

say "done. To use the clients:"
echo "source '$out/env.sh'"
