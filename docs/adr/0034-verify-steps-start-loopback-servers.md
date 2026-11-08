# ADR-0034: A verify step may start and stop its own loopback server

Status: Proposed

Date: 2026-11-08

## Context

The `bash verify` fences (ADR-0016) replay a page's commands against a
relate binary in a fresh directory and compare the output character for
character. The authoring contract asked for steps that need no network and
no running server, which kept replays hermetic. The serve guides (the HTTP
Query API, Bolt, MCP over HTTP, authentication, the container page) and
the `relate serve` reference document behavior that only a listening
server shows: the discovery document, status codes and GQL codes, the
generated token file and its reuse, the Bolt handshake. Without a live
server in the step, those facts would be shown as unreplayed output that
no check catches when the binary changes.

The replay already runs each step as one `bash -c` in a fresh directory
with a `PATH` that includes the system tools, so a step can start a server
in the background, wait for it, talk to it with `curl` or `/dev/tcp`, and
stop it before the fence ends. Two risks need a rule: a server left
running after a step, and a generated credential written into a page.

## Decision

A verify step may start `relate serve` itself, on a fixed port on
127.0.0.1, with these limits:

1. The step needs no server already running and no network beyond
   loopback.
2. It starts the server in the background with its stderr sent to a file,
   waits until the port answers, and stops it with `kill` and `wait`
   before the fence ends, so the next step starts with no server.
3. A credential is read from the store's `<store>.auth-token` file, never
   written into the fence or its expected output. Startup lines that
   carry a generated token stay out of the expected output.
4. Expected output leaves out values that change per run (transaction
   ids, expiry times, timings), by filtering in the step.
5. Steps run one at a time, so pages may reuse ports; a page's steps never
   need two servers on one port at once.

## Alternatives considered

- **Plain fences with output from a recorded run.** No harness change.
  Rejected: the output drifts silently when the binary changes, which is
  the failure ADR-0016 exists to catch.
- **A separate server harness that starts a server per page outside the
  fence.** Rejected: the page would show output from a command it does
  not show, and the harness would need per-page configuration.
- **Ephemeral ports chosen at replay time.** Avoids port clashes.
  Rejected: the port appears in expected output (the discovery document
  names it), so it must be fixed for character comparison.

## Consequences

- The serve guides carry replayed server facts, and `docs:cli-check`
  catches their drift.
- The README's "Verified commands" section states the rule and the
  start, wait, stop shape.
- A replay host needs the fixed loopback ports free; a clash fails the
  step with the bind error, which names the port.
- A step that leaves a server running is a page bug; review checks for
  `kill` and `wait` in any fence that starts one.
