# Plan: Brainblast as the pre-implementation tool for Solana developers

**Status:** draft, for review — not yet executed.
**Supersedes-in-scope:** the "broaden Rung 2 guardrails" item in ROADMAP.md, for the Solana vertical specifically.

## 1. Thesis

Stop trying to be a thin layer of "AI integration trap" coverage spread across many
ecosystems, and go deep on one where the stakes are highest and the failure modes are
most distinctive: **Solana**. Money is on-chain, mistakes are frequently irreversible,
and the ecosystem has a *structurally different* risk shape than web2 (deployed
programs as dependencies, CPI trust graphs, devnet/mainnet divergence, rent economics)
that a generic "audit your API calls" tool cannot reach.

The pipeline becomes:

```
Digest plan → Analyze tech infra → Identify external components
  (SDKs, APIs, deployed on-chain programs)
→ Deep-research docs/codebases + CPI/composability → build program trust graphs
→ Flag issues & traps (incl. devnet/mainnet divergence, rent/cost economics)
→ Final report: Risk Report + Proposed Guardrails
→ Loop closes: research finding → auto-generated checker → proven RED→GREEN → committed test
→ Adds to memory (compounding intel, shared across runs)
```

## 2. The mechanism that makes "the loop closes" safe: proof-as-classifier

This is the architectural decision the whole plan hangs on, so it gets its own section.

**The problem:** "auto-generate a checker" sounds like "have an LLM write static-analysis
code." That is the single most dangerous thing this product could do — a checker that
confidently returns `pass` when it should return `fail` is *worse than no checker*,
because it converts an honest "we don't check this" into a false "this was verified."

**The resolution:** separate *generating a rule* (safe — it's data) from *generating a
checker* (dangerous — it's logic), and use the existing RED→GREEN proof step as the
gate that decides which path a finding takes — not an LLM's opinion about whether it's
a good fit.

```
research finding
      │
      ▼
synthesize a candidate rule (YAML: severity, detect.*, check.kind + params,
test.kind + params) AGAINST AN EXISTING, HUMAN-VETTED checker kind
      │
      ▼
generate matching vulnerable + fixed fixtures
      │
      ▼
run scripts/prove.ts: does the generated test FAIL on the vulnerable fixture
                      AND PASS on the fixed one?
      │
      ├── YES → commit rule + fixtures + test. Loop closed, fully automatically,
      │         with zero new executable logic — every line that runs was already
      │         reviewed when the checker kind was vetted.
      │
      └── NO  → the finding's shape doesn't fit any existing checker kind.
                Queue it as a DRAFT (finding + a best-guess checker sketch) for
                human review — exactly the loadRules() discipline that already
                rejects any rule binding to an unknown check.kind. Once a human
                vets the new checker kind, it joins the library — and from that
                moment on, every future finding shaped like it closes
                automatically too.
```

This makes the checker-kind library a **compounding asset** in the literal sense your
ROADMAP names as the Rung 5 thesis: each hand-vetted kind is a template that
auto-closes the loop for every structurally-similar future finding. The system gets
*safer and more autonomous* over time — the opposite of what happens if "generate the
checker" means "trust an LLM to write new AST logic."

**Concretely, today's three checker kinds already cover real ground:**
- `positionalArgIdentity` — "this call's arg N must be identical to param M" → covers
  Stripe raw-body, and a chunk of the Anchor signer-check trap (#2 below).
- `requiredCallWithOptions` — "this call must include these option keys" → covers
  Privy/JWT, and is a plausible fit for "config must declare X."
- `feeAllocationShape` — "config array must contain an identity-matching entry whose
  numeric props sum to N" → covers Bags, and is a near-exact structural match for
  Token-2022 program-ID identity (#1) and Metaplex `isMutable` (#4) — both are
  "identity must appear / flag must be set correctly" shapes.

That's not a coincidence — it's evidence the proof-as-classifier loop will close
automatically for a meaningful fraction of Solana findings *from day one*, without
writing a single new checker kind first.

## 3. Phased plan

### Phase 0 — Foundation: make the loop machinery real (no new traps yet)
Build the proof-as-classifier pipeline itself, proven on traps we already understand:
- `scripts/synthesize-rule.ts` (or similar): given a structured finding + a candidate
  checker-kind binding, generates the YAML rule, vulnerable/fixed fixtures, and
  test-template params.
- Wire it to `prove.ts` as the gate (pass → commit; fail → draft + human queue).
- **Prove it on a *known* trap first** — re-derive the Bags rule through this pipeline
  and confirm it reaches the same RED→GREEN result we hand-built. This is the "done
  when" criterion: the machinery produces what a human produced, automatically, for a
  finding whose answer we already know.
- Draft-queue surface: where do unfit findings land, how does a human review/promote
  them to vetted checker kinds (mirrors `loadRules`'s existing safety-net discipline).

*Done when:* a finding shaped like Bags goes in, a committed, proven rule comes out,
with no human writing AST code in between.

### Phase 1 — Component identification, upgraded for Solana
Extend "identify external components" to reach the things npm-shaped tooling can't see:
- **Deployed on-chain programs**, not just SDK packages — resolve a program ID from
  the spec/lockfile/IDL, not just a package name.
- **CPI / composability trace** — for each program the plan will invoke (directly or
  transitively), walk the call graph and surface it as a **trust graph**: who can
  upgrade this program, is the upgrade authority a multisig/DAO or a single key, is
  there a verified build, has it been audited and when.
- **Devnet/mainnet divergence flag** — for each component, explicitly research and
  record "does this behave identically in the environment you'll test in vs. the one
  you'll ship to" (we already hit this once, with Bags being mainnet-only).

*Done when:* a research run on a real Solana spec produces a trust graph naming
upgrade authorities and verified-build status for every transitively-invoked program —
not just a list of SDK names and versions.

### Phase 2 — First wave of Solana traps (the Tier-1 five from research)
Land these roughly in order of how cleanly they fit existing checker kinds (cheapest
proof-as-classifier wins first, hardest last):

1. **Token-2022 vs legacy Token program-ID mismatch** — `feeAllocationShape`-shaped
   (identity check against a known-constant). Likely closes via Phase-0 machinery with
   *zero* new checker-kind work.
2. **Anchor missing `Signer<'info>` on an authority account** — `positionalArgIdentity`
   -shaped (type-identity check on a struct field), but on Rust/Anchor source rather
   than TS — may need a Rust-aware AST layer (see Phase 2.5 risk note below).
3. **Metaplex `isMutable: false` at mint time** — near-identical structural shape to
   Bags' `feeAllocationShape` (resolve a property through indirection, flag a bad
   literal). Strong candidate to close fully automatically.
4. **`init_if_needed` reinitialization without a guard** — needs a new checker shape
   ("attribute X present AND companion runtime check Y absent in the handler body").
   Expect this one to fall through to the human-review queue at first; once vetted, it
   becomes a template for "feature flag implies an obligation" traps generally.
5. **Mint/freeze authority never revoked** — cross-call trace (does `setAuthority(...,
   null)` appear anywhere downstream of `createMint` for the same mint?). The hardest
   of the five technically, and — per our calibration — weaker on "good-faith builder
   would want this caught" than the other four. Sequence it last, and frame it as a
   *trust-graph* finding (Phase 1) as much as a code-pattern finding — its real value
   may be in the report, not as a committed guardrail.

*Done when:* at least 3 of the 5 land via proof-as-classifier with no new checker-kind
code, validating that the Bags-shaped checkers really do generalize — and the other
1–2 produce well-formed draft findings that a human can vet into new checker kinds.

### Phase 2.5 — Address the Rust/Anchor gap (a real architectural fork, name it now)
Every checker built so far analyzes **TypeScript** (ts-morph). Traps #2 and #4 above
live in **on-chain program source — Rust/Anchor**, not the client SDK calls. That's a
different AST entirely. Two honest paths:
- (a) Build a Rust-aware checker layer (real cost: a new parsing toolchain, new
  `Candidate` shape, likely a new checker-kind *family*, not just new kinds) — but it's
  the only way to catch the highest-severity class of trap (program-level
  vulnerabilities, not just client misuse).
- (b) Stay TS/client-side for v1, and treat Rust/Anchor program-source analysis as its
  own deliberate phase-2 bet — scoped, named, and not snuck in as "just one more
  checker kind" the way Phase 2 framing might tempt you to.

Pick (a) or (b) explicitly before Phase 2 lands #2 or #4 — don't let scope drift
decide it for you.

### Phase 3 — Cost & rent analysis (as a Risk Report section, not a forensic audit)
Per the discussion: don't drop this, and don't over-build it into its own subsystem.
Land it as a named subsection of the existing Risk Report:
- Rent-exemption accounting: which flows create accounts, how many, what each one
  locks up, and whether/how that's recoverable (the #1 source of "where did my SOL go"
  confusion).
- Priority-fee posture: does the plan's transaction-building path ever set
  `setComputeUnitPrice` — flagged as a HIGH (not CRITICAL — it's congestion-conditional)
  finding when absent.
- Account-creation cost scaling: flag flows whose cost grows with N (creating N token
  accounts, N metadata accounts) as a named line item, not a buried detail.

*Done when:* a real run produces a cost section that names specific flows, specific
lamport-lockup amounts, and specific recoverability notes — not a generic "expect to
pay SOL for transactions" disclaimer.

### Phase 4 — Memory as a compounding asset, not an archive
Resolve the "memory" question raised in review: should findings start composing
*during* a run (a second project benefits mid-flight from a first project's trust-graph
work on a shared program), or only after a run finalizes? Recommendation: model it on
the existing `cache/` mechanism — keyed, in this case, by **program ID** rather than
`name@version` (programs don't have semver; their identity *is* their address and
upgrade-authority status). A trust-graph entry for `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
researched once should pre-populate every future run that touches Token-2022 — the
exact "intel pack" mechanic from Rung 5, made concrete for Solana's actual identity
model.

*Done when:* a second project's run reuses a program-keyed trust-graph entry from a
first project's cache, with provenance intact (when it was researched, what was found).

## 4. Sequencing rationale (why this order)

- **Phase 0 before any new traps**: prove the *mechanism* on a known answer (Bags)
  before trusting it with unknowns. If the loop can't re-derive a result we already
  hand-verified, it's not ready to be trusted on a novel finding.
- **Phase 1 before Phase 2**: the trust-graph and devnet/mainnet research targets are
  what make the *findings* Solana-native rather than "web2 findings about Solana
  packages." Land the better research target before generating guardrails from it —
  otherwise Phase 2's findings are shaped by the old, narrower research lens.
- **Phase 2 ordered hardest-last, by fit-to-existing-checker-kinds**: maximizes early
  wins that validate proof-as-classifier with zero new logic, and surfaces the
  Rust/Anchor fork (Phase 2.5) at a deliberate checkpoint rather than mid-sprint.
- **Cost analysis (Phase 3) lands as a report section, deliberately scoped down** from
  "deployment cost analysis" as its own pipeline stage — per the calibration that it's
  real and wanted, but shouldn't balloon into a forensic subsystem that competes with
  the trap-finding work for engineering attention.
- **Memory last**: it's the compounding mechanism — it has the most value once there's
  a real corpus of trust-graph and rule data to compound *from*. Building it first
  would mean building infrastructure for an empty store.

## 5. Open decisions to make explicitly (don't let them resolve by drift)

1. **Phase 2.5's fork (Rust/Anchor vs. TS-only for v1)** — the single highest-leverage
   "decide this on purpose" moment in the whole plan.
2. **Where #5 (mint/freeze authority) lands** — guardrail or trust-graph/report-only
   finding? Per calibration, it may be more valuable as the latter.
3. **Draft-queue UX** — when a finding doesn't fit an existing checker kind, who reviews
   it, on what cadence, and what's the bar for promoting a draft checker to vetted?
   This is the human-in-the-loop hinge the entire safety model depends on; it deserves
   a real design pass, not an afterthought.

## 6. What "done" looks like for this whole effort

Borrowing your own ROADMAP's "how we'll know it worked" frame, applied to this vertical:

1. **Correctness** — a Solana-specific benchmark: real specs with known traps from
   this research (the 5 Tier-1 candidates plus whatever Phase 1's trust-graph work
   surfaces), publishing precision and false-negative rate the same way the general
   roadmap proposes — but Solana-native, not borrowed.
2. **Permanence** — guardrails for at least 3 of the 5 Tier-1 traps committed and
   proven via proof-as-classifier with zero hand-written checker-kind code.
3. **Compounding** — a second project's run measurably benefits (faster, with
   provenance) from a first project's program-keyed trust-graph cache entries.
4. **Adoption** — a real Solana project gates its CI on at least one of these
   guardrails, and the Risk Report's cost section gets cited in a real architecture
   decision (e.g., "we batched account creation because brainblast flagged the rent
   cost of doing it per-user").
