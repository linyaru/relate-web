# ADR-0062: The verified samples install the published clients where a registry has them

Status: Proposed

Date: 2026-11-11

## Context

Every ```` ```<lang> run ```` sample on the docs runs at replay and must print
its recorded output (ADR-0053). Until relate 1.0.0 no client was on a
registry, so `scripts/samples/setup.sh` built all seven from an upstream
checkout: a Python wheel with maturin, a copy of the Node.js client loading
a locally built engine library, and the Rust crate as a path dependency.
The docs said so, and `_data/samples.json` named the commit each build came
from.

relate 1.0.0 is published to PyPI (`relate-db`), npm (`@relate/relate` with
its platform packages) and crates.io (`relate`), each from the release
commit. The Java jars are release downloads only, the Go module has no
version tag, and the Swift package and the C library ship as release assets.
A sample verified against a source build proves the source, not what a
reader installs: the npm platform package, the wheel's bundled engine and
the crate's published file list are each a place the two can differ.

## Decision

The samples setup installs the clients a registry publishes, at the release
the docs are pinned to (`_data/engine.json`): `relate-db==<version>` from
PyPI in both Python environments, `@relate/relate@<version>` from npm with
the platform package npm picks, and `relate = "=<version>"` from crates.io
in the Rust template project, with every `relate-*` crate it resolves pinned
to that version. The Node.js samples run without `RELATE_LIB`, so the client
loads the engine from its platform package.

The Java, Go, Swift and C clients are still built from an upstream checkout,
which must be at the same release: setup refuses a checkout whose workspace
version is not the version it installs, or whose commit is not the one the
release tag names, so every language in one replay runs one release.

## Alternatives considered

- **Keep building every client from the checkout.** No network beyond the
  checkout and one code path. Rejected: the docs would keep verifying builds
  no reader installs, and a packaging fault in a published client would
  pass the replay.
- **Take the remaining clients from the release assets too** (the Java jar,
  the `relate-ffi` archive, the Swift package resolved from the tag).
  Closer still to what a reader installs. Rejected for now: each needs its
  own download, checksum and unpacking in the setup script, and none has a
  registry whose resolution the samples would exercise; a later decision can
  take them one at a time.

## Consequences

- A replay needs PyPI, npm and crates.io, and the release must be on all
  three before its samples can be re-recorded; the release refresh waits a
  bounded time for them and reports the samples as skipped after that.
- `_data/samples.json` describes the Python, Node.js and Rust clients as the
  published packages and the others as checkout builds at the tag.
- The Rust template still seeds its lockfile from the checkout's, so the
  engine's third-party dependencies resolve to the versions upstream locks.
