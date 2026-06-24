# Brainblast → AI Training-Data Platform: Roadmap

**Last updated:** 2026-06-23 · anchored at **v0.8.3** · branch [`training-data`](https://github.com/DSB-117/brainblast/tree/training-data)
**Current state:** Stage 0 shipped · Stages 1 & 2 in progress (engineering core landed; go-to-market + on-chain `$BRAIN` rails remain)
**Companion to:** [`ROADMAP.md`](ROADMAP.md) (the core *Predict → Enforce → Watch → Compound* ladder)

> **Legend:** ✅ shipped · ◐ in progress · ☐ not started. This document is a live
> reference and is updated at the end of every task.

---

## What's shipped so far

Everything below runs today on the `training-data` branch (524 tests green):

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

**Remaining everywhere:** the on-chain `$BRAIN` settlement/stake-slash/dividend
rails (they spend funds) and the go-to-market steps (scout supply at scale, buyer
pilots). Each stage below marks exactly what's done vs. pending.

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

| Stage | Theme | Exit milestone |
|---|---|---|
| **0 ✅** | Define & capture the VTI | VTI schema v1 committed; seed records generate from existing packs |
| **1 ◐** | Owned synthetic seed corpus + buyer validation | License-clean seed dataset + ≥1 paid pilot / signed LOI |
| **2 ◐** | Consent & contribution pipeline | First consented user VTIs flowing; first `$BRAIN` data dividend paid |
| **3 ◐** | The data factory at scale | Continuous VTI production across N≥50 SDKs at a quality SLA |
| **4 ☐** | Real-time feed + marketplace | Live subscription feed with paying customers settling in `$BRAIN`/USDC |
| **5 ☐** | Eval/benchmark product + closed flywheel | Cited public benchmark + recurring eval revenue + self-sustaining token loop |

Stages are a **capability ladder, not a calendar.** Each ships only after the
prior milestone holds.

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
- ☐ **Step 1 (scout fleet)** is the supply lever — spends `$BRAIN` + browses, so
  pulled deliberately. The coverage map now tells it exactly where to dig
  (today: 3 uncovered classes — immutable-after-deploy, auth-bypass,
  wrong-constant — and 8 thin cells).
- ☐ **Step 4 (curation market)** and **Step 5 (quality SLA monitoring)** build on
  the score/coverage surface above; Step 4 needs the on-chain `$BRAIN` rails.

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

The Stage 0–2 engineering core is in place (see [What's shipped](#whats-shipped-so-far)).
The next moves, in priority order:

1. **Supply (Stage 3).** Run `brainblast-scout` across the top SDKs to manufacture
   new proven packs — each one flows automatically into the dataset (`gen:vti` →
   `pack:dataset`) and the benchmark. This is the lever that turns 8 traps into a
   corpus worth selling. *(Spends `$BRAIN` via staking — run deliberately.)*
2. **On-chain `$BRAIN` rails (Stages 2 & 4).** Extend `scripts/agent-stake` from
   "stake on a pack" to bond/slash on a contributed VTI, and wire the
   buyback + data-dividend flow. The reproduction gate already shipped is the
   slashing trigger.
3. **Go-to-market (Stage 1, Steps 4–5).** Take `datasets/v0.1.0/sample/` + a
   benchmark scorecard to buyers; land one paid pilot or LOI.

Items 1 and 2 spend tokens/funds; item 3 is outreach. All three build on the
shipped, verified foundation rather than blocking on each other.
