# WEBSITE-PLAN — act on the 2026-10-08 positioning study

Branch: `gh-pages`. Scope: `index.html`, `llms.txt`, `MAINTAINING.md`,
`demo-scenarios.md`, plus a small new `competition/` subtree. No build
step, no framework (per [MAINTAINING.md](./MAINTAINING.md)).

The study (positioning memo, 2026-10-08) is a **hypothesis**, not a market
verdict. We apply the parts that fix concrete site weaknesses now and
reject the parts that are off-mission for a product homepage (no
competitive comparisons on the site, no bolted-on privacy caveats where
no misleading claim exists). Where the study is stale — the "one
documented skip" caveat on the TCK — we use the current fact: **Relate
is 100% openCypher TCK 2024.3 compliant** (3,893 / 3,893, zero skips) and
we say so plainly, with the artefact linked. The hero's "in milliseconds"
is substantiated by the frozen baseline loadtests (ADR-0046, ADR-0070,
ADR-0071) that gate every merge.

---

## Guiding principles for every change below

1. **Outcome first, implementation second.** Lead with what the agent (or
   developer) accomplishes; the engine, Cypher, embedding, and `.cl` file
   are the proof, not the headline.
2. **Only ship substantiated claims — and ship them all.** TCK 100% is in
   CI; the "in milliseconds" promise is backed by the frozen baseline
   loadtests. Both are evidence we currently under-use on the page.
3. **Visible demo is the primary CTA.** The in-browser WASM console on
   the homepage is the "see it work" step the study asks for — it already
   exists; the plan sharpens its storytelling and discoverability.
4. **Honesty sharpens the promise, framed positively.** Replace vague
   "ideal for anything" phrasing with a short *Where Relate fits*
   block (good fits plus a one-line shape note on the single-process,
   memory-resident model). No negative "Not for" list on the site.
5. **Reference docs stay comprehensive; the top of the page tells one
   story.** The homepage's job is one outcome demonstrated end-to-end;
   the reference tabs are the index.

---

## Priority 1 — ship this pass

| # | Priority | Status | Area | Change |
|---|----------|--------|------|--------|
| 10 | 9 | done | Hero copy | Keep **"The agent-native graph database."** as the H1 (that is the category we claim). Add the outcome-led lede as the first sentence of the sub: **"Make sense of connected data in milliseconds. Let your agent explore the relationships in code, behavior, and events on a graph you can see, in process, with no graph service to run. One binary, one file, full openCypher coverage."** *"In milliseconds"* is substantiated by the frozen baseline loadtests (ADR-0046, ADR-0070, ADR-0071). |
| 20 | 9 | done | Hero CTAs | Add a pair of hero badges under the sub: a substantiated TCK badge (links to the compliance report) and a live-demo badge that scrolls to `#console`. Install block stays directly beneath. |
| 30 | 9 | done | TCK claim | Upgrade the current "full openCypher TCK coverage" wording to the precise, substantiated form: **"100% openCypher TCK 2024.3 — 3,893 / 3,893 scenarios pass, strict run in CI."** Put this once in the reference `cypher` tab (with the compliance link) and once as a short badge-style line under the hero. Lift the `MAINTAINING.md` rule that bans numeric counts — it was correct while a skip remained; Relate now has zero skips and the evidence should be visible. |
| 40 | 9 | done | Fit disclosure | Add a compact block at the end of `#reference` titled **"Where Relate fits"**, framed positively. Lead with: embedded or local graphs, agent-driven exploration, test fixtures, sandbox analytics, shipping a graph with an app. Close with one line on the shape of that fit: single-process, memory-resident, one WAL writer — so another database is the right call for graphs larger than RAM, distributed scale-out, or many simultaneous writers. No negative headers, no bulleted "Not for" list. |
| 60 | 8 | done | llms.txt alignment | Mirror the hero change, the precise TCK sentence, and the fit block into `llms.txt` in the same commit. No version numbers (existing rule holds). Cypher 25 and GQL coverage is claimed as **100%** alongside the TCK — same evidence standard, same link. |
| 70 | 8 | done | MAINTAINING.md | Update the facts table: TCK row becomes "100% openCypher TCK 2024.3; cite 3,893/3,893 with a link to `docs/tck/compliance.md`". Add a row for the fit block. Add a short **tone contract**: outcome-led, agent as mechanism not category, no "revolutionary"/"fastest" language; latency claims must trace to an in-repo artefact (today: the frozen baselines). Keep the no-marketing-fluff rule. |

## Priority 2 — this quarter

| # | Priority | Status | Area | Change |
|---|----------|--------|------|--------|
| 90 | 7 | done | Memory console story | Promoted the console from a single social-graph demo to a **three-scenario workbench**: Movie recommendations (analytics), Agent memory (3-session supersedes), Codebase context (Relate crates + ADRs). Each scenario has its own labeled seed, header pill, and 4–5 click-to-run demos. Every scenario follows the same pattern: `schema → full graph → small graph → table → table`. Switching scenario (or clicking the ↺ reset) drops and reseeds the in-memory db. Click-to-run replaces the old click-to-populate (`MAINTAINING.md` invariant updated). Mobile drift fixed with `svh` viewport units + `contain: layout paint` on the viz pane. |
| 110 | 6 | pending | Journey ordering | Reorder sections to match the study's recommended arc: hero → **memory console** → **take it away** (quickstart) → **examples** → **embed it** (clients tab lifted into a dedicated short section between examples and reference, with one `relate::Database::open` snippet in Rust, Python, and JS) → **trust the language** (TCK + fit) → full reference. The sections already exist; this is reordering + one new short section, not a rewrite. |
| 130 | 6 | pending | Cookbook link-out | Keep the cookbook on `main` (per ADR-0130/ADR-0132) but surface three recipes from the homepage under a new one-row **"Keep going"** strip between examples and reference. Pick recipes that match the three demo-scenarios buckets: *context & memory*, *sandbox analytics*, *subgraph fixtures*. |

## Priority 3 — follow-up / validation

| # | Priority | Status | Area | Change |
|---|----------|--------|------|--------|
| 140 | 5 | pending | Demo-scenarios refresh | Promote 3 of the 10 scenarios in [demo-scenarios.md](./demo-scenarios.md) to runnable end-to-end demos on the site (scenarios #1 agent memory, #5 deps.dev, #7 pull subgraph fixture — the three that best show *connected information become useful*). Each becomes a `cookbook/` recipe on `main`; the homepage links to them from the "Keep going" strip (#130). |
| 150 | 5 | pending | Validation signals | The study is explicit that we have no customer evidence yet. Instrument the hero CTA, console first-run, and quickstart copy events (the existing anonymous telemetry can host this if we keep the opt-out visible, otherwise simple GitHub referrer logs). Success = qualified adoption: demo run → successful local repeat → return visit. Clicks alone are a diagnostic. |
| 160 | 4 | pending | Message test | Once #10–#70 and #90 are live, run the study's A/B: outcome-led headline vs. the current agent-led headline. Decide on comprehension + qualified engagement, not clicks. Record the result as an ADR on `main` so we don't re-litigate it. |

---

## Explicitly rejected from the study

- **A privacy-scoping sentence on the homepage.** The current site makes
  no "your data stays local" claim that needs correcting, and bolting
  one on would introduce exactly the ambiguity the study warns about.
- **A competition subtree on the site.** No competitive comparisons live
  on `relatedb.ai`. Audience content only.
- **Dropping "agent-native" entirely from the page.** The study's own
  evidence is that "agent" is a visible messaging pattern across the
  category; stripping it from every surface at once would cost
  recognition without clear upside. We keep "agent" as *how it works*
  (skill install, JSON output, envelope errors), not the sole top-line.

---

## Order of landing

1. **Pass A (one PR against `gh-pages`):** #10, #20, #30, #40, #60, #70.
   Hero + TCK + fit + llms.txt + MAINTAINING.md tone contract. Zero new
   infra; design system unchanged.
2. **Pass B (follow-up PR against `gh-pages`):** #90, #110.
   Console labels + section reorder with a dedicated clients section.
3. **Pass C (requires `main` work):** #130 and #140 (cookbook recipes on
   `main`), then light `gh-pages` edits to link them from a "Keep going"
   strip.
4. **Pass D (validation):** #150, #160.

Each pass is a single reviewable change set, consistent with the "surgical
updates to `gh-pages`" model in [MAINTAINING.md](./MAINTAINING.md).
