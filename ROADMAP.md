# Roadmap

## Where we are

Brainblast today is a **pre-flight check for AI-written integrations**: it reads requirements,
browses official docs for every external component, and produces a report — facts, severity-rated
risks, answered questions — that catches the silent, irreversible failures an agent would otherwise
ship (a zero-revenue fee config, an auth bypass, an immutable wrong choice).

Shipped through **v0.2.0**:

- The 7-step research loop, executive summary + risk heatmap, and auto-injection of the report into
  the next coding session.
- **`report.json`** — a stable, versioned (`schemaVersion 1.0`) machine-readable surface with a
  committed JSON Schema.
- **`--ci` mode + exit-code gate** — block a build when a CRITICAL risk remains.
- **Incremental runs** — research cached per `name@version`; a re-run only re-researches what changed.
- **Deterministic auditor + `npx brainblast` CLI** — an offline static scanner for the first
  Stripe webhook and Privy/JWT traps, backed by data rules, generated behavioral tests, and CI-ready
  `checks[]` / `checkTotals` in `report.json`.

That makes Brainblast a good *utility*. The rest of this roadmap is about making it an *amazing
product*.

## The thesis: make AI integrations correct-by-default — and keep them that way

Most "AI + docs" tools (Context7, `llms.txt` bridges, RAG-over-docs) **retrieve** current
documentation and stop. Retrieval is a feature, not a moat, and it prevents nothing. Brainblast's job
is bigger: **turn documentation into enforcement.** Predict the failure, prove the code didn't ship
it, and keep watching as the docs and advisories move.

Four escalating capabilities, each one making the last more valuable:

> **Predict → Enforce → Watch → Compound**
>
> **Predict** the silent failure before code (today). **Enforce** it — gate the build *and generate
> the durable test that fails forever if the code regresses.* **Watch** the pinned dependencies after
> merge and re-research on change. **Compound** every run into a portable knowledge base that makes
> the next run faster, sharper, and shareable.

The first two make Brainblast trustworthy and sticky inside one project. The last two are where it
stops being a script you run once and becomes infrastructure you keep — and, eventually, a data moat
that a retrieval tool can't copy by adding a fetch step.

## Design principles (keep it powerful, not complicated)

- **One new surface at a time.** Each rung adds at most one thing a user must learn; the rest is
  enforcement or plumbing behind it.
- **The report is the single source of truth.** `report.json` is the contract; the gate, the
  verifier, the generated tests, the watcher, and the intel packs all derive from it — never a
  parallel format.
- **Backwards-compatible and additive.** Existing `/brainblast` runs are unchanged unless a flag is
  passed.
- **Not shipped until it has caught something real.** Every rung carries a buffer to dogfood it
  against a live spec.
- **Earn trust before reach.** Evidence and corroboration come before distribution; a tool people
  gate their builds on cannot afford a confident wrong answer.

Near-term order after v0.2.0: broaden **Rung 2** guardrails, then Trust, Rung 4, Rung 5, and the
benchmark. The rungs are a capability ladder, not a calendar — Rung 1, the cache, and the first
deterministic auditor shipped ahead of the original week-by-week plan.

---

## Rung 1 — Predict  ✅ (shipped)

The core loop, the report, the schema, the cache. The foundation everything else reads from. Done —
kept honest by the benchmark below.

## Rung 2 — Enforce: from "flagged" to "can't regress"

The gate already blocks a build on a CRITICAL. The leap is to stop *re-checking* and start
*guaranteeing*.

- **`/brainblast-verify` — check the code against the report.** After the agent writes code, run each
  CRITICAL from `report.json` back against the implementation: did the creator wallet reach the
  fee-share array? Is the Stripe webhook verifying the *raw* body? Report PASS / FAIL / CAN'T-TELL per
  critical, with file and line. *Done when:* it flags the zero-fee misconfiguration in a deliberately
  broken Bags implementation.
- **Executable guardrails — generate the durable check (headline).** For each CRITICAL, emit a
  committed test or CI assertion in the project's own stack, so the failure mode is guarded *forever*,
  not just audited once. "CAN'T-TELL" disappears — a test either passes or fails. This is the
  difference between an audit and a guardrail, and the single highest-leverage item on this roadmap.
  *Done when:* a generated test fails against the broken Bags impl and passes once the creator wallet
  is added — proven on one JS (vitest/jest) and one Python (pytest) target to establish the pattern.
- **Make the gate communicate.** When the gate fails in CI, post the risk heatmap and the supporting
  evidence (quoted doc + URL) as a PR comment / line annotation — not just a red ✗. A reviewer should
  see *what* and *why* without opening logs. *Done when:* the Actions sample posts a PR comment with
  the heatmap and evidence links.

## Rung 3 — Trust: evidence-grade, corroborated, advisory-aware

Trust *is* the product. These make every scary claim auditable in seconds and grounded in more than
one page.

- **Evidence-grade provenance.** Each fact and each CRITICAL carries the exact quoted snippet, source
  URL, and fetch date in `report.json`; a `staleAfterDays` marker gives the report its own expiry.
  *Done when:* a reviewer can verify any CRITICAL from the report alone, without re-browsing.
- **Two-source rule + coverage linter.** No claim is asserted CRITICAL on a single page — corroborate
  with a second independent source or downgrade to HIGH with a note. Promote the Step-4 checklist into
  a script that fails a run missing a section, an un-sourced fact, or a single-sourced CRITICAL.
  *Done when:* the linter fails a seeded incomplete run.
- **Security-advisory cross-check (OSV).** For each resolved `name@version`, query the public OSV.dev
  API (no account, no key) and fold real CVEs, deprecations, and yanked versions into the risk output.
  This adds an *authoritative* risk source on top of docs. *Done when:* a component pinned to a
  version with a known advisory surfaces it as a CRITICAL/HIGH with the advisory ID and link.

## Rung 4 — Watch: standing protection after merge

A project's dependencies keep moving; a report from three months ago may now be wrong. This is the
retention lever — Brainblast that keeps working.

- **Drift watch.** A scheduled `--ci` re-research of the *pinned* components, diffed against the
  committed baseline `report.json`. Alert or gate when something material changes: a new breaking
  change, a fresh deprecation, a new advisory, or a version bump that invalidates a cached CRITICAL.
  Runs in the user's own CI on a cron — no hosting. *Done when:* bumping a dependency (or seeding a new
  advisory) produces a diff report that names exactly what changed and why it matters.
- **Staleness diff (the hero proof).** Quantify the gap between what an agent's *training data* would
  believe and the *live* truth — "thinks Stripe `apiVersion` is X; current is Y; here's the field that
  moved." A visceral, repeatable demo of why pre-flight research exists at all. *Done when:* a
  committed example shows a real training-vs-live delta on a fast-moving SDK.

## Rung 5 — Compound: knowledge that gets better with use

Today every run's research is discarded after the project. The asset *is* the research.

- ✅ **HiveMind (v0.10.0) — the shared second brain for AI agents.** The Compound
  rung's first major realization, on the *trap-knowledge* axis: one machine-global
  brain (`~/.brainblast/hive`) every agent shares, synced from the live VTI feed
  (cursor delta) + the public pack mirror (pinned commit, blob-verified), briefing
  agents at session start (`hive brief --inject`, `hive_brief` over MCP), correcting
  them at write time (`hive hook`, PostToolUse), enforcing at the gate (audits load
  hive packs automatically), alerting on outbreaks (new trap × linked repos' deps),
  carrying fix experience across repos and agents, and feeding an anonymized demand
  signal back into the fleet's work-orders. Every hop gated on RED→GREEN proof.
  *The per-`name@version` research intel-pack half of this rung (below) is still open.*

- **Auto-seed the inventory from the repo.** Read lockfiles (`package-lock.json`, `poetry.lock`,
  `Cargo.lock`, `go.mod`, …) and committed OpenAPI specs to seed components with *exact* names and
  *pinned* versions before any browsing — more reliable than inferring from prose, and it makes the
  cache key precise. *Done when:* a repo with a lockfile yields a versioned inventory with zero prose
  inference.
- **Portable component-intel packs.** Formalize the per-`name@version` cache into a committable,
  schema'd "intel pack" (verified facts, risks, evidence) that a team can share across repos and that
  seeds future runs instantly. Local-first today; the seed of a genuine data network effect tomorrow.
  *Done when:* one project's intel pack, dropped into a second project, pre-populates matching
  components with full provenance.

## Prove it — the benchmark that doubles as a regression guard

- **Public catch-rate benchmark.** 10–20 real specs with known traps; publish **precision** (a
  flagged CRITICAL is real) and **false-negative rate** (known traps caught). The artifact that tells
  the market this is serious *and* a regression guard for the prompt itself. *Done when:*
  `examples/benchmark/` holds the specs, expected catches, and a results table linked from the README,
  runnable in CI.

---

## Bigger bets (phase 2 — these cross today's local-first line)

Deliberately out of scope *this cycle* because each needs hosting, an account, or a service of ours —
they change the product's nature and should be a conscious decision, not a drift:

- **Networked community intel registry.** Pool anonymized, verified `name@version` intel across users
  so the corpus — and every catch — compounds across the whole community. This is the real,
  copy-proof moat (a data network effect a retrieval tool can't bolt on) and the natural business
  surface. Needs hosting, curation, and a trust/abuse model. Rung 5's local intel packs are the
  on-ramp to exactly this. *Substantially realized by HiveMind: v0.10.0 pools the
  trap-knowledge half through the registry feed and back down into every subscriber's agents;
  v0.11.0 adds federated identity + spaces (cross-machine and team hives syncing signed
  experience through `/api/hive/experience`). What remains here is the research-intel half
  (per-`name@version` component intel packs pooling the /brainblast research itself).*
- **MCP server for reports.** Expose `report.json` over MCP so Cursor, Copilot, and other agents query
  a project's research without reading files — distribution into the tools teams already use.
- **Portfolio view.** For an org, one dashboard of unaddressed CRITICALs across every service — sells
  to the buyer (the eng lead), not just the IC.

## Non-goals (this cycle)

Writing or running production implementation code; a hosted SaaS backend; a web dashboard; anything
requiring an account or API key of ours. Brainblast stays a **local, file-based workflow** — the
phase-2 bets above are the explicit, deliberate exception, to be picked up only after Rungs 2–5 prove
the value locally.

## How we'll know it worked

1. **Correctness** — benchmark precision on flagged CRITICALs and false-negative rate on known traps.
   The real proof.
2. **Permanence** — generated guardrails committed in a real repo; a CRITICAL that *cannot* silently
   regress because a test now fails on it.
3. **Retention** — drift watch running on a schedule in at least one external project. A tool you
   keep, not a tool you ran once.
4. **Adoption** — `report.json` consumed by a real CI gate (and, phase 2, an MCP client). A tool
   people gate their builds on has arrived.
