# ADR-0027: Verified samples in Rust, Java, Go, Swift and C

Status: Proposed

Date: 2026-11-07

## Context

ADR-0021 made ```` ```python run ```` and ```` ```js run ```` fences
verified samples: a whole program run alone against the client, its
output recorded in the page's sidecar with the client version and a
SHA-256 of the program. Phase 2 adds a tutorial, an embedding guide and
reference pages for Rust, Java, Go, Swift and C (DOCS-PLAN.md §2), and
six more framework integrations. Their samples need the same guarantee.

Constraints: none of these clients is published before launch, so each is
built from the upstream checkout, which must stay untouched (no build
output, no lockfile change). Nothing may be installed system-wide. The
Rust, Java, Go and Swift clients carry no release version of their own
before launch: the Go module is `v0.0.0` behind a replace directive, the
Swift package has none, and the Java pom reads `0.1.0` between releases.
The Swift client's binary target is an XCFramework, which SwiftPM uses on
Apple platforms only. Several frameworks' dependency pins clash: in one
venv, crewai holds pydantic-ai and openai-agents several releases back,
and it requires Python below 3.14.

## Decision

1. ```` ```rust run ````, ```` ```java run ````, ```` ```go run ````,
   ```` ```swift run ```` and ```` ```c run ```` are verified samples under
   ADR-0021's rules (whole program, fresh working directory, prints a
   line, exits 0, recorded with `source_sha256`). A compiled sample is
   built in a second temporary directory against the client
   `scripts/samples/setup.sh` builds outside the checkout: Rust as a
   binary crate with a path dependency on the relate crate, from a
   template that carries the checkout's lockfile and toolchain pin and a
   target directory where the engine is compiled once; Java as a
   single-file source program on the client jar's classpath; Go as a module
   that replaces the client with the checkout's `clients/go`; Swift as a
   package depending on a copy of the checkout's manifest with a local
   XCFramework; C compiled against `relate.h` and linked to the FFI library.
2. For these five, `verified` is the engine version the client reports
   (`CALL dbms.components()`, component `Relate`), not a package version.
   Python and Node.js keep their package versions, which match the engine.
3. A Python sample may name a second venv with `env=<name>`; setup.sh
   builds `crewai` that way, and the main venv holds the other frameworks
   at their current releases.
4. setup.sh downloads the JDK (Temurin 21) and Maven and refuses either
   unless its digest equals the one the publisher lists, pinned in the
   script. The weekly workflow runs two jobs: Linux for every language but
   Swift (the JDK and Go from their setup actions), macOS for Swift alone.
5. The twin's `verified_by` can name `rust`, `java`, `go`, `swift` and `c`,
   after `node` and before `cli`.

## Alternatives considered

- **Build the samples inside the checkout's Cargo workspace and
  `target/`.** Reuses upstream's build cache. Rejected: it writes into the
  checkout, and a stale library there would be linked instead of the one
  just built.
- **Record each client's package version.** The same rule as Python.
  Rejected: the Java jar says `0.1.0` while running 0.16.1, so a sample
  could never match the docs' version, and Go and Swift have no version to
  report.
- **One venv with crewai in it.** One interpreter. Rejected: the
  integration pages would document framework releases months old, and
  Python 3.14 and later could not build it at all.
- **One macOS job for every language.** One engine build. Rejected: macOS
  minutes cost about ten times Linux minutes, and only Swift needs macOS.

## Consequences

- A page in any of the seven languages gets the same record, the same
  drift check and the same `verified_by` claim.
- A Go sample imports only the standard library and the client
  (`GOPROXY=off`); a Rust sample only `relate` and std.
- The first setup compiles the engine three times; a Rust sample then
  builds in about two seconds, a Swift one in about four.
- After launch the five clients come from their published packages, and
  their package versions should then equal the engine's; revisit point 2
  then.
