# Brainblast → AI Training-Data Platform: Roadmap

**Last updated:** 2026-07-09 · anchored at **v0.11.0** ("HiveMind federation" — cross-machine + team hives, on top of v0.10.0's shared second brain)
**Current state:** Stage 0 shipped · Stages 1–4 engineering substantially landed —
**every no-spend core now exists**, including the Stage 4 marketplace surface
(catalog + signed-grant entitlement + metered usage ledger) and, as of v0.9.8, a
scout fleet whose proof gate is no longer capped at static TS/Rust shapes (R7 —
oracle-backed gate, self-extending checkers, multi-language proving). Corpus at
**15 VTIs**. What remains is what *spends*: on-chain `$BRAIN` settlement
(Stages 2–4), scout supply *at scale* (Stage 3 — the engine is now maximally
capable; running it wide is the lever), and go-to-market (buyer pilots).
**Companion to:** [`ROADMAP.md`](ROADMAP.md) (the core *Predict → Enforce → Watch → Compound* ladder)
**On-chain substrate:** [`WALLET-PLAN.md`](WALLET-PLAN.md) — the Agent Wallet (capped, Vault-recoverable ops wallet) is the rail the deferred `$BRAIN` stake/dividend flows in Stages 2 & 4 settle on.

> **Legend:** ✅ shipped · ◐ in progress · ☐ not started. This document is a live
> reference and is updated at the end of every task.

---

## Product North Stars (two invariants every remaining task must honor)

These were set after the marketplace surface landed. They are not stages — they
are **constraints on how the remaining stages are built**. Any task that violates
one is wrong, however much else it ships.

1. **The marketplace is free-flowing & easily accessible.** The catalog and the
   `sample` tier are **always public and anonymous — no signup, no key, no
   payment** to browse and inspect. All *paid* access is **self-serve** (prove a
   wallet's `$BRAIN`/payment → a grant is **issued** automatically — a grant is a
   signed access credential, nothing is token-minted); a human issuer is never in
   the critical path. Friction exists only at the trainable-payload boundary,
   never at discovery.
2. **Data/VTI intake is streamlined & automatic.** Producing a new verified trap
   must **never block on spend**. Scout Phases 1–4 (research → prove → package →
   submit) are no-spend and are the default; staking is an *optional bond* layered
   on top. A single `intake` step takes a freshly-proven pack all the way into the
   corpus **and** the storefront. The pipeline should approach: trap found →
   sellable, with no manual glue.

---

## Architecture — the two repos (engine vs. storefront)

The marketplace is **two repos with distinct jobs**, not duplicates. `brainblast`
is the **engine, factory & rulebook**; `brainblast-registry` is the **public
storefront** (`registry.brainblast.tech`). The registry contains *no original
market logic* — it **vendors** brainblast's `distribution` modules and serves them
over HTTP. One brain, two front-ends: a CLI and a website.

| Capability | Repo | Form |
|---|---|---|
| Produce the data (scout → intake → corpus → SLA → packaged lots) | `brainblast` | CLI/scripts + committed `datasets/` |
| The data itself (the VTI lots) | `brainblast` | `datasets/v0.1.0/…` |
| Market **logic** (catalog, grant sign/verify, feed tiering, metering chain, the request handler) | `brainblast` | `src/{marketplace,feed,server}.ts` — pure, tested |
| Operator CLI (`catalog`/`grant`/`usage`/`feed`/`serve`) + the lean `brainblast/distribution` export | `brainblast` | the npm package |
| Public hosted endpoint (`/api/catalog`, `/api/feed`, `/api/healthz`) | `brainblast-registry` | Next.js routes (vendor brainblast's logic) |
| Live per-buyer usage ledger | `brainblast-registry` | Supabase table |

```
brainblast (engine)                              brainblast-registry (storefront)
───────────────────                              ────────────────────────────────
scout/intake → gen:vti → datasets/ ─(GitHub raw)─▶ lib/vti.ts fetches the lot
src/{marketplace,feed,server}.ts                            │
   └ exported as brainblast/distribution ─(vendored)─▶ lib/brainblast/ + adapter
                                                            ▼
                                           GET /api/catalog (public)
grant keygen/issue (offline) ─ ed25519 grant ─▶ GET /api/feed (gated) ─▶ Supabase ledger
```

- **Supply flows one way:** produced in `brainblast`, published as files, *pulled*
  by the registry.
- **Logic is shared, not duplicated:** the registry vendors the lean subpath so a
  Vercel build never drags in brainblast's native `tree-sitter` deps.
- **Grants are the bridge:** generate a distributor identity offline with the
  brainblast CLI; the registry holds only the *public* address to verify grants.

> Not the marketplace: `brainblast-pack-registry` (a GitHub index of *rule packs*)
> and the registry's older jobs (pack mirror, telemetry, `$BRAIN` staking). The
> distribution endpoint is a new section of `brainblast-registry`.

**One line:** `brainblast` is the engine/factory/rulebook; `brainblast-registry`
is the storefront a buyer touches. Neither is "the marketplace" alone.

---

## ⭐ Done vs. Remaining — the authoritative ledger

This is the single source of truth for status. The detailed per-stage sections
below are the *reference*; **this table and the ordered plan that follows are what
we execute against.**

### ✅ DONE (runs today — 702 tests green, 1 skipped)

| Capability | Surface | Stage |
|---|---|---|
| VTI schema + generator (RED→GREEN-gated) | `schema/vti.schema.json`, `npm run gen:vti` | 0 |
| Packaged dataset (sample/full lots, datasheet, SHA256SUMS, pricing) | `npm run pack:dataset`, `datasets/v0.1.0/` | 1.2 |
| Eval/benchmark harness (oracle = our checker) | `npm run bench`, `bench/` | 1.3 |
| Consent-safe contribution (secret-scan → repro → license → separate lot) | `npm run ingest:vti`, opt-in `fix --apply` capture | 2.1–2.3 |
| Corpus intelligence (score, dedup, class×SDK coverage map) | `npm run corpus`, `datasets/COVERAGE.md` | 3.2–3.3 |
| Quality/integrity SLA (re-prove all RED→GREEN, schema, drift; CI gate) | `npm run sla`, `datasets/SLA.md` | 3.5 |
| Streaming delta feed (NDJSON, `--since` cursor, filters, receipts) | `brainblast feed`, `brainblast_recall` (MCP) | 4.1, 4.5 |
| Tiered access *eligibility* (`sample/standard/firehose`, wallet→tier) | `feed --tier` / `--wallet-tier` | 4.4 |
| **Marketplace surface (local-first):** storefront + signed-grant entitlement + metered usage ledger | `brainblast catalog` / `grant` / `usage`, `feed --grant`, `npm run catalog` | 4.2 |
| **Automatic intake conveyor** + stake-free scout default (R1) | `npm run intake` (`gen:vti→pack:dataset→corpus→catalog`), scout Phase 5 opt-in | 1.1 / 3.1 |
| **ed25519 grants** — publicly verifiable (R2) | `grant keygen`, `BRAINBLAST_MARKET_KEY`/`PUBKEY`, `src/base58.ts` (HMAC kept for back-compat) | 4.2→4.3 |
| **Distribution endpoint (R3)** — reference server + deployed into the registry | `brainblast serve` + `feed --remote`; `brainblast/distribution` subpath; `registry.brainblast.tech` `/api/catalog` + `/api/feed` + `/api/healthz` (brainblast-registry#14) | 4.2→4.3 |
| **Self-serve access sizing (R4 core)** — `$BRAIN` held → tier | `accessQuote`, `grant quote` / `grant issue --for-brain\|--wallet` | 4.3 |
| **Scout fleet (R7)** — autonomous: discover → subagent-scout → prove → promote → ledger; proof gate is the **generalized oracle** (static/compiler/executed/differential), the fleet can **propose its own checkers** (soundness meta-gate + human ratification), and proves **multi-language** (Python) behavioral traps | `npm run fleet[:discover\|:ledger\|:checker-gate]`, `brainblast-fleet` skill, `proveFinding`→`proveWithBest`, Supabase `fleet_ledger`; corpus 9→12→**15** | 3.1 |
| **HiveMind (v0.10.0)** — the consumption-side flywheel: the VTI stream flows BACK into every user's agents. Machine-global hive (feed-delta sync + blob-verified public-pack mirror), session-start briefs (`hive_brief` MCP + CLAUDE.md injection), write-time correction hook, hive-loaded audits, outbreak alerts, cross-repo experience, anonymized demand signal → fleet work-orders (`npm run corpus`), contribute conveyor | `brainblast hive sync\|status\|brief\|link\|stats\|contribute\|hook`, `src/hive/`, PRs #77–#81 | 4.5 / 5.5 (Compound) |
| **HiveMind federation (v0.11.0)** — cross-machine + team hives: local ed25519 identity, `hs_…` space capabilities (no accounts — the id is membership, the signature is attribution), signed experience batches, `/hive/experience` on the pure handler + `brainblast serve` + the hosted registry (brainblast-registry#57, Supabase + per-IP cap). Experience stays advisory — never enters the proven corpus | `brainblast hive id\|space create\|join\|list\|leave`, federation leg in `hive sync`, `src/hive/{identity,federation,spaces}.ts` | 4.5 / 5.5 (Compound) |

### ☐ REMAINING (nothing below is half-built — these have not started)

| Work | Why it's not done yet | Stage |
|---|---|---|
| **Apply the `fleet_ledger`/`fleet_ledger_audit` migration to prod Supabase** (`brainblast-registry/supabase/schema.sql`) | `/api/fleet-ledger` on the LIVE registry 500s — "Could not find the table 'public.fleet_ledger'". Confirmed 2026-07-02: `/api/healthz`, `/api/catalog`, `/api/feed` are all live and correct (R3 core IS fully deployed); this one newer table (added after the base schema was applied) was never pushed. The fleet degrades gracefully to a local-only cache in the meantime (no crash), it just loses cross-fleet dedup until this is applied — needs Supabase dashboard/CLI access | 3.1 |
| **On-chain settlement** (pay `$BRAIN`/USDC → auto-issue grant; USDC→buyback) | spends funds | 4.3 |
| **Stake-and-slash on VTIs + data-dividend payout** | spends funds (repro gate is the slash trigger, already built) | 2.4–2.5 |
| **Curation market** (stake to up-rank; reward accurate curators) | spends funds; needs on-chain rails | 3.4 |
| **Run the scout fleet at scale** (N≥50 SDKs, freshness-first) | engine DONE (`npm run fleet`); running it broadly is the lever, not code | 3.1 |
| **Buyer pilots** (≥1 paid pilot / LOI) | outreach | 1.4–1.5 |
| **Public benchmark + private eval product** | depends on a corpus worth citing | 5.1–5.2 |
| **Governance + mature dividend/burn + documented compounding loop** | end-state; depends on all above | 5.3–5.5 |

---

## 🧭 Remaining work — execute in THIS exact order

Each item is tagged `[no-spend]` / `[infra]` / `[spend]` / `[outreach]`. **Do not
start an item until every item above it is ✅** unless the tag explicitly says it
runs in parallel. Update the checkbox and the ledger above at the end of each.

> **Why this order:** the two no-spend engineering items (R1, R2) unblock both
> North Stars and cost nothing. R3 makes the market *public* without yet spending.
> Only then do we turn on money (R4–R6) and scale supply (R7). GTM (R8) runs in
> parallel from now. R9–R10 are the end-state.

- ✅ **R1 — Stake-free scout + automatic intake. `[no-spend]` — DONE (v0.9.5).**
  Serves North Star #2. (a) `.claude/skills/brainblast-scout/SKILL.md` reframed:
  Phases 1–4 are the no-spend default and **Phase 5 (stake) is an explicit opt-in
  bond**, run only when the ops-wallet + caps are set; the description no longer
  implies staking is required. (b) **`npm run intake`** (`scripts/intake.ts`)
  chains `gen:vti → pack:dataset → corpus → catalog`; `--pack <dir>` validates the
  pack RED→GREEN first and is fail-closed. *(Implemented as an `npm run` script —
  consistent with the rest of the data-factory family `gen:vti`/`pack:dataset`/
  `corpus`/`catalog`/`sla`, which are all npm scripts, not CLI verbs; intake is a
  repo-operator command that regenerates committed `datasets/` artifacts.)*
  **Exit met:** a bundled pack the committed corpus had drifted past was ingested
  end-to-end with no `$BRAIN` and no manual glue (8 → 9 VTIs, 5 → 6 classes,
  `npm run sla` green). 3 fail-closed-gate tests; suite 655 pass / 1 skip.

- ✅ **R2 — ed25519 grants. `[no-spend]` — DONE.**
  Foundation for a multi-party market + North Star #1. `issueGrant` / `verifyGrant`
  in `src/marketplace.ts` now sign with **ed25519** by default (legacy HMAC still
  verified, selected by the grant's `alg`). The distributor holds a private key and
  **publishes its base58 address**; `verifyGrant` needs only that address — no
  shared secret. `brainblast grant keygen` generates the identity (`node:crypto`
  ed25519, same seed/pubkey shape as the wallet); `grant issue` reads
  `BRAINBLAST_MARKET_KEY`; `grant verify` / `feed --grant` read
  `BRAINBLAST_MARKET_PUBKEY` (or `--pubkey`). Trust is explicit — a grant from an
  untrusted signer fails `untrusted-signer`, never defaulting to the grant's own
  signer. base58 vendored (`src/base58.ts`). **Exit met:** verify works with only
  the public key; forged tier / swapped signer / untrusted distributor all fail;
  legacy + pre-R2 grants still verify; 662 pass / 1 skip.

- ✅ **R3 — Hosted distribution endpoint. `[infra]` — DONE, confirmed LIVE 2026-07-02.**
  The "public" in public market, where "entitlement enforced at distribution"
  becomes literally true. **`brainblast serve`** (`src/server.ts` + the CLI
  binding) is a zero-dep `node:http` server that: (a) serves the **catalog
  publicly + anonymous** (North Star #1); (b) serves `/feed` — anonymous → sample
  tier, or with an `x-brainblast-grant` header → the **entitled** tier, verified
  with only the distributor's published ed25519 address (R2, no secret); (c) holds
  the full lots and writes the **authoritative hash-chained usage ledger**
  server-side (rejected pulls aren't metered; a broken ledger fail-closes). The
  local CLI is now a client: **`brainblast feed --remote <url> --grant <file>`**.
  11 handler tests; verified end-to-end (remote client streams the entitled delta;
  forged-tier + untrusted-distributor → 403; server-side metering). **Deployed**
  into `registry.brainblast.tech` (Next.js + Supabase): `/api/catalog`, `/api/feed`,
  `/api/healthz` (brainblast-registry#14), reusing the EXACT handler via the lean
  **`brainblast/distribution`** subpath (vendored there so Vercel never pulls the
  auditor's native deps); the usage ledger is a hash-chained Supabase table. Live
  smoke test green. **Exit met:** a third party with only a grant + the URL pulls
  its entitled delta; the server holds the payload, the client never sees more than
  its tier. **Exit met, and directly re-verified against production:**
  `curl https://registry.brainblast.tech/api/healthz` → `{"status":"ok","lots":1,
  "vtis":15}`; `/api/catalog` and `/api/feed` (anonymous sample tier) both return
  200 with correct data. The `usage_ledger` migration and `BRAINBLAST_MARKET_PUBKEY`
  are evidently already set — R3 has nothing outstanding. (One newer, unrelated
  table gap found in the same check: `fleet_ledger` — see R7 below.)

- ◐ **R4 — On-chain settlement + self-serve grants. `[spend]` — no-spend core DONE.**
  Closes North Star #1's "self-serve" requirement. **Done (no-spend):**
  `accessQuote(brainHeld)` maps a balance → tier + price + upgrade hint;
  `brainblast grant quote --brain N|--wallet` shows eligibility (no key), and
  `grant issue --for-brain N|--wallet` SIZES the tier from `$BRAIN` held instead of
  a hardcoded `--tier`. The issuing key stays local; no funds move. **Remaining
  (spend/secret — your call):** *server-side* auto-issuance (the registry holding
  the issuing key so grants issue without a human), the pay → treasury → grant flow,
  and USDC → **buyback-and-distribute** to the contributor/burn pool (generalizing
  the wallet's capped spend-gate into the buyer-side path). **Exit:** a buyer
  self-serves a *paid* grant end-to-end with no human issuer; one USDC sale
  triggers a buyback.

- ☐ **R5 — Stake-and-slash on VTIs + data dividend. `[spend]`.** (Stage 2.4–2.5)
  Extend `scripts/agent-stake` (and the in-core `wallet stake`) from "stake on a
  pack" to **bond on a contributed VTI**; the already-built reproduction gate is
  the **slash trigger**. When a VTI sells/streams, pay the contributor a `$BRAIN`
  **dividend** weighted by corroboration × severity. **Exit:** first bond posted,
  first non-reproducing submission slashed, first dividend paid.

- ☐ **R6 — Curation market. `[spend]`.** (Stage 3.4)
  Holders stake `$BRAIN` to up-rank traps they believe labs will buy; accurate
  curators earn, the rest lose. Built on the existing `score`/coverage/SLA surface.
  **Exit:** curation stake measurably reweights what scout produces next.

- ◐ **R7 — Scout fleet. `[no-spend engine maximally capable; scaling is the lever]`**
  (Stage 3.1) **Engine DONE:** `npm run fleet` (`scripts/fleet.ts`) discovers
  candidate Findings in `fleet/candidates/`, **proves each RED→GREEN** (shared
  `proveFinding` gate), **auto-promotes** the proven into `packs/`, runs intake,
  and prints a **scoreboard** (landed / drafted / corpus delta / next work-orders →
  `fleet/REPORT.md`). Expandable (drop a candidate, re-run; `fleet/README.md`) and
  the `brainblast-scout` skill is fleet-aware. The `object-arg-property-forbidden-
  literal` checker now matches boolean flags too (insecure-default footguns).
  **Seeded with 3 real auth-bypass traps → corpus 9 → 12, the auth-bypass class
  now covered; SLA 12/12 green.**
  **Autonomy layer DONE:** the fleet now sources its own targets instead of waiting
  for hand-dropped candidates. `npm run fleet:discover -- --sdk <pkg>` scours
  npm + GitHub for popular dependent repos (ranked by stars, ledger-filtered); the
  **`brainblast-fleet` skill** fans out a **subagent per repo** to scout each one
  (the agent already running Brainblast is the model — no API key); proven
  candidates promote via the gate; `npm run fleet:ledger` records investigated
  repos to a **shared Supabase `fleet_ledger`** (local-cache fallback, griefing-
  defended server-side: rate limit, GitHub repo verification, non-destructive
  merge, freshness TTL) so sibling fleets skip them. Submission is gated on `sla` +
  typecheck; direct-to-main is opt-in. Demonstrated: 99 real `jsonwebtoken`
  dependents discovered, recorded, and skipped on re-run.
  **Capability ceiling raised — 3 Moves (v0.9.8), engine DONE:** the fleet's proof
  gate was structurally capped at *static AST shapes in TS/Rust*. Three moves
  removed that: **(1)** the gate (`proveFinding`) now routes through the
  **generalized oracle** (`proveWithBest`: static → compiler → executed →
  differential), proving compiler-detectable (hallucinated/moved APIs) and
  **behavioral** footguns, not just shapes; **(2) self-extending checkers** — a
  proposal (`fleet/checker-proposals/<kind>/`) is vetted by
  **`npm run fleet:checker-gate`** (purity, proves its own trap, zero false
  positives on the known-good corpus, determinism), then `--wire` installs it for
  **human ratification**; **(3) multi-language behavioral proving** — a
  `LangRunner` abstraction (`src/oracle/backends/differential.ts`) adds **Python**;
  each further language is one runner. Landed a novel-shape JWT `alg:none` trap
  (needed a new checker) and a Python fee-truncation trap (needed a differential
  proof, no static shape) neither the old gate could reach. **Corpus 12 → 15.**
  **Remaining (the lever, not code):** *run it at scale* — point the fleet at the
  work-orders the scoreboard names, freshness-first, toward a sellable N across
  N≥50 SDKs. *(No-spend; staking each pack stays optional per R1.)*
  **Real-world run, 2026-07-02:** discovered + scouted 10 real repos (7 for
  `@metaplex-foundation/mpl-token-metadata`, targeting the uncovered
  immutable-after-deploy class; 3 for `jsonwebtoken`, targeting auth-bypass
  corroboration) with 10 parallel subagents. All 10 reported honestly clean —
  no candidate fit the vetted checker shapes in these specific repos, and
  correctly none were fabricated to force a landing (the discipline held under
  real load, not just synthetic tests). One subagent surfaced a genuinely
  common, real footgun with no existing checker — a hardcoded fallback secret
  (`process.env.JWT_SECRET || 'somethingsecret'`) — but it doesn't fit the
  current function-scoped candidate-detection architecture
  (`src/finder.ts::findCandidates`, which only considers code inside a
  function matching `detect.nameRegex`/`triggerCalls`) without synthesizing an
  artificial function wrapper around module-scope config code, which would be
  forcing the fit — left undone rather than compromising the "never fabricate"
  invariant. **Good next-run candidate:** a Move-2 checker for
  "`process.env.<SECRET-shaped-name>` with a hardcoded string fallback" is a
  real, common, valuable trap — needs either (a) a genuine in-function example
  from further scouting, or (b) extending the candidate-finder to also
  consider module-scope object-literal assignments, not just function bodies.
  **Also found:** the shared `fleet_ledger` table is missing on prod Supabase
  (see the REMAINING ledger above) — the fleet degraded gracefully to its
  documented local-cache fallback rather than crashing, confirming that
  resilience path works for real, but cross-fleet dedup isn't actually live
  yet.
  **Second real-world run, same day:** 8 more repos scouted (5 for
  `@raydium-io/raydium-sdk-v2` targeting `missing-slippage-guard`
  corroboration, 3 for `@pythnetwork/*` targeting `unchecked-staleness`
  corroboration) plus 1 targeted follow-up on a lead a scout surfaced.
  **Corpus unchanged at 15** — `npm run fleet` confirms zero promotions this
  round — but the run surfaced two more precisely-scoped future checker
  targets, on top of the hardcoded-secret one above, all left undone rather
  than forced:
  - **A nested-call-argument shape.** `sendaifun/solana-agent-kit` has a real
    `@orca-so/whirlpools-sdk` zero-slippage-tolerance call —
    `slippageTolerance: Percentage.fromFraction(0, 100)` inside an options
    object — but the value is a *nested CallExpression*, not a plain literal.
    `object-arg-property-forbidden-literal` only recognizes
    string/number/boolean literals (plus one special-cased `new BN(0)` gate);
    it can't evaluate a nested call's own arguments. A Move-2 checker
    proposal here (something like "options-object property whose value is a
    call, inspect THAT call's arguments") would unlock this instance and
    likely others across the ecosystem — `Percentage.fromFraction`,
    `BN.from`, and similar wrapper-constructor patterns are common.
  - **Solidity has zero language support today.** `pyth-network/pyth-crosschain`
    yielded a strong, well-documented finding: Pyth's own official
    `PythAggregatorV3.sol` Chainlink-compatibility shim (meant to be deployed
    directly by integrators) calls `getPriceUnsafe()` with no staleness
    check, in `latestAnswer()`/`latestTimestamp()`/`getRoundData()`/
    `latestRoundData()`. `npm run fleet` correctly drafted this — the static
    engine only walks `.ts`/`.rs` (`src/walk.ts`/`src/rustFinder.ts`), there
    is no Solidity parser anywhere in the codebase, so RED never triggers.
    The finding is real and valuable (a widely-forkable Chainlink-shim
    pattern with a genuine copy-paste-outward risk); the gap is capability,
    not data. Adding Solidity is a bigger lift than the TS-language-runner
    pattern from Move 3 (needs an AST library, e.g. `solidity-parser-antlr`
    or similar, not just a new `LangRunner` on the existing oracle) but is
    now a concretely evidenced, high-value next language.
  All 18 repos scouted today (10 + 8) stayed disciplined — zero fabricated
  findings, several correctly identified as using a different oracle/SDK/API
  shape than expected rather than forcing a match.

- ☐ **R8 — Buyer pilots. `[outreach]` — run in parallel from now.**
  (Stage 1.4–1.5) Take `datasets/CATALOG.md` + `datasets/v0.1.0/sample/` + a
  benchmark scorecard to 5–10 target buyers. Capture format fit, freshness value,
  licensing bar, willingness to pay, settlement-rail preference. **Exit:** ≥1 paid
  pilot or signed LOI; buyer requirements documented.

- ☐ **R9 — Public benchmark + private eval product. `[infra/outreach]`.**
  (Stage 5.1–5.2) Publish the versioned, always-fresh "does model X ship this
  silent failure?" benchmark (free, a marketing surface); sell held-out VTI suites
  as recurring evals. **Exit:** benchmark public + cited; first recurring eval
  contract.

- ☐ **R10 — Governance + mature token loop. `[spend]`.**
  (Stage 5.3–5.5) `$BRAIN` stake-weighted votes on licensing/taxonomy/slashing;
  steady-state revenue → buyback → dividend/burn, documented end-to-end; the
  Compound rung (every customer-CI fix can opt-in to become tomorrow's VTI) wired
  to close the flywheel. **Exit:** the loop self-sustains (revenue ≥ emissions
  value) and its accounting is public.

- ◐ **R11 — Direct git-less ingest API. `[infra]` — core DONE, endpoint deploy remaining.**
  Serves North Star #2 at scale. A PR per submission doesn't survive hundreds of
  contributions a day; VTIs must be able to feed straight into the database. The
  piece that makes a git-less write *safe* is built and tested in-repo:
  **`ingestSubmission`** (`src/contrib/submit.ts`) runs the SAME gates as file/PR
  intake on an untrusted single-shot Finding — shape validation + vetted-kind
  check (fail-closed), Keyguard secret scan, RED→GREEN re-proof under the
  **hardened "ingest" sandbox**, consent stamp — and returns a verdict + the
  minted `contributor-grant-v1` VTI. A pluggable **`VtiStore`**
  (`src/contrib/store.ts`; JSONL locally, swap for Supabase) is the DB seam
  (idempotent, non-destructive, like the ledger). A runnable reference server
  (`scripts/registry-server.ts`, `npm run registry:serve`) exposes
  **`POST /api/vti`** (re-prove → insert, `201`/`200`-duplicate/`422`-rejected)
  and **`GET /api/vti`** (open sample-tier teasers, no fixtures); a client
  (`npm run submit:vti -- --candidate <file>`, `--dry-run` runs the identical
  gate locally) mirrors the fleet-ledger pattern.
  **The three "before you flip it on" items are now DONE (in-repo, tested):**
  **(a) Supabase store** — `SupabaseVtiStore` (`src/contrib/store.ts`) talks
  PostgREST over `fetch` (no SDK dep); `storeFromEnv` picks it up from
  `SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY`, PK + `ignore-duplicates` gives
  DB-level idempotency (migration in `datasets/contrib/README.md`).
  **(b) Auth decision** — OPEN by default (the gates are the guard, per the
  "prefer simple, open designs" bar), with a per-IP fixed-window
  `RateLimiter` (default 30 POST/min) and an optional `BRAINBLAST_INGEST_TOKEN`
  to close POST. **(c) Provenance / anti-fabrication** — `verifyProvenance`
  (`src/contrib/provenance.ts`) requires each submission to cite a
  **commit-pinned** source (`owner/repo@<sha>:path`; a mutable branch is
  rejected) + a verbatim `evidence` snippet, then FETCHES that exact file at that
  exact commit and confirms the vulnerable line is really there — the check that
  replaces human PR review, since RED→GREEN can't tell an invented-but-reproducing
  fixture from a real find. On by default at the server. **Verified:** 32 contrib
  tests + a live round-trip that landed a real trap
  (`solana-hive-sendtransaction-skippreflight`, provenance confirmed against a
  real `ask-the-hive/the-hive` commit) and REJECTED a fabricated variant (evidence
  not at the commit) with 422; 429 rate-limiting confirmed.
  **Registry endpoint BUILT + PR'd (brainblast-registry#21).** Discovery: the
  registry is a deliberately lean data layer (no `ts-morph`, vendors only pure
  slices), so the deployed `POST /api/vti` runs the gates that fit the edge —
  **shape + secret-scan + provenance** (all pure, un-fakeable server-side) — and
  the heavy RED→GREEN reproduction stays where ts-morph already lives (client
  `submit:vti` + an async brainblast-side re-proof that flips `proof_verified`;
  paid tiers gate on that flag, matching the registry's existing cron pattern).
  Added: `app/api/vti/route.ts` (open + per-IP hourly cap, idempotent upsert),
  `lib/vtiIngest.ts`, vendored `lib/brainblast/{detect,provenance}.ts`, and the
  `vtis` + `vti_ingest_audit` migration. `tsc` clean; gate verified against real
  GitHub. **Remaining (repo-owner creds only):** apply
  `supabase/migrations/0001_vtis.sql` to prod Supabase, then merge #21 → Vercel
  auto-deploys (no new env). **Exit:** a contributor lands a provenance-verified
  VTI in the live corpus via one POST, no fork/PR.

**Legal gate (applies before R3 opens anything to the public):** open the
**owned synthetic corpus** publicly first (zero consent obligation). Contributed
lots stay behind `contributor-grant-v1` separation until the consent/revocation
flow is hardened for a public audience.

---

## What's shipped so far

Everything below runs today (702 tests green, 1 skipped):

- **The data asset exists.** `npm run gen:vti` turns Brainblast's own proven packs
  into schema-valid [Verified Trap Instances](datasets/seed/README.md) — only when
  a pack proves RED→GREEN through the real `validatePack` gate. Schema:
  [`schema/vti.schema.json`](schema/vti.schema.json).
- **It's a packaged product.** `npm run pack:dataset` emits versioned
  [`datasets/v0.1.0/`](datasets/v0.1.0/) — an open `sample` lot, a `$BRAIN`-gated
  `full` lot, a datasheet, and `SHA256SUMS`, with the access/pricing model
  (USD price, 10% `$BRAIN` discount, USDC→buyback) in `index.json`.
- **The eval wedge runs.** `npm run bench` ([`bench/`](bench/)) grades model code
  with Brainblast's own checker as the oracle (RED = trap shipped, GREEN =
  avoided); `--self-test` proves the oracle, `--submissions` scores + gates CI.
- **Contribution is consent-safe.** `npm run ingest:vti` enforces three gates —
  secret scan, RED→GREEN reproduction, consent/license — and writes to a
  physically separate, git-ignored lot. `brainblast fix --apply` can (opt-in)
  capture real fixes and drain them through the same gate.
- **The corpus is managed and self-verifying.** `npm run corpus` scores every VTI
  (severity × proof × corroboration), de-dups, and emits a class×SDK coverage map
  ([`datasets/COVERAGE.md`](datasets/COVERAGE.md)) that doubles as scout's
  work-orders. `npm run sla` re-proves the whole corpus still goes RED→GREEN,
  re-validates the schema, checks seed↔packaged drift, and **exits non-zero on any
  regression** ([`datasets/SLA.md`](datasets/SLA.md)) — the contractual integrity
  surface for selling.
- **It's a marketplace, not just a dataset.** `npm run catalog` emits the
  buyer-facing storefront ([`datasets/CATALOG.md`](datasets/CATALOG.md) + JSON):
  coverage, freshness, the tier/price ladder, and receipt-only teasers.
  `brainblast grant issue|verify` signs an access grant (buyer/tier/lot-scope/
  expiry) that `brainblast feed --grant` enforces at distribution — so a buyer
  can't self-assert a tier — and every grant-backed pull is metered to a
  hash-chained ledger that `brainblast usage` verifies + summarizes per buyer.
  Settlement stays out-of-band (it spends funds); this surface quotes price and
  accounts usage, never moves money.

**Remaining** is enumerated and sequenced in the
[Done vs. Remaining ledger](#-done-vs-remaining--the-authoritative-ledger) and the
[ordered R1–R10 plan](#-remaining-work--execute-in-this-exact-order) above. In one
line: two no-spend engineering items (stake-free intake; ed25519 grants), then
public hosting, then the on-chain money/stake/dividend rails, supply at scale, and
go-to-market. Each per-stage section below is the detailed reference.

---

## The thesis in one paragraph

Brainblast already produces, at the moment of every confirmed fix, the single
most valuable and scarcest artifact in the AI training-data market: a
**verified error→fix→test→proof record, pinned to a specific SDK version, with
source provenance and multi-repo corroboration.** The $7.5B market is drowning in
*unlabeled, unverified* scraped code and slow, expensive human labels. It is
starving for **machine-verified, reward-gradable, fresh** data on *current* APIs.
We don't need to build a data company from scratch — we need to *capture, clean,
consent, scale, and stream* an asset the product already manufactures as a
by-product. This roadmap takes us from "we throw that asset away after hashing it"
to "a real-time, verifiable, RL-grade data + eval feed, settled in `$BRAIN`."

### The unit of value: the Verified Trap Instance (VTI)

Everything below is organized around one artifact. A VTI is the sellable atom:

```jsonc
{
  "trap_id":            "metaplex-seller-fee-zero",
  "sdk":                "@metaplex-foundation/mpl-token-metadata@3.2.0",
  "vulnerable_snippet": "...",          // RED fixture
  "fixed_snippet":      "...",          // GREEN fixture
  "generated_test":     "...",          // the durable regression test
  "red_green_proof":    { "red": true, "green": true, "ts": "..." },
  "source_urls":        ["https://docs..."],   // live-fetched provenance
  "severity":           "CRITICAL",
  "class":              "silent-zero-revenue",
  "corroboration_count": 7,             // distinct repos that confirmed the fix
  "license":            "synthetic-owned | contributor-grant-v1",
  "consent_scope":      "owned | opt-in:train+eval",
  "captured_at":        "2026-..."
}
```

This schema is as sacred as `report.json` is today. It is the contract every
stage below produces, validates, prices, and streams against.

### What we are **not** claiming

We do not run anyone's gradient updates. "Train models in real time" means we
deliver a **continuously-updated, verifiable RL-grade dataset + eval feed** that a
lab plugs into *its own* training/eval loop. Honesty here is non-negotiable — we
are a tool people gate builds on; the data business must inherit that credibility.

---

## Token model: `$BRAIN` as the native settlement, incentive & quality layer

`$BRAIN` is not bolted on at the end — it is the coordination mechanism for a
two-sided data market (contributors who supply VTIs, labs who buy them). Design
principles, applied in every stage:

| Function | Mechanism | Why `$BRAIN` (not just USDC) |
|---|---|---|
| **Pay for data / feed access** | Subscriptions & metered pulls priced in USD, **payable in `$BRAIN` at a standing discount** (the 10% precedent already in `scripts/agent-stake`) | Creates the primary demand sink; discount makes `$BRAIN` the rational way to pay |
| **USDC fallback → buyback** | Buyers who insist on USDC pay full price; treasury programmatically **buys back `$BRAIN`** with that USDC and routes it to the contributor-reward + burn pool | Every dollar of revenue becomes buy pressure + supply distributed to suppliers |
| **Quality staking (anti-poisoning)** | Contributors **stake `$BRAIN`** behind a submitted pack/VTI; bad/fraudulent data is **slashed** | Extends today's `brainblast-scout` stake flow into a data-integrity bond |
| **Data dividend** | When a VTI sells/streams, the contributors whose packs produced it earn `$BRAIN` from the reward pool, weighted by corroboration | Turns the existing graduation flywheel into a revenue share; aligns supply |
| **Curation signal** | Stake `$BRAIN` to up-rank high-value traps; earn on usage, lose on disuse | Markets allocate scout effort to the data labs actually buy |
| **Governance** | Stake-weighted vote on dataset licensing terms, severity taxonomy, slashing disputes | Decentralizes the rules of a market `$BRAIN` holders depend on |

**One-line summary:** USDC is the on-ramp; **`$BRAIN` is the unit of access,
the bond on quality, and the dividend on supply.** Buyers are *nudged* into
`$BRAIN`; suppliers are *paid* in `$BRAIN`; quality is *bonded* in `$BRAIN`.

---

## Roadmap at a glance

| Stage | Theme | Engineering | What's left | Exit milestone |
|---|---|---|---|---|
| **0** | Define & capture the VTI | ✅ done | — | VTI schema v1 committed; seed records generate from existing packs |
| **1** | Owned synthetic seed corpus + buyer validation | ✅ done | supply (R7), pilots (R8) | License-clean seed dataset + ≥1 paid pilot / signed LOI |
| **2** | Consent & contribution pipeline | ✅ core done | stake-slash + dividend (R5) | First consented user VTIs flowing; first `$BRAIN` data dividend paid |
| **3** | The data factory at scale | ✅ core done | scout fleet (R7), curation (R6) | Continuous VTI production across N≥50 SDKs at a quality SLA |
| **4** | Real-time feed + marketplace | ◐ surface done | ed25519 (R2), hosting (R3), settlement (R4) | Live subscription feed with paying customers settling in `$BRAIN`/USDC |
| **5** | Eval/benchmark product + closed flywheel | ☐ not started | benchmark (R9), governance (R10) | Cited public benchmark + recurring eval revenue + self-sustaining token loop |

Stages are a **capability ladder, not a calendar.** The **engineering** for Stages
0–4's no-spend core is done; what's left is sequenced concretely in
[Remaining work — execute in THIS exact order](#-remaining-work--execute-in-this-exact-order)
(R1–R10). Each stage's exit still gates on its milestone holding.

---

## Stage 0 — Define and capture the VTI

**Where we are:** `brainblast fix --apply` confirms RED→GREEN fixes and telemetry
records a *one-way-hashed* `{pack_id, rule_id, repo_hash, user_hash}` event. We
keep the hash and **throw the valuable content away.** Packs already carry the raw
material: `packs/<id>/fixtures/{vulnerable,fixed}/` proven by the `synth-prove`
gate.

**Objective:** Make the sellable artifact *exist* as a first-class, versioned,
schema-validated record — starting from data we already own (our own packs), with
zero consent exposure.

**Steps**
1. **Author the VTI JSON Schema** (`schema/vti.schema.json`), versioned
   `schemaVersion: "1.0"`, mirroring the discipline of `report.schema.json`.
2. **Build the generator** — a script that turns each
   `packs/*/fixtures/{vulnerable,fixed}` + its rule + `synth-prove` result into a
   VTI record. The RED→GREEN proof and `source_urls` come straight from existing
   pack metadata.
3. **Tag provenance & license** on every generated record:
   `license: "synthetic-owned"`, `consent_scope: "owned"`. These are ours
   outright — no user code involved.
4. **Wire corroboration** — join VTIs to the registry's graduation counts
   (distinct repos/users) so `corroboration_count` is populated where telemetry
   exists; default 0 for purely synthetic.
5. **Validation gate in CI** — every emitted VTI must validate against the schema;
   reuse the SHA256SUMS release discipline so the dataset is tamper-evident.

**`$BRAIN` role:** none yet (intentionally) — Stage 0 is pure asset definition.

**Exit milestone:** ✅ `schema/vti.schema.json` committed and CI-validated;
running the generator over today's bundled packs emits a clean, schema-valid
**seed set of VTIs**, every record `synthetic-owned`.

---

## Stage 1 — Owned synthetic seed corpus + buyer validation

**Objective:** Turn the generator's output into a *dataset a buyer would pay for*,
prove demand, and learn the buyer's real requirements — all without touching a
single line of user code.

**Steps**
1. **Expand supply via `brainblast-scout`** — point the scout skill at the top
   ~50 SDKs/protocols to manufacture *new* proven packs → new VTIs. Scout already
   does footgun-hunt → synth-prove → pack → submit; here it doubles as the
   **data factory's first shift.**
2. **Package the dataset** — versioned, licensed lots; a public *sample* lot and a
   gated *full* lot. Ship a datasheet (provenance, schema, license, freshness,
   class distribution) — labs evaluate data on exactly these.
3. **Build the eval harness companion** — a small held-out VTI set framed as a
   benchmark ("does model X ship this silent failure?"). This is the wedge that
   gets a lab on a call.
4. **Buyer discovery** — take the sample + benchmark to 5–10 target buyers (labs,
   eval vendors, coding-agent teams). Capture: format fit, freshness value,
   licensing bar, willingness to pay, preferred settlement rail.
5. **Run ≥1 paid pilot** — a fixed-scope dataset sale or eval engagement, priced
   in USD. Accept USDC; offer the `$BRAIN`-at-discount rail as a soft launch of
   the token utility.

**`$BRAIN` role:** **first live utility** — pilot invoices payable in `$BRAIN` at
a standing discount; USDC accepted but triggers the (initially manual) buyback so
the flywheel is real from dollar one.

**Exit milestone:** ✅ A **license-clean, schema-valid seed dataset + companion
benchmark**, plus **≥1 paid pilot or signed LOI** — demand validated, buyer
requirements documented, `$BRAIN` payment path exercised once end-to-end.

**Progress (`training-data` branch):**
- ◐ **Step 2 — packaging shipped.** `npm run pack:dataset`
  (`packages/core/scripts/pack-dataset.ts`) emits a versioned product under
  `datasets/v0.1.0/`: an open **sample** lot, a `$BRAIN`-gated **full** lot, a
  Datasheets-for-Datasets `datasheet.md`, an `index.json` carrying the access +
  pricing model (USD price, 10% `$BRAIN` discount, USDC→buyback settlement), and
  `SHA256SUMS` for tamper-evidence.
- ✅ **Step 3 — benchmark shipped.** `npm run bench` (`bench/`) grades candidate
  code with Brainblast's own checker as the oracle (RED = trap shipped, GREEN =
  avoided). The `--self-test` baseline proves the oracle end-to-end (vulnerable
  fixtures → 0% avoided, fixed → 100%); `--emit-tasks` publishes leak-free task
  starters; `--submissions` scores model outputs and gates CI at 100%.
- ☐ **Step 1 — supply** is the `brainblast-scout` lever (spends `$BRAIN`; run
  deliberately). Every pack it lands flows automatically into both the dataset
  (`gen:vti` → `pack:dataset`) and the benchmark.
- ☐ **Steps 4–5 — buyer discovery + paid pilot** are go-to-market actions;
  `datasets/v0.1.0/sample/` + the benchmark scorecard are the artifacts to take
  to buyers.

---

## Stage 2 — Consent & contribution pipeline (turn users into supply)

**Objective:** Unlock the supply that scraping can never match — *real* fixes from
*real* repos on *current* APIs — under airtight consent, and pay suppliers in
`$BRAIN`. **This is the stage that kills careless data startups; we do it
deliberately and early.**

**Steps**
1. **Extend telemetry to full VTI capture, opt-in only** — today's hashed event
   gains an explicit, separately-toggled path that captures the *content*
   (snippets/test/proof) **only** with `consent_scope: "opt-in:train+eval"`.
   Default stays hash-only; nothing changes for non-consenting users.
2. **Minimization + anonymization pipeline** — strip identifiers, secrets, and
   proprietary context; keep the smallest snippet that preserves the trap. Reuse
   Keyguard/secret-detection muscle so we never ingest a key.
3. **License grant flow** — a clear contributor license (`contributor-grant-v1`)
   covering train+eval use, with revocation semantics; lots stay **physically
   separated** from `synthetic-owned` data so a consent issue can never
   contaminate the owned corpus.
4. **Anti-poisoning via stake + slash** — extend `scripts/agent-stake` from
   "stake on a pack" to "**bond on contributed VTIs.**" Fraudulent or
   non-reproducing data (fails re-run of RED→GREEN) is **slashed**. Corroboration
   across distinct repos remains the trust signal.
5. **Data dividend** — when consented VTIs sell or stream, contributors earn
   `$BRAIN` from the reward pool, weighted by corroboration and severity. This is
   the graduation bounty pool, evolved into a revenue share.

**`$BRAIN` role:** **two new sinks/flows** — (a) contributors **stake `$BRAIN`** as
a quality bond (slashable); (b) contributors **earn `$BRAIN`** dividends on sales.
Supply is now natively incentivized in the token.

**Exit milestone:** ✅ First **consented, anonymized, license-clean user VTIs**
flowing into a separated lot; **stake-and-slash live**; **first `$BRAIN` data
dividend paid** to a contributor.

**Progress (`training-data` branch):**
- ✅ **Integrity core shipped.** `npm run ingest:vti -- --submission <dir> --trap
  <ruleId>` (`packages/core/src/contrib/ingest.ts`) enforces three hard gates:
  (1) **secret scan** — every file runs through Keyguard's `detectFileSecrets`;
  any keypair/base58-secret/mnemonic refuses the whole submission (fail-closed);
  (2) **reproduction** — the contributed vulnerable/fixed pair is re-proven
  RED→GREEN against the trap's rule (the oracle), the exact gate `$BRAIN`
  slashing keys off; (3) **consent/license** — accepted records are stamped
  `contributor-grant-v1` + the contributor's `consentScope` and appended to a
  **physically separate, git-ignored lot** (`datasets/contrib/`), never the
  owned corpus. Paths are relativized to the submission dir so a contributor's
  absolute filesystem path is never embedded.
- ✅ **Hardening (CSO #A1).** Pack/trap ids are validated against
  `^[a-z0-9][a-z0-9-]*$` in `validatePackManifest`, closing the path-traversal
  vector before untrusted contributed packs are accepted.
- ✅ Tested: accept / secret-reject / repro-reject + id-traversal, 518/518 green.
- ✅ **Step 1 — telemetry capture path shipped.** A *separate, explicit* opt-in
  (`BRAINBLAST_CONTRIBUTE=1` or `.agent-research/config.json {"contribute":…}`,
  **off by default**) makes `brainblast fix --apply` capture the before/after
  *content* of each confirmed RED→GREEN fix to `.agent-research/contrib-staging/`
  — hash-only telemetry is unchanged for everyone else
  (`packages/core/src/contrib/capture.ts`). A secret pre-scan refuses to even
  stage a pair holding a key. `npm run ingest:vti -- --from-staging <dir>` then
  drains staged candidates through the same three gates into the contrib lot.
  Producer → gate → separate lot is now closed end to end.
- ☐ **Steps 4–5 (`$BRAIN` stake-slash + dividend payout)** settle on-chain via
  the `scripts/agent-stake` ops-wallet flow + registry; deferred (spends funds).
  The reproduction gate above is already the slashing trigger.

---

## Stage 3 — The data factory at scale

**Objective:** Move from artisanal packs to an industrial, continuously-producing
supply engine with measurable quality — across enough SDKs to matter to a buyer.

**Steps**
1. **Scale `brainblast-scout` to a fleet** — parallelize across the top N≥50
   SDKs/protocols (and net-new releases) on a schedule. Freshness is the moat:
   prioritize APIs that *shipped recently*, where models are most stale.
2. **Dedup, cluster & quality-score** — collapse near-duplicate VTIs, cluster by
   trap class, and attach a quality score (corroboration × severity × freshness ×
   reproduction-rate). Buyers filter on these.
3. **Class taxonomy & coverage map** — formalize the trap taxonomy (silent-zero-
   revenue, immutable-after-deploy, unchecked-staleness, auth-bypass, wrong-
   constant scaling, …) and publish a coverage heatmap (class × SDK). Gaps become
   scout work orders.
4. **Curation market** — holders stake `$BRAIN` to up-rank traps they believe labs
   will buy; rewards flow to accurate curators, allocating scout effort toward
   real demand instead of guesses.
5. **Quality SLA & freshness guarantee** — define and monitor: % reproducing on
   re-run, median age from SDK release to VTI, false-positive rate. These become
   contractual terms in Stage 4.

**`$BRAIN` role:** **curation staking** directs the factory; quality SLA is what
makes `$BRAIN`-priced access worth a premium.

**Progress (`training-data` branch):**
- ✅ **Steps 2 + 3 — corpus intelligence shipped.** `npm run corpus`
  (`packages/core/src/corpus.ts`) reads every lot (owned seed + the git-ignored
  contributor lot when present) and emits `datasets/corpus-index.json` +
  `datasets/COVERAGE.md`: a deterministic **quality score** per VTI
  (severity × proof × corroboration, saturating at 5 repos), **exact dedup**
  (trapId + SDK + whitespace-normalized snippet), and a **class × SDK coverage
  heatmap** whose thin cells and uncovered classes are scout's work-orders. The
  per-record `score` is the field pricing and the `$BRAIN` curation market key
  off.
- ◐ **Step 1 (scout fleet)** is the supply lever — no-spend, engine now
  maximally capable (R7 Moves 1–3: oracle-backed gate, self-extending checkers,
  multi-language proving). The coverage map tells it exactly where to dig next
  (today: **1 uncovered class** — immutable-after-deploy — and 13 thin cells,
  down from 3 uncovered classes as auth-bypass and wrong-constant got covered).
  Running it wider across N≥50 SDKs is what remains, not capability.
- ✅ **Step 5 — quality SLA / integrity monitor shipped.** `npm run sla`
  (`scripts/corpus-sla.ts`) re-proves every VTI in every lot still goes
  RED→GREEN (the **reproduction-rate SLA** — the freshness/decay signal), and
  exits non-zero on any regression so it gates CI/release. It folds in two
  prior-stage back-fills: **schema re-validation** of every record (Stage 0) and
  a **seed↔packaged-lot drift check** (Stage 1, a gap that previously had no
  guard). Today: 100% reproduction, 100% schema-valid, packaging in sync.
  Emits `datasets/SLA.md` + `datasets/sla.json`. (Sharper "age from SDK release"
  freshness needs release dates — a follow-up; today's age is since capture.)
- ☐ **Step 4 (curation market)** builds on the score/coverage/SLA surface and
  needs the on-chain `$BRAIN` rails.

**Exit milestone:** ✅ **Continuous VTI production across N≥50 SDKs** at a
published quality SLA, with a live coverage heatmap and a working curation market.

---

## Stage 4 — Real-time feed + marketplace

**Objective:** Ship the actual product — not a dataset dump, but a **subscription
to the delta**: newly-verified, newly-corroborated VTIs, filtered to the buyer's
exact stack, settled in `$BRAIN`.

**Steps**
1. **The streaming feed** — extend the NDJSON shape `brainblast watch` already
   emits into a **subscribable VTI stream**, filterable by SDK / protocol / class
   / severity / min-corroboration. Labs subscribe to the freshness delta that
   keeps their models current.
2. **Marketplace surface** — on top of the existing pack registry
   (`registry.brainblast.tech` + the GitHub index), add catalog, datasheets,
   licensing, metered access, and usage accounting per buyer.
3. **Settlement** — metered pulls and subscriptions **priced in USD, paid in
   `$BRAIN` at a discount**; USDC accepted with automatic, on-chain
   **buyback-and-distribute** to the contributor pool + burn. The 10%-discount and
   capped-ops-wallet mechanics from `scripts/agent-stake` generalize into the
   buyer-side payment SDK.
4. **Tiered access** — gated by `$BRAIN` held/staked: sample → standard →
   firehose, with priority/freshness tiers. Staking for access creates a
   structural, non-speculative demand floor.
5. **Reproducibility receipts** — every delivered VTI ships its RED→GREEN proof so
   a buyer can independently verify reward-gradability. This is the credibility
   feature scraped data can never offer.

**`$BRAIN` role:** **the demand engine closes** — access tiers gate on `$BRAIN`;
all revenue either *is* `$BRAIN` (discounted) or *buys* `$BRAIN` (USDC→buyback);
dividends pay suppliers in `$BRAIN`. Full two-sided loop in token.

**Progress (`feat/v0.9.4-vti-feed`, stacked on the v0.9.3 wallet):**
- ✅ **Step 1 — the streaming feed shipped.** `brainblast feed` (`src/feed.ts`)
  reads any VTI lot(s) and emits the corpus as an NDJSON stream — the same
  tail-the-stdout contract as `watch` (`feed_meta` → `vti`… → `feed_complete`).
  **The delta is real:** `--since <cursor>` returns only records newer than the
  caller's last `capturedAt`, and `feed_complete` carries the next cursor, so a
  consumer resumes without re-pulling. Filterable by `--sdk` / `--class` /
  `--severity` (min-and-above) / `--min-corroboration`. Only RED→GREEN-proven
  records are ever emitted.
- ✅ **Step 4 — tiered access shipped (eligibility).** `sample → standard →
  firehose` with per-tier entitlements (record cap, fixtures gating, freshness
  holdback). `--wallet-tier` maps the v0.9.3 wallet's `$BRAIN` balance to a tier
  via `tierForBrain`. **Sample withholds the trainable fixtures** (metadata +
  receipt only — the proof); paid tiers unlock the payload and the fresh delta.
- ✅ **Step 5 — reproducibility receipts shipped.** Every streamed record carries
  its RED→GREEN `receipt` (`red`/`green`/`method`/`verifiedAt`) + `sourceUrls`, so
  a buyer can independently verify reward-gradability.
- ✅ **Step 2 — marketplace surface shipped (local-first).** The feed computed
  tier *eligibility* and deferred "real entitlement is enforced at distribution"
  — that distribution layer now exists (`src/marketplace.ts` + the `catalog` /
  `grant` / `usage` CLI + `feed --grant`). **The storefront:** `brainblast
  catalog` emits a buyer-facing catalog (JSON + committed `datasets/CATALOG.md`)
  — coverage, freshness, the tier/price ladder, and receipt-only teasers
  (`npm run catalog`). **The enforced entitlement:** `brainblast grant
  issue|verify` signs an access grant (buyer/tier/lot-scope/expiry,
  `BRAINBLAST_MARKET_SECRET`); `feed --grant <file>` serves the tier/lots from the
  *verified* grant, so a buyer can no longer self-assert `--tier firehose` (a
  forged tier fails the signature). **The accounting:** every grant-backed pull
  appends to a hash-chained usage ledger; `brainblast usage` verifies the chain +
  summarizes per buyer (the billing basis). 14 tests; suite 652 pass / 1 skip.
- ☐ **Step 3 — on-chain settlement** (USDC→buyback, `$BRAIN` debits) and a hosted
  multi-party registry remain: they spend funds / need infra. The local surface
  *quotes* the price and *accounts* the usage; it never moves money — the same
  honest client/server split as the wallet threat-model note. The HMAC grant is
  structured so production swaps in ed25519 signatures for multi-party
  distribution.

**Exit milestone:** ✅ **Live subscription feed with paying customers**, settled in
`$BRAIN` (and USDC→buyback), tiered access enforced, reproducibility receipts
shipping with every record.

---

## Stage 5 — Eval/benchmark product + the flywheel closes

**Objective:** Capture the second, larger market (everyone *building on* the
models, not just the 5 labs), make the benchmark a cited standard, and let the
token economy run self-sustaining.

**Steps**
1. **Public benchmark** — "Does model X avoid silent integration failures on
   current SDKs?" — published, versioned, and *fresh* (impossible to game by
   training on stale data, because the trap set keeps moving). Free to read; a
   marketing surface that sells the dataset.
2. **Private eval product** — held-out VTI suites sold as recurring evals to labs
   *and* to agent/tooling teams who need to certify their stack. Priced in
   `$BRAIN`/USDC like the feed.
3. **Governance live** — `$BRAIN` stake-weighted votes on licensing terms, the
   trap taxonomy, slashing disputes, and reward-pool parameters. The market's
   rules are owned by the people exposed to them.
4. **Mature data dividend & burn** — steady-state: revenue → buyback → split
   between contributor dividends and burn; emissions (if any) tuned by governance
   against real demand. Document the token's full sink/flow accounting publicly.
5. **Compounding loop** — every fix in a customer's CI (Brainblast's *Compound*
   rung) can opt-in to become tomorrow's VTI; every VTI sold funds scout effort
   and dividends; every dividend recruits the next contributor. The core product
   and the data business feed each other.

**`$BRAIN` role:** **full utility realized** — settlement, access, quality bond,
supply dividend, curation, and governance, with a transparent buyback/burn loop.

**Exit milestone:** ✅ A **cited public benchmark**, **recurring eval revenue**,
and a **self-sustaining `$BRAIN` flywheel** (revenue → buyback → dividend/burn →
more supply) documented end-to-end.

---

## Cross-cutting concerns (run through every stage)

### Data governance & legal (the make-or-break)
- **Owned vs. contributed lots stay physically separated, forever.** One
  improperly-consented snippet must never be able to contaminate the owned corpus.
- **Consent is opt-in, revocable, and scoped** (train / eval / both); default is
  hash-only telemetry, unchanged.
- **Secrets never ingested** — reuse Keyguard + secret-detection on the ingest
  path; minimization runs before storage.
- **License clarity is a feature** — datasheets state provenance and license per
  lot; buyers diligence exactly this.

### Anti-poisoning & integrity
- RED→GREEN reproduction on re-run is the objective truth test; non-reproducing
  VTIs are rejected/slashed.
- Distinct-repo corroboration (today's graduation signal) is the trust weight.
- `$BRAIN` stake-and-slash makes bad submissions *cost* the submitter.
- SHA256SUMS-style tamper-evidence on every shipped lot/feed segment.

### Honesty guardrails (inherited from the core product)
- Never ship a dataset/benchmark we can't reproduce. Same bar as "not shipped
  until it has caught something real."
- "Real-time training feed," never "we train your model." We supply verifiable
  RL-grade data; the lab owns the loop.

---

## Risk register

| Risk | Stage most exposed | Mitigation |
|---|---|---|
| **Naive "scraped bugs" has no moat** | 0–1 | Lead with *verified* RED→GREEN + freshness + rarity, not raw errors |
| **Consent/license contamination** | 2 | Separated lots; opt-in revocable grants; minimization; secret-scanning ingest |
| **Data poisoning for dividend farming** | 2–3 | Reproduction gate + corroboration + `$BRAIN` stake-and-slash |
| **Buyer concentration (≈5 labs)** | 4 | Stage 5 eval/benchmark serves the much larger build-on-models market |
| **Token utility seen as bolt-on** | all | `$BRAIN` is settlement + bond + dividend + access from Stage 1, not an afterthought |
| **Freshness decay (data goes stale)** | 3–4 | Scout fleet prioritizes newly-shipped APIs; feed sells the *delta*, not dumps |
| **Overpromising "real-time training"** | 1, 4 | Scope discipline: verifiable feed/eval, not gradient updates |

---

## Success metrics by stage

- **S0:** # schema-valid VTIs generated from existing packs; 100% CI-validated.
- **S1:** seed-dataset size; # buyer conversations; ≥1 paid pilot / LOI; first
  `$BRAIN` invoice settled.
- **S2:** # consented contributors; % consented VTIs reproducing; first dividend
  paid; $ slashed (poison caught).
- **S3:** SDK coverage (N); VTIs/week; reproduction rate; median release→VTI age.
- **S4:** paying subscribers; feed MRR; % revenue settled in `$BRAIN`; `$BRAIN`
  bought back per $ of USDC revenue.
- **S5:** benchmark citations/usage; eval ARR; dividend paid vs. burned; token
  loop self-sustaining (revenue ≥ emissions value).

---

## Immediate next action

**See [Remaining work — execute in THIS exact order](#-remaining-work--execute-in-this-exact-order)
(R1–R10) — that is the authoritative plan.** Do not re-derive priorities here.

**R1, R2, and R3 are DONE and confirmed live** (2026-07-02: `registry.brainblast.tech`
`/api/healthz`, `/api/catalog`, `/api/feed` all verified 200 with correct data —
no operator step outstanding). **R7's engine is maximally capable** (v0.9.8 —
oracle gate, self-extending checkers, multi-language proving) and was run for
real today (10 repos scouted, honest — see R7 above). What's open:
- **Apply the `fleet_ledger` migration to prod Supabase `[infra]`, no spend** —
  the one gap found today: `brainblast-registry/supabase/schema.sql` has the
  `create table` statements, they were just never pushed. Needs Supabase
  dashboard/CLI access — the fleet works without it (local-cache fallback),
  it just can't share dedup across fleets yet.
- **R4 — on-chain settlement `[spend]`**: pay `$BRAIN`/USDC → the treasury
  auto-issues a grant signed by the R2 distributor identity; USDC→buyback. This is
  the first item that **spends funds** — pull it deliberately.
- **Run R7 at scale** — the engine no longer needs new capability, only breadth:
  point it at the scoreboard's work-orders across N≥50 SDKs, freshness-first.

**R8 (buyer outreach)** still runs in parallel — the corpus (now 15 VTIs across
static, compiler-checked, behavioral, self-authored-shape, and multi-language
traps) plus `datasets/CATALOG.md` and the bench scorecard are the artifacts to
take to buyers.

When you finish any R-item: tick its checkbox, move its row in the
[Done vs. Remaining ledger](#-done-vs-remaining--the-authoritative-ledger) from
REMAINING to DONE, and update the [glance table](#roadmap-at-a-glance).
