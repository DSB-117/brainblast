# Roadmap

v0.1.4 ships the core workflow: a 7-step research loop, a structured handoff report
(executive summary + risk heatmap), and automatic injection of that report into the next
coding session.

This roadmap is a **firm 4-week plan** — 1–2 shippable features per week, each tied to a
weekly theme, with deliberate buffer for dogfooding between ships. The whole arc lands as a
single **v0.2.0** release at the end; this document stays internal until then, so the public
story is one substantial release rather than four churny point bumps.

The arc is intentional:

> **Week 1** makes Brainblast *machine-consumable*. **Week 2** makes it *provably trustworthy*.
> **Week 3** makes it *smarter about input and faster on repeat*. **Week 4** closes the loop
> with a *post-code guardrail* and publishes a *catch-rate benchmark* that proves it works.

Why this order: the market for AI coding tools is crowded with "live docs" retrievers
(Context7, `llms.txt` bridges) that fetch current docs and stop there. Brainblast's edge is
that it produces **risk analysis and catches irreversible mistakes**. Every item below either
deepens that moat (trust, verifiability, the post-code guardrail) or widens distribution (a
stable schema, a CI gate, a public benchmark). We are not chasing doc-retrieval parity.

---

## Design principles (what keeps this powerful, not complicated)

- **One new surface per week.** Each week adds at most one thing a user has to learn; the
  second feature, when there is one, is enforcement or plumbing behind it.
- **Buffer is part of the plan.** Each week reserves time to dogfood the new behavior against a
  real spec before moving on. A feature isn't "shipped" until it has caught something real.
- **Backwards-compatible by default.** New behavior is additive; existing `/brainblast` runs
  unchanged unless a flag is passed.
- **The report stays the source of truth.** `report.json`, the CI gate, and the verifier all
  derive from the same run — no parallel formats to keep in sync.
- **Non-goals (explicitly out of scope this cycle):** writing or running implementation code,
  a hosted SaaS backend, a web dashboard, and any feature that requires an account or API key
  of our own. Brainblast stays a local, file-based workflow.

---

## Week 1 — The integration surface *(Jun 5–11)*

*Theme: Brainblast becomes something other tools can build on.*

- **Machine-readable `report.json`.** ✅ **Shipped** (on `main`). A structured emission alongside
  `final-report.md`: components, each risk with a `severity` enum, each pre-coding decision, each
  requirements correction, plus run metadata. Versioned (`schemaVersion: "1.0"`) so downstream
  consumers don't break. The committed JSON Schema lives at `schema/report.schema.json`, and
  `scripts/validate.sh` validates it plus every `examples/*/report.json` against it (full Draft-07
  check when `jsonschema` is present, a schema-driven fallback otherwise, plus a riskTotals
  cross-check).

- **`--ci` mode + exit-code gate.** A non-interactive path that never calls `AskUserQuestion`,
  picks documented defaults, and **exits non-zero if any unresolved CRITICAL risk remains**
  (configurable, e.g. `--fail-on=critical|high`). This is the answer to "half of orgs shipped
  an outage from outdated AI-generated code" — a pipeline can now *block* on it. *Done when:* a
  documented one-liner runs in GitHub Actions and fails a sample spec with a seeded CRITICAL.

- *Buffer:* dogfood the gate against the Bags and Stripe+Privy specs; confirm the schema
  survives both without ad-hoc fields.

---

## Week 2 — Provable trust *(Jun 12–18)*

*Theme: every scary claim is auditable, not just plausible.*

- **Provenance & freshness metadata.** Capture fetch timestamp and page `last-modified` per
  fact; attach a confidence level and a `staleAfterDays` marker, surfaced in both the markdown
  and `report.json`, so a report read weeks later carries its own expiry. *Done when:* each
  Fact shows when it was fetched and how stale it may be.

- **Two-source rule for CRITICAL claims (with enforced coverage linter).** No risk is asserted
  as CRITICAL on a single page — require a second independent source or downgrade to HIGH with
  a note. Fold this into a promoted coverage linter: the Step 4 checklist becomes a script that
  asserts every Fact has a URL, every component has auth / version / limits / risk sections,
  and every CRITICAL cites two sources. The product *is* trust; this is the cheapest trust we
  can buy. *Done when:* the linter fails a deliberately incomplete or single-sourced-CRITICAL run.

- *Buffer:* re-run the examples so every committed CRITICAL carries two sources and a freshness
  marker.

---

## Week 3 — Smarter input, faster on repeat *(Jun 19–25)*

*Theme: stop inferring from prose, and stop re-researching what hasn't changed.*

- **Auto-seed the inventory from the repo.** Read `package.json`, `requirements.txt`,
  `Cargo.toml`, `go.mod`, lockfiles, and committed OpenAPI specs to seed the inventory with
  *exact* names and *pinned* versions — far more reliable than inferring from prose, and
  OpenAPI parsing beats scraping HTML. The spec still adds intent and components not yet in
  code. *Done when:* a repo with a lockfile produces a versioned inventory before any browsing.

- **Incremental / cached runs.** ✅ **Shipped early** (on `main`, ahead of schedule). Research is
  cached per component, keyed by `name@version`, in `.agent-research/cache/`; a re-run reuses
  unchanged components and re-researches only what changed (new components or bumped versions),
  with `--fresh` to force a full pass. This delivers the core promise — *research is not repeated*.
  Still to fold in here: version-aware *diffing* driven by the auto-seeded inventory above.

- *Buffer:* run twice on a real evolving repo; confirm the diff is correct and the cache never
  serves a stale CRITICAL.

---

## Week 4 — Close the loop + prove it works *(Jun 26–Jul 2)*

*Theme: Brainblast stops being a pre-flight memo and becomes a guardrail — and we publish the
evidence. This week ships and the whole arc tags as **v0.2.0**.*

- **`/brainblast-verify` — the post-code guardrail (headline feature).** After the agent writes
  code, run the report's CRITICAL decisions back *against the implementation*. Each CRITICAL
  becomes a checkable assertion: did the creator wallet actually make it into the fee-share
  array? Is the Stripe webhook verifying the *raw* body? Is the Privy token's signature
  verified? It reads the `report.json` from Week 1 and reports PASS / FAIL / CAN'T-TELL per
  critical, with the file and line it checked. This turns the two demos into round-trips —
  *predict the silent failure, then confirm the code didn't ship it* — and makes Brainblast a
  loop, not a one-shot. *Done when:* running it against a deliberately broken Bags
  implementation flags the zero-fee misconfiguration. *(Given buffer this week, the benchmark
  below is the natural thing to slip if the verifier needs more polish.)*

- **Public catch-rate benchmark.** Dogfood Brainblast against 10–20 real specs and publish
  **precision** (how often a flagged CRITICAL is real) and **false-negative rate** on known
  traps (the Bags fee-config catch, the forged-webhook catch). A committed, reproducible
  benchmark is the artifact that tells the market this is serious — and it doubles as a
  regression guard for the prompt itself. *Done when:* `examples/benchmark/` holds the specs,
  expected catches, and a results table linked from the README.

---

## Stretch / next cycle (post-v0.2.0)

Deferred deliberately so the four weeks stay focused. Strong candidates for the following
sprint:

- **Parallel sub-agent fan-out + bounded per-component budget.** Fan out research for
  many-component specs instead of the sequential loop, with a per-component source/time ceiling
  so "never leave a question open" can't produce a runaway run. (Pairs with Week 3's
  incremental runs.)
- **MCP server for reports.** Expose `report.json` over MCP so Cursor, Copilot, and other
  agents can query a project's research without reading files — distribution into the tools
  teams already use.
- **Staleness diff.** Show what an agent's training data *would have believed* (e.g. "thinks
  SDK is v3, current is v5") versus the live truth — a sharp, quantified demo of the value.

---

## How we'll know it worked

Two signals, tracked across the cycle:

1. **Catch-rate (correctness).** From the Week 4 benchmark: precision on flagged CRITICALs and
   false-negative rate on known traps. This is the real proof and the regression guard.
2. **Adoption surface (seriousness).** `report.json` consumed by a real CI gate, and at least
   one external project running `--ci` in its pipeline. A tool people gate their builds on is a
   tool that has arrived.
