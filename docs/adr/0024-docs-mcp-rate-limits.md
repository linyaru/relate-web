# ADR-0024: The docs MCP is limited per IP and by a per-IP, per-tool cost budget on Cloudflare's rate limiting binding

Status: Proposed

Date: 2026-11-07

## Context

ADR-0013 decision 4 asks the hosted docs MCP for a per-IP rate limit and a
per-tool cost budget, limits published with `Retry-After`, a row cap, and
logs that count calls per tool and per client and zero-result searches
without keeping query text. Cloud harnesses share egress, so many agents
can sit behind one address, and the tools differ in cost: a search runs a
statement on the engine, a page read slices bundled text. Cloudflare's
rate limiting binding counts per key in 10 or 60 second windows aligned to
the clock, per location, and reports no reset time; wrangler dev simulates
it.

## Decision

- Two limits, both on the binding: every request to `/mcp` spends one from
  a per-IP limit of 20 per 10 seconds, before its body is read, so a
  malformed or oversized request counts too; each tool call, resource read and
  prompt fetch spends its cost from a per-IP, per-tool budget of 120 units
  per 60 seconds, where `search_docs` costs 3 and every other call 1.
- Over a limit: HTTP 429, `Retry-After` set to the window length (an upper
  bound, since the binding reports no reset), a `RateLimit-Policy` header,
  and a JSON-RPC error with a stable code (-32010 rate limited, -32011
  budget exhausted) whose data repeats the limits. The same limits are in
  the plain-text description at `GET /mcp`.
- Caps: at most 20 search results and 10 error matches per call, 96 KiB of
  text per result, 64 KiB per request (bytes, read through a counting
  reader that stops at the cap, so a chunked body is never buffered whole),
  and 10 JSON-RPC messages per request. A larger batch is HTTP 400 with
  -32600 before any of its calls spends from the budget.
- Without the binding the same numbers apply per isolate in a fixed window.
- One log line per request: the JSON-RPC methods and tool name from fixed
  lists, the client family from a fixed list of user-agent patterns,
  status, duration, and a zero-results flag; never query text, page ids
  asked for, IPs or full user agents. Cloudflare's invocation logs are off.

## Alternatives considered

- **A single per-IP limit.** Simplest. Rejected: too strict for agents
  behind shared egress and too loose for one agent looping on the engine.
- **A global per-tool budget per location.** Bounds total engine work.
  Rejected: a few abusive addresses could exhaust it for everyone.
- **Durable Object counters.** Exact and global. Rejected: a stateful
  component for a stateless server, and cost per request.

## Consequences

- Limits are approximate (per location, eventually consistent); the
  published numbers are the configured ones.
- A JSON-RPC batch counts once against the per-IP limit and spends its
  calls from the budget; the 10-message cap bounds one response at ten
  capped results, about 1 MB, and the budget bounds a minute's volume.
- Changing a number changes the Worker's configuration and its limits
  module together, and the `reference/server/docs-mcp` page.
- The metrics in DOCS-PLAN.md §3.8 (calls per tool and client, zero-result
  searches, explain_error misses) come from the log line.
