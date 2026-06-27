# Changelog

## Unreleased

## v0.9.4 — 2026-06-27

**The VTI feed (Stage 4 of the training-data roadmap).** `brainblast feed` turns
the verified-trap corpus from a static dataset into a **subscription to the
delta** — the product surface a lab plugs into its own eval/training loop. Reads
any VTI lot(s) and streams NDJSON (the same tail-the-stdout contract as `watch`):
`feed_meta` → one `vti` per line → `feed_complete`. Additive; the audit path is
unchanged.
- **The delta is real.** `--since <cursor>` emits only records newer than the
  caller's last `capturedAt`; `feed_complete` returns the next cursor, so a
  consumer resumes without re-pulling. Filter by `--sdk` / `--class` /
  `--severity` (min-and-above) / `--min-corroboration` / `--limit`.
- **Tiered access** (`sample → standard → firehose`): per-tier record caps,
  fixtures gating, and a freshness holdback (freshness is the moat). **Sample
  withholds the trainable fixtures** — metadata + the RED→GREEN receipt only;
  paid tiers unlock the payload and the fresh delta. `--wallet-tier` maps the
  v0.9.3 wallet's `$BRAIN` balance to a tier (`tierForBrain`).
- **Reproducibility receipts** ship on every record (`red`/`green`/`method`/
  `verifiedAt` + `sourceUrls`) — independent reward-gradability, the credibility
  feature scraped data can't offer. Only RED→GREEN-proven records are emitted.
- **Honest client/server split:** the local feed computes tier *eligibility* and
  formats the delta from lots you possess; **real entitlement is enforced at
  distribution** (the marketplace surface + on-chain settlement are the
  server-side follow-ons). 11 new tests; suite at 633 pass / 1 skip.

## v0.9.3 — 2026-06-27

**The Agent Wallet (default-off).** A small, capped, Vault-recoverable Solana ops
wallet an AI agent can generate and operate itself — the on-chain `$BRAIN`
substrate the training-data roadmap's Stages 2 & 4 were deferred onto. Additive
and opt-in; a normal `npx brainblast` audit is byte-for-byte unchanged. The rule
it hangs on: this is a **sacrificial capped wallet, never the owner's principal** —
the caps + recipient allowlist (not the at-rest encryption) are what bound a
compromised agent. See [`WALLET-PLAN.md`](../../WALLET-PLAN.md).
- **`brainblast wallet init | address | list | balance | policy | config | stake |
  sweep | rotate | delegate | revoke`** (`src/wallet/`). The secret is generated
  with `node:crypto` (ed25519 — byte-identical to `@solana/web3.js`) and stored
  **only** in the encrypted Vault (`backupBytes` — never a plaintext file),
  recoverable by pubkey; a wiped working tree recovers from the Vault.
- **The spend gate.** Every outbound tx passes `checkSpend()` via
  `signWithPolicy()`, which is **fail-closed** (a refusal never touches the chain)
  and debits per-currency session ledgers only on a successful non-sweep spend.
  Bounds: per-tx/session USD caps, **per-tx/session `$BRAIN` caps on the actual
  token amount that leaves** (see hardening below), a SOL per-tx cap, recipient
  allowlist, and `blockUnknownPrograms`. `sweep` is the panic button: it ignores
  spend caps but is fail-closed to a registered owner address.
- **Staking.** `wallet stake` bonds `$BRAIN` on a contributed VTI through the gate
  — the in-core successor to `scripts/agent-stake`, reading the secret from the
  Vault instead of `AGENT_OPS_WALLET_SECRET`. Autonomous `$BRAIN` spend is
  **disabled until you set a `$BRAIN` cap** (`wallet config --max-brain-per-tx N`)
  — fail-closed by default.
- **Red-team hardening (pre-merge security pass).** Fixed a cap-evasion bug: the
  gate capped a caller-asserted USD figure while the transfer sent an independent
  `brainAmount`, so an understated USD could drain an unbounded token amount. The
  gate now bounds the **actual `$BRAIN` amount leaving** and fail-closes when no
  token cap is set; staking pre-flights the gate before any network call. Added a
  14-case red-team suite (base58-vs-reference fuzz, NaN/negative/Infinity, the
  decoupling exploit, fail-closed sweep, "refusal never sends / never debits").
  Documented the honest trust boundary in `WALLET-PLAN.md`: the gate stops a
  prompt-injected agent, **not** a code-execution-compromised one — that case is
  bounded by a small balance, Tier-2 on-chain delegation, and human sweep.
- **Tier-2 (opt-in).** `wallet delegate`/`revoke` emit the owner-side `spl-token
  approve`/`revoke` so the agent spends a capped on-chain allowance and never
  custodies principal.
- **Consent stays separate.** The wallet removes *economic* friction only; data
  capture stays behind the existing `BRAINBLAST_CONTRIBUTE=1` opt-in (default off).
- `@solana/web3.js` + `@solana/spl-token` promoted to runtime deps (lazy-loaded by
  the network commands only). 21 new tests; 608 pass / 1 skip.

## v0.9.2 — 2026-06-26

**The data factory, prover-backed.** v0.9.0/0.9.1 shipped the generalized oracle;
the training-data factory (VTI schema, contributor ingest, corpus/SLA, bench) lived
on a separate branch and still proved everything with its **weakest** oracle —
Tier-0 static only. v0.9.2 lands the whole factory on `main` (additive, default-off)
and **routes intake through the generalized prover**, so it can finally capture the
trap classes only Tier-1/2 can prove (the `wrong-constant` / no-static-shape long
tail it used to throw away).

- **Data factory ported to `main`** (default-off, opt-in): `schema/vti.schema.json`,
  `src/contrib/{ingest,capture}.ts`, `src/{corpus,vtiClass}.ts`, the
  `gen:vti` / `ingest:vti` / `pack:dataset` / `corpus` / `sla` / `bench` scripts,
  `datasets/`, `bench/`, and `ROADMAP-TRAINING-DATA.md`. None of it runs on a normal
  `npx brainblast` — the audit path is byte-for-byte unchanged.
- **Keystone — prover-backed intake.** The reproduction gate in `ingestContribution`
  / `ingestCandidate` / `reproducePair` now calls `proveWithBest(selectBackends(
  "best").backends, …, "ingest")` instead of the Tier-0 `auditWithRule`. `context:
  "ingest"` forces the **hardened** sandbox and **refuses → reject** rather than
  falling back. Gating semantics are preserved exactly (a real RED is required on
  the vulnerable side; an UNKNOWN fixed side still counts as GREEN), so every
  existing record still reproduces (SLA 100%).
- **`gen-vti` records the true method** (e.g. a compiler-proven trap is stamped
  `compiler`, not the old hard-coded `static-checker`); the SLA monitor re-proves
  through the prover too.
- **Schema → 1.1 (additive superset).** `redGreenProof.method` is aligned with
  `OracleMethod` (`static-checker | compiler | executed-test | differential`, plus
  `+`-joined corroboration); new optional `corroboratingMethods`. 1.0 records stay
  valid; the SLA re-validates against 1.1.
- **The bottleneck is gone — captured end-to-end through ingest.** Two non-static
  classes the Tier-0-only factory could never admit now flow through the full ingest
  gate: a **compiler** trap (a hallucinated Stripe API), and — running a contributor's
  code in the **hardened container** — a `differential` `wrong-constant` trap
  (SOL→lamports off by 1000×).
- **Differential runs portably in the hardened sandbox.** The candidate is transpiled
  to plain CommonJS **on the host** (via the bundled TypeScript compiler — compilation,
  not execution) and run with plain `node` inside a `--network=none` container — no
  `tsx`, no `node_modules`, no native deps. The local light-isolate and the ingest
  container run the **identical command**, so the whole path is locally testable.
  Where no container runtime exists, ingest **refuses → reject** (never falls back to
  light isolation).
- **`executed-test` still refuses on ingest** — its vitest contract needs a
  vitest-capable sandbox image (a tracked follow-on). It is fully functional under
  `context:"local"`. Static + compiler (which execute nothing) flow through ingest
  unconditionally.

This is P0 of the Real-Time VTI Intake plan (local, default-off, nothing leaves the
machine). The vitest-capable sandbox image (for executed-test on ingest), streaming
delivery, the `brainblast_recall` tool, and the bench-delta are the follow-on phases.

## v0.9.1 — 2026-06-25

**Tier 2: the context-scaled sandbox.** v0.9.0 shipped the pluggable oracle with
`executed-test` and `differential` as honest placeholders that *abstained*. v0.9.1
makes them **run** — behind the safety boundary the interface was built for. Two
more ways a verdict can be grounded in truth, now live.

- **Sandbox core (`src/oracle/sandbox.ts`)** — two isolation strengths behind one
  interface, selected by `target.context`:
  - **Light isolate (`context:"local"`)** — a child process in an ephemeral dir
    with a hard wall-clock timeout (kills the process), output-size cap, trimmed
    env. Enough to stop a runaway test on *your own* code; not a malice defense
    (no untrusted party locally), and it makes no claim of network isolation.
  - **Hardened container (`context:"ingest"`)** — `docker/podman run --rm
    --network=none --read-only --cap-drop=ALL --user nobody --memory/--cpus/
    --pids-limit`. **Refuses → UNKNOWN if a container can't be stood up — never
    falls back to the light isolate.** That refuse-on-missing is the load-bearing
    property for ever running contributor code on our infra.
  - A crash / timeout / refusal scores **UNKNOWN, never RED** — a failure to run
    is not a proof.
- **`executed-test` backend (real)** — renders the rule's **vetted** contract test
  and runs it in the sandbox against the candidate; RED iff the contract fails.
  Default **OFF** (`--oracle=executed`, or `--oracle=best` with
  `BRAINBLAST_ORACLE_EXEC=1`). Proven RED→GREEN on the Stripe webhook-signature
  contract, through the sandbox.
- **`differential` backend (real, golden-I/O)** — new `check.kind:
  "differential-io"`: runs *only the candidate* against a versioned, vetted
  input→output table in the sandbox; RED iff any output diverges.
- **New bundled pack `solana-lamports-scaling-wrong-constant`** — a SOL→lamports
  converter using `1e6` instead of `1e9` (off by 1000×). A logic bug with **no
  static signature**, proven RED→GREEN by the differential oracle — **closing the
  previously-uncovered `wrong-constant` class.**
- **`pack validate`** reports Tier-2 (`differential-io`) rules as non-fatal
  `unverifiable` on the default offline path; prove them with the explicit opt-in
  `brainblast verify <pack> --oracle=differential`.
- **New public exports**: `runInSandbox`, `containerRuntime`, and the sandbox types.

Discipline kept: the default `npx brainblast` still executes **no candidate code**
and is byte-for-byte offline; an executed/differential RED only counts when the
test/reference is a **vetted, owned** template (contributors supply fixtures,
never oracles); UNKNOWN counts as GREEN for *gating* but is never a proof.

## v0.9.0 — 2026-06-25

**The Generalized Oracle** — `runChecker` was one static pattern-matcher; v0.9.0
turns verification into a **pluggable interface** so the corpus can grow past
hand-written Solana checkers into the long tail of agent errors — *without*
changing the RED→GREEN contract, and keeping the cheap offline path the default.

One verdict, many oracles. A trap is reward-gradable because a **deterministic
procedure** returns RED on the vulnerable code and GREEN on the fixed code,
runnable by anyone with no secret answer key. v0.9.0 makes that *procedure*
pluggable while keeping the *verdict* identical (`RED | GREEN | UNKNOWN`):

- **Tier 0 — `static-checker`** (default, unchanged): offline, deterministic, no
  execution. The existing `audit()` engine, wrapped — *not* rewritten — as a
  backend. The seam is a no-op: a parametrized test asserts the static backend's
  verdict equals legacy `auditWithRule` on every bundled pack's fixtures.
- **Tier 1 — `compiler`** (new, ships now): runs the **type-checker only**
  (`tsc` via the existing `ts-morph` dependency) against the *pinned* SDK, never
  the program. The vulnerable fixture fails to type-check (RED); the fixed one
  compiles clean (GREEN). Offline, deterministic, no LLM, no code execution —
  safe in every context. Catches the **#1 agent error**: calling an API that
  doesn't exist / moved at that version. New rule kind `compiles-against-sdk`.
- **Tier 2 — `executed-test` / `differential`** (interface shipped, sandbox in
  v0.9.1): wired with the uniform interface, tier, `supports()`, and an honest
  refusal. They run candidate code, which is a security question, so they are
  **opt-in only** and currently **abstain (UNKNOWN, never RED)** until the
  context-scaled sandbox lands — a light isolate for your own code locally, a
  hardened container that *refuses rather than falls back* for contributor code
  on ingest.

The proof off Solana: a new bundled pack **`stripe-paymentintents-moved`** mints a
sellable, reward-gradable trap on a current npm SDK (`stripe@17`) —
`stripe.paymentIntent.create` vs `stripe.paymentIntents.create` — proven RED→GREEN
by the compiler oracle with **zero code execution**.

New surfaces:

- **`brainblast verify <pack-dir> [--oracle=static|compiler|best]`** — re-prove a
  pack's records RED→GREEN through the oracle and print a **reproduction
  scorecard**. The receipt a buyer runs to check reward-gradability themselves.
- **`brainblast <dir> --oracle=compiler|best`** — additive, advisory oracle
  section on the main audit. The default (`static`) is byte-for-byte 0.8.3.
- **`brainblast pack validate`** auto-routes `compiles-against-sdk` rules through
  the compiler oracle (static rules keep their exact gate). A new
  `unverifiable` status degrades gracefully when the pinned SDK isn't installed.
- **MCP `brainblast_verify(dir, trapId, oracle)`** — any agent can ask the brain
  to *prove* a fix, not just flag it.
- **New public exports**: `auditWithOracle`, `proveRedGreen`, `proveWithBest`,
  `proofMethod`, the four backends, `selectBackends`, `parseOracleSelector`, and
  the oracle types.

Discipline kept: the RED→GREEN contract is unchanged (only the number of ways to
establish it grew); rules stay pure data binding to **vetted templates** (no
backend executes contributor-authored logic as an oracle); the default
`npx brainblast` stays offline, deterministic, LLM-free, and executes **no
candidate code**. UNKNOWN counts as GREEN for *gating* but is never a proof.

Note: the bare type name `OracleVerdict` now belongs to the generalized
verification oracle; the on-chain freshness verdict union is exported as
`OracleFreshnessVerdict`.

## v0.8.3 — 2026-06-22

**Wallet Guard now runs in the default `npx brainblast .`** — so the
devnet-config-shipping-mainnet class is caught on a normal run, without having to
know to invoke a separate command. Follows the `costAnalysis` precedent: **purely
additive, never mutates security results.**

- The default audit prints a **"Wallet config"** section and attaches the findings
  as `report.walletConfig`, but keeps them **out of `checks[]` / `checkTotals`** — so
  the security verdict, exit code, `brainblast-gate.sh`, `--ci`, and the living-memory
  path are all **unchanged**. No previously-green build can fail by surprise.
- Only shown when a wallet-adapter setup or a finding is present (no noise on
  non-frontend repos); skipped in `--since` diff-scoped runs.
- **Opt-in gating:** `brainblast . --fail-on-wallet` exits 1 on a critical/high
  wallet finding. The default exit behavior is untouched.
- `report.schema.json`: `costAnalysis` and `walletConfig` added as optional
  nullable-object sections so a fresh `report.json` validates.

The standalone `brainblast wallet-check [dir]` from v0.8.2 is unchanged.

## v0.8.2 — 2026-06-22

**Wallet Guard** — catch the silent wallet-adapter footguns that ship the wrong
cluster, break the connect modal, and leak paid RPC keys. The trigger: a devnet
demo whose `.env` said `NEXT_PUBLIC_SOLANA_NETWORK=devnet`, but neither coding
agent wired it into the wallet adapter — so the `ConnectionProvider` ran mainnet
and the wallet referenced real SOL. Classic silent config mismatch.

**`brainblast wallet-check [dir]`** — one analysis pass that reconciles the
project's *declared* network (`.env*`) against its *actual* wallet-adapter wiring
(`@solana/wallet-adapter-react`), emitting:

- **`solana-wallet-network-mismatch`** (critical) — `.env` declares one network but
  the `ConnectionProvider` endpoint is hardcoded to a *different* one and isn't wired
  to the env var → the app runs on the wrong cluster, referencing real funds.
- **`solana-network-env-unwired`** (high) — a network env var is declared but **no
  source file reads it** (the exact reported bug); the value is dead.
- **`solana-public-rpc-endpoint`** (high) — the rate-limited public mainnet RPC
  (`api.mainnet-beta.solana.com`), which 429s under real load. Only fires for
  mainnet-bound endpoints (devnet public RPC is fine for a demo).
- **`solana-rpc-key-exposed`** (high) — a keyed provider RPC URL (Helius/QuickNode/
  Alchemy/…) under a client-exposed prefix (`NEXT_PUBLIC_`/`VITE_`/`REACT_APP_`),
  shipped to every browser → anyone drains your paid quota.
- **`solana-wallet-ui-styles-missing`** (medium) — `WalletModalProvider`/
  `WalletMultiButton` used without importing `@solana/wallet-adapter-react-ui/styles.css`
  → the connect modal renders unstyled / looks broken.

Verdict `allow / warn / block`; exit 1 on a critical mismatch (or any finding with
`--strict`). `--json` and an `inspectWalletConfig(dir)` inline export. Conservative,
content-based, fully offline. 10 new tests; full package suite at 513.

## v0.8.1 — 2026-06-22

**Signguard** — Keyguard protects the keypair from *deletion*; Signguard protects
it from being *used against you*. The most common way SOL actually leaves a wallet
is signing one transaction you didn't understand — a drainer, a `SetAuthority`, a
delegate `Approve`, a runaway transfer — and agents now sign autonomously.
Signguard is the transaction-signing sibling of the file Guard: it decodes a
transaction *before it's signed* and enforces a standing local **signing policy**,
returning `allow / warn / block`.

Built on the existing `firewall` (decode + pattern findings + simulation), adding
the thing it lacks — a policy you set once and enforce everywhere:

- **Spend quantification + caps** — decodes the SOL leaving the fee payer
  (SystemProgram `Transfer`/`CreateAccount`) and enforces a **per-transaction**
  and a **cumulative per-session** cap. *"Moves 5.0000 SOL — over the 1 SOL limit. BLOCK."*
- **Program allowlist** — unknown programs become a hard block (vs the firewall's
  soft warn), scoped to `KNOWN_PROGRAMS` ∪ your `allowedPrograms`.
- **Action policy** — `setAuthority` / `delegateApproval` / `programUpgrade` /
  `closeAccount` each map to `allow|warn|block` (secure defaults: first three block).
- **Recipient allowlist** — transfers must go to addresses you've approved.
- **Session ledger** — cumulative spend at `~/.brainblast/signguard`, `signguard reset`.

Surfaces:
- **`brainblast signguard <base64-tx>`** — decode + simulate + apply policy; exit 1
  on block. `--policy`, `--max-sol`, `--record`, `--no-sim`, `--rpc`, `--json`.
- **`brainblast signguard init`** — scaffold a secure-default `.brainblast/signguard.json`.
- **`brainblast signguard hook`** — `PreToolUse` entrypoint that parses recognized
  Solana CLI commands (`solana transfer`, `solana program set-upgrade-authority`,
  `spl-token transfer`) and applies the policy with no serialized tx in hand.
- **`inspectSigning(base64, { policy })`** — inline export agents call before signing.
- **`signguard session` / `reset`** — view / clear the cumulative ledger.

20 new tests; full package suite at 503.

## v0.8.0 — 2026-06-22

**Keyguard** — the safety net for irreplaceable Solana secrets in the age of
autonomous coding agents. An AI agent that helpfully runs `git clean -fdx` or
`rm -rf target/` can silently destroy a program's upgrade-authority keypair —
and the program is then immutable **forever**, with no recovery. The files that
matter most (keypairs, `.env`, seed phrases) are *correctly gitignored*, so git
can never restore them. Keyguard finds them, ranks blast radius, guards against
their deletion, and recovers them when prevention fails.

Five capabilities — **Identify → Guard → Vault → Audit → Rescue**:

- **`brainblast keys [dir]`** — a content-based classifier (the `solana-keygen`
  64-int signature with offline pubkey derivation, base58 secret keys, BIP39
  seed phrases, `.env` private keys / keypair path refs — never echoing a secret
  value) that ranks each secret by **blast radius**, resolved **on-chain**:
  ☠ TERMINAL (the sole upgrade authority of a live program), 🔴 FUNDS (holds
  SOL), 🟡 REBUILDABLE (a deployed program keypair — post-deploy it only set the
  address), ⚪ TRIVIAL. It reports the recovery truth for each: is this gitignored,
  so **git CANNOT restore it**? `--offline` skips the chain; exit 1 when a
  high-tier secret is committed (leak) or unbacked.

- **`brainblast guard`** — a **`PreToolUse` hook** that intercepts a destructive
  command *before it runs* and blocks it if its blast set hits an irreplaceable
  secret. Precision over string-matching: it runs `git clean -n` to get the exact
  file list, walks `rm -rf` directories, and catches redirects, `shred`/`truncate`/
  `dd`, `mv`/`cp` overwrites, and compound commands with `cd` tracking. Block
  messages name what dies, why git can't restore it, and the safe alternative
  (`vault backup` / `vault trash` / `git clean --exclude`). `guard install` prints
  the settings block; `guard <command>` is a direct/Codex mode.

- **`brainblast vault`** — encrypted (AES-256-GCM, scrypt KDF), content-addressed,
  versioned snapshots at `~/.brainblast/vault`, stored **outside any repo** so
  `rm`/`git clean` can't reach them. `backup` (dedup), `restore` (by path or
  pubkey, won't clobber without `--force`), `trash` (safe soft-delete), `status`,
  `list`, `verify`. Scans show a backed-up secret as "✓ safe in the Vault."

- **`brainblast keys --audit`** — a CI-gateable hardening posture check: every
  high-tier secret backed up, nothing committed to git, in-repo secrets gitignored,
  and single-key upgrade authorities flagged to migrate to a Squads multisig. Exit
  1 on any fail.

- **`brainblast rescue`** — honest, Solana-aware incident response after a possible
  deletion: what the Vault can bring back (♻), what's still at risk, what's safe,
  plus best-effort shell-history forensics for the command that likely did it.

83 new tests across the five capabilities; full package suite at 483.

## v0.7.6 — 2026-06-20

**Protocol Pack Library** — the distribution play. Every Solana app is built on
some combination of Jupiter, Raydium, Pyth, Meteora, Jito, … — each with its own
silent footguns. A pack per protocol means you opt into research-and-enforcement
for the exact stack you build on, before a line is written:

```
brainblast --packs jupiter,pyth .
```

- **Three new protocol packs** (each opt-in, pure-data, with `vulnerable/`+`fixed/`
  fixtures proven RED → GREEN):
  - **`pyth-price-unchecked-staleness`** — `getPriceUnchecked()` (ignores
    staleness) instead of `getPriceNoOlderThan(maxAge)`; can return an arbitrarily
    old price. Pairs with the live `brainblast oracle` check.
  - **`meteora-dlmm-zero-min-out`** — Meteora DLMM `swap({ minOutAmount: new BN(0) })`
    removes the minimum-output floor (sandwich exposure).
  - **`jito-bundle-zero-tip`** — a Jito bundle sent with a `0` tip is deprioritized
    and never lands, while the send call still returns a bundle id.
  Joins the existing Jupiter, Raydium, Metaplex, Solana-sendtx, and SPL packs —
  **8 bundled protocol packs**.
- **`brainblast --packs <name>`** now resolves a **protocol name** ("jupiter",
  "pyth") to its bundled pack, not just a filesystem path. **`brainblast packs`**
  lists the library. Packs ship inside the npm package (`dist/packs`), so
  `npx brainblast --packs jupiter,pyth` works with no checkout.
- **`object-arg-property-forbidden-literal` is now `BN(0)`-aware** — it flags the
  idiomatic Solana `new BN(0)` / `BN("0")` / `anchor.BN(0)`, not just bare `0`, so
  amount/slippage/tip rules catch real code.
- A CI guard test validates **every** bundled pack RED → GREEN. New
  `/brainblast-packs` slash command; `listBundledPacks` / `resolveBundledPackToken`
  exports. 12 new tests (439 total green).
- **Rename (corrects v0.7.5 naming):** the `brainblast economics` command is now
  **`brainblast fee-configs`**, the checker kind `economic-value-zero-or-missing` is
  now **`fee-configs-zero-or-missing`**, and the feature is the **Fee Config
  Validator**. Programmatic exports renamed accordingly (`FEE_CONFIGS`,
  `getFeeConfig`, `renderFeeConfigs*`); the `metaplex-seller-fee-zero` rule id is
  unchanged.

## v0.7.5 — 2026-06-20

**Fee Config Validator** — the Bags exploit, generalized. The Bags trap (a
creator wallet silently omitted from a fee split, earning $0 forever) was one
instance of a whole class: **a revenue-bearing field that, if omitted or zeroed,
silently defaults to no value** — the call succeeds, nothing reverts, and a fee /
royalty / reward is never collected, permanently.

- **New checker `fee-configs-zero-or-missing`** — validates a revenue field on
  a config/setup call: FAIL when the field is omitted (defaults to zero) or a
  literal `0`; PASS when present as a non-zero literal or a non-literal expression
  (intentionally set); CANT_TELL when no matching call. Robust to `as any` casts
  (real SDK code is full of them).
- **New bundled rule `metaplex-seller-fee-zero`** (HIGH) — a Metaplex token created
  with `sellerFeeBasisPoints` omitted or zero earns creators **no royalties on
  secondary sales**, permanently, with no migration path once minted. Vulnerable/
  fixed fixtures (RED→GREEN). Brings the bundled rule set to **18**.
- **`brainblast fee-configs [id]`** — a curated catalog of the silent zero-revenue
  class across **fees, royalties, and rewards** (Metaplex `sellerFeeBasisPoints`,
  Bags `userBps`, Token-2022 `transferFeeBasisPoints`, generic reward rates). Each
  entry maps to its detecting bundled rule or is marked `advisory`; an integrity
  test guarantees every referenced rule exists. `--json` for agents.
- New `/brainblast-fee-configs` slash command; programmatic exports
  (`FEE_CONFIGS`, `getFeeConfig`, …). 20 new tests (427 total green).

## v0.7.4 — 2026-06-20

**Live On-Chain Intelligence** — answers, from live RPC, the questions Solana devs
otherwise work out by hand on Solscan: *is the upgrade authority a multisig?* and
*is the oracle fresh?*

- **Live upgrade-authority classification** (extends `brainblast trust-graph`). The
  RPC probe already resolved the authority *address* but could only mark it
  `unknown`. It now reads the authority account's **owner program** to classify it:
  - System Program owner → **single-key** (a plain wallet — one key can replace the program)
  - Squads program owner → **multisig**
  - SPL Governance (Realms) owner → **dao**
  - anything else → `unknown`, with the owner program recorded (never a false single-key)
  The trust-graph renderer now shows the classifying owner and an at-a-glance
  **Trust** line per program: `authority · verified build · audited`. Known owners
  live in an extensible registry (`KNOWN_AUTHORITY_OWNERS`); set
  `classifyAuthority: false` to skip the extra lookup.
- **`brainblast oracle <account>`** — *is the oracle fresh?* A provider-agnostic
  freshness gate: rather than parse each oracle's (version-specific) binary layout,
  it measures the universal signal — the slot of the most recent transaction
  touching the account vs. the current slot. Reports `FRESH` / `STALE` /
  `NO_HISTORY` with slots/seconds behind; `--max-staleness-slots` /
  `--max-staleness-seconds` set the threshold (default 150 slots ≈ 60s).
  **Exit 1 on STALE or NO_HISTORY** for a pre-trade CI gate. `--json` for agents;
  markdown report at `.agent-research/oracle-freshness.md`.
- New `/brainblast-oracle` slash command; programmatic exports
  (`classifyUpgradeAuthority`, `checkOracleFreshness`, …) for AI-agent frameworks.
  20 new tests (407 total green).

## v0.7.3 — 2026-06-20

**Exploit Pattern Database** — research-to-enforcement on real on-chain incidents. A curated
catalog (`brainblast exploits`) maps public post-mortems to the bundled rule that statically
detects each one's root-cause pattern, so the code that lost the funds is the exact code the
rule fails on. Seeded with **$381.8M** of catalogued Solana losses across 4 patterns.

- **New rule `cpi-target-program-unverified`** (CRITICAL) — the **Wormhole** ($325M, Feb 2022)
  pattern: *"does this CPI verify its target program ID?"* Detects an Anchor handler that
  performs a cross-program invocation (`invoke` / `invoke_signed` / `CpiContext`) against a
  program-named account typed as raw `AccountInfo` / `UncheckedAccount` with no `address=`
  constraint and no in-body key check — letting an attacker substitute a malicious program.
  Fix: type the account `Program<'info, T>` or add `#[account(address = <expected>)]`. New
  `anchor-cpi-unverified-program` checker, with vulnerable/fixed fixtures (RED→GREEN).
- **`brainblast exploits [id] [--json]`** — lists the database (incident, loss, detecting rule)
  or explains one incident (match by incident id or rule id). Catalog seeded with Wormhole →
  `cpi-target-program-unverified`, Cashio ($48M) and Crema ($8.8M) → `anchor-unchecked-account-type`,
  and SPL mint impersonation → `solana-token-impersonation`. Writes
  `.agent-research/exploit-patterns.md`.
- **Rule-local provenance** — rules derived from a post-mortem carry an inline `exploit:` block
  (incident, date, loss, post-mortem URL). An integrity test guarantees every catalog entry's
  `ruleId` resolves to a real bundled rule (no false "we catch this" claims) and cross-checks
  rule-local provenance against the catalog to prevent drift.
- Programmatic exports (`EXPLOIT_PATTERNS`, `getExploitPattern`, renderers) for AI-agent
  frameworks. New `/brainblast-exploits` slash command. 16 → **17 bundled rules**; 387 tests green.

## v0.7.2 — 2026-06-20

**Deployment Intelligence** — a new `brainblast deploy-plan [dir]` command that answers the
two questions every Anchor builder works out by hand before `anchor deploy`: *how much SOL do
I need?* and *what's the exact ordered transaction sequence?*

- **Program-deploy economics** from the compiled `.so` under `target/deploy/`, modeled on the
  on-chain BPF **upgradeable** loader:
  - Program account rent (`rent(36)`).
  - Program data rent at the default **2× upgrade headroom** (`rent(45 + 2·len)`) — the large,
    non-recoverable lockup. Override with `--max-len-mult N`.
  - Transient **buffer** rent (`rent(37 + len)`) — refunded when the buffer drains at deploy.
  - Write-transaction count (binary chunked at ~1012 bytes) and base transaction fees.
- **Anchor `init` PDA accounting** — parses every `#[derive(Accounts)]` struct (tree-sitter-rust)
  for `init` / `init_if_needed` accounts and reports each one's `space`, rent, PDA `seeds`, and
  `payer` (treasury, config, …). Non-literal `space` expressions (e.g. `8 + State::INIT_SPACE`)
  are flagged and excluded from totals rather than guessed.
- **Ordered transaction sequence** — create buffer → write chunks → deploy → one `initialize`
  step per Accounts struct, each annotated with the rent it locks / refunds and its fee.
- Outputs a **wallet funding figure** (safe upper bound) and the **steady-state lockup**, both as
  a terminal summary and a markdown report at `.agent-research/deploy-plan.md`. `--program-len`
  models an uncompiled build; `--json` emits the full plan for an agent to act on.
- New `/brainblast-deploy-plan` slash command. 20 new tests (368 total green).

## v0.7.1 — 2026-06-20

**Pillar 2: Anchor/Rust Security Checkers** — three new static checker kinds for
Solana programs written with the Anchor framework, plus 6 fixtures and full test coverage.

- **`anchor-signer-constraint-missing`** (CRITICAL) — detects authority-named account fields
  (`authority`, `admin`, `owner`, `payer`, etc.) typed as `AccountInfo<'info>` without a
  `signer` constraint or `Signer<'info>` type. Anchor performs no signing check on
  `AccountInfo` — any key can be passed as the authority and privileged instructions will
  execute without signature validation. Fix: use `Signer<'info>` or add `#[account(signer)]`.
  Checker: `anchor-account-missing-constraint`.

- **`anchor-unchecked-account-type`** (HIGH) — detects `UncheckedAccount<'info>` fields in
  Anchor instruction handlers. Anchor requires a `/// CHECK:` safety comment on these fields
  but performs zero runtime validation — ownership, signer status, and data layout are
  entirely unchecked. AI coding agents routinely use `UncheckedAccount` as a placeholder,
  add a boilerplate CHECK comment, and ship without actual validation logic.
  Fix: replace with `Account<'info, T>`, `Signer<'info>`, or `SystemAccount<'info>`.
  Checker: `anchor-forbidden-account-type`.

- **`anchor-pda-find-program-address`** (HIGH) — detects `Pubkey::find_program_address`
  calls inside instruction handler bodies. (1) Expensive: iterates bump seeds 255→0, up to
  255 SHA256 hashes per call. (2) Unsafe: if the canonical bump was stored at init time,
  re-deriving it may silently use a different nonce. Fix: use `#[account(seeds=[...],
  bump=state.bump)]` on the Accounts struct — Anchor re-derives and verifies at zero cost.
  Checker: `anchor-body-call-pattern`.

- Updated logo: `assets/brainblast.png` replaces `assets/brainblast.jpg`.
- 348/348 tests green.

## v0.7.0 — 2026-06-17

The Solana power release: six features that extend brainblast from "audit before
you ship" to a full-lifecycle safety layer for Solana developers and AI agents.

### Batch token risk scanner (`brainblast batch <file>`)

- **`brainblast batch`** — pass a list of contract addresses (a portfolio, a launchpad's listings, a DEX routing whitelist) and get back a parallel-processed, risk-ranked matrix: identity status, impersonation flag, Rico risk score, snipers, bundle clusters, deployer flags. Built for builders curating which tokens their app should support.
- Bounded-concurrency scan (`--concurrency`, default 5), input dedupe, results ranked with impersonators floated to the top, then by risk score. Accepts newline-separated or JSON-array files.
- `--fail-on SCORE` and the impersonator count drive exit code (1 if any impersonator or high-risk token), so it gates a curation pipeline. `--offline` for identity-only, `--json` for the full matrix. Programmatic exports: `batchScan`, `parseMintList`.

### Launch pre-flight for pump.fun / SPL builders (`brainblast pump-check <mint>`)

- **`brainblast pump-check`** — run before you list or integrate a token. Reads the on-chain SPL mint account, verifies identity, and folds in a Rico Maps forensic scan into one **GO / CAUTION / NO-GO** checklist.
- **The two silent footguns it catches up front:** a *live mint authority* (the deployer can print unlimited supply and dilute every holder → NO-GO) and a *live freeze authority* (they can freeze any user's token account → CAUTION) — both one `getAccountInfo` call away.
- Checklist also covers identity/impersonation, Rico risk score (`--fail-on`, default 70), snipers, bundle clusters, holder distribution, and deployer flags. Exit 1 on NO-GO.
- `--offline` does the on-chain + identity checks with no Rico call; graceful skip when no API key. Programmatic exports: `pumpPreflight`, `parseMintAccount`.

### Live on-chain monitoring (`brainblast watch-chain <program-id>`)

- **`brainblast watch-chain`** — moves brainblast from "before you ship" to "while it's live." Polls a deployed program and emits an NDJSON anomaly stream: **upgrade-authority changes** (the single most dangerous on-chain event for a program's users), bursts of new activity, and poll errors.
- Poll-based — no websocket dependency. `--interval <seconds>`, `--limit N`, `--rpc URL`. Pairs naturally with the bundled drift-watch GitHub Action.
- `pollChainOnce(programId, state, opts)` is a pure, single-cycle primitive (injectable fetch + authority probe) so the monitor is fully deterministic and testable; the daemon loop is a thin NDJSON wrapper mirroring `brainblast watch`.

### Program trust score / security oracle (`brainblast score <program-id>`)

- **`brainblast score`** — a single 0–100 trust score and A–F grade for any deployed Solana program, composed from the trust graph: upgrade-authority kind (renounced > DAO > multisig > single-key), verified-build status, audit history, directory curation, and cross-cluster parity.
- Returns a transparent weighted factor breakdown (each factor's points/max + a plain-English reason) so the score is auditable, not a black box. JSON output makes it a contract other tools, protocols, and frontends can consume.
- `--min A|B|C|D|F` turns it into a CI gate (exit 1 below the bar); `--no-probe` runs offline against the curated directory + cache. Programmatic exports: `scoreProgram`, `scoreFromProgram`, `gradeForScore`.

### Anchor IDL → auto-generated rules (`brainblast idl-rules <idl.json>`)

- **`brainblast idl-rules`** — turns any Anchor IDL into a brainblast rule that scans the program's Rust source and verifies every account constraint the IDL promises is actually present. Flips brainblast from a fixed set of curated rules to *unlimited rules derived from your own program's spec*.
- New checker kind **`anchor-account-matches-idl`**: for each instruction handler, every account the IDL marks `isSigner` must be a `Signer<'info>` (or carry a `signer` constraint), and every `isMut` account must carry `mut`/`init`. A missing constraint is a silent authorization hole → FAIL.
- Handles Anchor ≥0.30 (`metadata.name`) and older IDLs, nested composite accounts, and camelCase↔snake_case account/handler naming.
- `--out <dir>` writes the generated rule YAML into a pack directory; `--json` prints the rule objects. Programmatic exports: `parseIdl`, `generateRulesFromIdl`, `buildConstraintParams`.

### AI-agent transaction firewall (`brainblast firewall <base64-tx>`)

- **`brainblast firewall`** — inspects a serialized Solana transaction *before* an autonomous agent signs it. Decodes the transaction locally (legacy + v0/versioned, including address lookup tables), flags dangerous instruction patterns, and (with an RPC endpoint) simulates it to surface the full CPI tree.
- **Static heuristics:** delegate-approval drains (token `Approve`/`ApproveChecked`), authority changes (token `SetAuthority`), program upgrades and upgrade-authority changes (BPF Upgradeable Loader), and any call to an unrecognized program.
- **Verdict model:** `allow` / `warn` / `block`. Exit 1 on `block` (or any `warn` with `--strict`) — a CI/agent gate, not just a report.
- **Programmatic API:** `inspectTransaction(base64, opts)` exported from the package so AI-agent frameworks can call it inline before signing. Network calls go through an injectable `fetchImpl`; the whole pipeline is deterministic and offline-testable.
- `--no-simulate` for fully-offline static analysis, `--message-only` for bare messages, `--json` for machine-readable output.

## v0.6.4 — 2026-06-16

### Rico Maps token identity + quality (`brainblast rico <CA>`)

- **`brainblast rico <CA>`** — new CLI subcommand combining identity pre-check and forensic quality scan in one command
- **Token identity (Layer 1 — offline):** bundled canonical mint snapshot covering 12 blue-chip Solana tokens (USDC, USDT, SOL, WSOL, JUP, BONK, WIF, PYTH, RAY, ORCA, MNGO, mSOL). No network required.
- **Token identity (Layer 2 — live):** falls back to Jupiter token registry (`tokens.jup.ag`) for tokens not in the bundled snapshot
- **Impersonation detection:** flags tokens claiming a canonical symbol (USDC, JUP, etc.) at a wrong mint address
- **Token quality:** calls Rico Maps `/api/v1/analyze` — risk score (0–100), holder concentration, cabal count, snipers, bundle clusters, deployer flags (mint-authority-live, freeze-authority-live, metadata-mutable)
- **Graceful API key handling:** anonymous free tier (10 req/min, 1k/month) attempted first; on auth failure, prompts to enter key or skip quality scan
- **Exit 1** on: impersonation detected, `--expect` symbol mismatch, or risk score ≥ `--fail-on` threshold (default 70)
- **`/brainblast-rico-maps`** slash command registered by installer

### Static checker: `solana-token-impersonation`

- **13th bundled rule:** offline scan of TypeScript source for mint constants whose symbol name doesn't match the canonical address (e.g. `const USDC_MINT = new PublicKey("<USDT address>")`)
- Scopes to files importing `@solana/web3.js` or `@solana/spl-token` (`requiresImport: true`) to prevent cross-contamination
- Detects bare string literals, `new PublicKey("...")`, and object-literal properties (`{ USDC: "..." }`)
- Fixtures: `mintidentity/vulnerable` (FAIL) and `mintidentity/fixed` (PASS)

### SKILL.md enrichment

- Step 3f: Solana token identity and quality research guidance

## v0.6.3 — 2026-06-16

- **Patch:** fix stale `SHA256SUMS` checksum for `SKILL.md` — `v0.6.2` updated `SKILL.md`
  but forgot to regenerate the hash, causing the installer to reject the file with a checksum
  mismatch. No functional changes.

## v0.6.2 — 2026-06-16

- **3 new Solana ecosystem packs** (from brainblast-scout), all PROVEN via `npm run synth` RED→GREEN:

  - **`solana-sendtx-unconfirmed`** (HIGH) — detects `connection.sendTransaction()` used in value-bearing
    paths without a confirmation step. `sendTransaction()` is fire-and-forget: it returns a signature
    immediately regardless of whether the transaction lands on-chain. Transactions can silently drop
    due to congestion, blockhash expiry, or a validator restart — code that credits a user right after
    this call will think it succeeded when nothing moved. Fix: use `sendAndConfirmTransaction()`.
    Checker: `forbidden-call-replacement`. SDK: `@solana/web3.js`.

  - **`metaplex-nft-royalty-zero`** (HIGH) — detects `metaplex.nfts().create()` called with
    `sellerFeeBasisPoints: 0`, which bakes zero royalties into the NFT's on-chain metadata at mint
    time. Metaplex token-metadata is **immutable** after mint — creators can never recover royalties
    without burning and reminting the collection. AI code generators emit `0` as a placeholder and
    launch teams sometimes leave it in to appear creator-friendly. Either way, the economic harm is
    permanent and silent. Fix: set `sellerFeeBasisPoints` to the intended basis points (e.g. `500` = 5%).
    Checker: `object-arg-property-forbidden-literal`. SDK: `@metaplex-foundation/js`.

  - **`raydium-compute-zero-slippage`** (HIGH) — detects `raydium.liquidity.computeAmountOut()` called
    with `slippage: 0`, which sets `minAmountOut === amountOut` with zero tolerance. Any price
    movement between compute and on-chain execution — including a sandwich attack — executes the swap
    at a worse effective rate with no minimum-output floor. Fix: set `slippage` to a nonzero value
    (e.g. `0.5` = 0.5%). Checker: `object-arg-property-forbidden-literal`. SDK: `@raydium-io/raydium-sdk-v2`.

- Research Finding JSONs at `packages/core/findings/solana-sendtx-unconfirmed.json`,
  `packages/core/findings/metaplex-nft-royalty-zero.json`,
  `packages/core/findings/raydium-compute-zero-slippage.json`.

## v0.6.1 — 2026-06-16

- **Evidence layer** — every risk finding now requires a `evidence` block in `report.json` with a
  verbatim `quote` from the source, the source `url`, and the access date (`browsedAt`). The
  `/brainblast` research skill enforces this in the risk template and Step 6b rules, and the schema
  validates it. Grounded evidence makes findings verifiable and shareable.

- **Three new bundled rules** (12 total):
  - `prisma-raw-injection` (CRITICAL) — detects `$queryRaw` / `$executeRaw` / `$queryRawUnsafe` /
    `$executeRawUnsafe` calls that receive taint from `req.body`, `req.query`, or `req.params`
    (cross-file taint tracking, up to 2 hops). Raw queries that interpolate user input are
    vulnerable to SQL injection.
  - `open-redirect` (HIGH) — detects `res.redirect()` or `res.setHeader()` calls that receive
    taint from `req.query`, `req.params`, `req.body`, or `req.headers`. An attacker who controls
    the redirect destination can phish users by bouncing them to a malicious site via a
    trusted domain.
  - `jsonwebtoken-algorithm-pinned` (CRITICAL) — detects `jwt.verify()` calls that omit the
    `algorithms` option, and `jwt.decode()` calls used instead of `verify()`. Without a pinned
    algorithm list an attacker can switch the header to `"alg": "none"` (no signature) or exploit
    RS256/HS256 confusion to forge arbitrary tokens.

- **Drift alerting** (`brainblast drift`) — weekly OSV.dev scan of every pinned dependency,
  compared against a stored baseline at `.agent-research/drift-baseline.json`. Exits 0 when
  nothing changed, exits 1 and opens a GitHub issue when new advisories appear. Bundled
  `.github/workflows/drift-watch.yml` runs on a Monday cron and supports manual baseline resets
  (`workflow_dispatch` with `update_baseline: true`).
  ```sh
  brainblast drift [dir]                # check for new advisories vs baseline
  brainblast drift [dir] --update-baseline  # reset baseline to current state
  brainblast drift [dir] --json         # machine-readable output
  ```
  New exports: `checkDrift`, `seedPackages`, `renderDriftText`, `DriftPackage`, `DriftAdvisory`,
  `DriftBaseline`, `DriftResult` (from `brainblast` npm package).

- **`packages/core` 0.6.1**: 9 new tests (checkers) + 8 drift tests (239 total, all green).

## v0.6.0 — 2026-06-16

- **GitHub Action** (`action/`): drop `uses: DSB-117/brainblast/action@v0.6.0` into any
  repository's workflow. Runs `npx brainblast --ci`, parses `report.json`, and posts a
  formatted risk-report PR comment (risk heatmap, top risks, static-audit findings) using
  the built-in `GITHUB_TOKEN`. Re-runs collapse the previous comment. Configurable `fail-on`
  threshold (default: `critical`). No secrets required for public repos. Copy-paste example
  at `examples/ci/brainblast-audit.yml`.

- **MCP Server** (`brainblast mcp`): start a stdio Model Context Protocol server exposing
  three tools any Claude-powered agent or IDE can call:
  - `brainblast_audit(dir)` — run the full static auditor on a local directory.
  - `brainblast_osv_check(ecosystem, package, version)` — query OSV.dev for known advisories.
  - `brainblast_diff(ecosystem, package, from_version, to_version)` — compare risk profiles.
  Add to `claude.json` MCP config with `"command": "npx", "args": ["brainblast@latest", "mcp"]`.

- **Upgrade risk diff** (`brainblast diff`): compare the OSV advisory risk profile between
  two package versions. Shows introduced advisories (new risk), resolved advisories (fixed),
  and unchanged advisories, plus a signed risk score. Exits non-zero when the upgrade
  increases risk so it can gate a lockfile bump in CI.
  ```
  brainblast diff lodash@4.17.20 lodash@4.17.21
  brainblast diff stripe@12.0.0 stripe@13.0.0 --ecosystem npm
  brainblast diff serde@1.0.0 serde@1.0.195 --ecosystem crates.io
  ```

- **`packages/core` 0.6.0**: new public exports `queryOsv`, `diffVersions`, `riskScore`,
  `renderDiffText`, `renderDiffMd`, `OsvAdvisory`, `DiffResult` (from `brainblast` npm package).
  New `@modelcontextprotocol/sdk` runtime dependency.

## v0.5.5 — 2026-06-15

- **Auto-seed the component inventory from lockfiles**: the `/brainblast` research skill now
  runs `scripts/seed-inventory.sh` at the start of Step 1, scanning `package-lock.json`,
  `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock`, `requirements.txt`, `Cargo.lock`, `go.mod`,
  `Gemfile.lock`, and `composer.lock` for exact pinned versions. A component matching a
  seeded entry uses that version verbatim (Confidence: High, source = lockfile) instead of
  inferring it from prose — making every downstream step, especially the OSV cross-check
  (v0.5.4), keyed on ground truth. The component inventory table gains a `Source` column.

## v0.5.4 — 2026-06-15

- **Security-advisory cross-check (OSV)**: the `/brainblast` research skill now queries the
  public [OSV.dev](https://osv.dev) API (no account, no key) for every component with a
  resolved version, and folds known CVEs/advisories into `report.json` as `critical`/`high`/
  `medium`/`low` risks with `advisoryId` and `advisoryUrl`. New `scripts/osv-check.sh
  <ecosystem> <package> <version>` does the query; runs every time (even on a cache HIT)
  since advisories are published on their own timeline. `schema/report.schema.json` gains
  optional `advisoryId`/`advisoryUrl` fields on risk entries.

## v0.5.3 — 2026-06-15

- **`/brainblast-scout` skill**: end-to-end pipeline for an agent to scout real-world
  footguns in external SDKs/protocols, synthesize + prove a rule pack (via the existing
  `synth-prove` RED→GREEN gate), package it with `brainblast pack init`/`validate`, submit
  it to the pack registry, and stake `$BRAIN` on it.
- **`scripts/agent-stake`**: standalone script that pays a pack stake from a dedicated,
  capped "ops wallet" — enforces a per-transaction cap (`AGENT_STAKE_MAX_USD`) and a
  cumulative session cap (`AGENT_STAKE_SESSION_CAP_USD`), reads its key only from
  `AGENT_OPS_WALLET_SECRET`, and never logs it.

## v0.5.0 — 2026-06-13

- **Pluggable rule packs**: `--packs <dir1>,<dir2>,...` loads third-party rule packs
  (`brainblast-pack.yaml` manifest + `rules/` + `fixtures/`) alongside bundled rules and
  project-local `.agent-research/rules/`, with shadow protection (a pack cannot override a
  bundled or project rule id).
- **`brainblast pack init`** scaffolds a new pack (manifest, `rules/`, `fixtures/`).
  **`brainblast pack validate`** loads a pack's manifest + rules and runs the same RED → GREEN
  prove gate as bundled rules.
- **Opt-in graduation telemetry**: `brainblast fix --apply` can record one-way-hashed
  `{pack_id, rule_id, repo_hash, user_hash}` events to `.agent-research/telemetry.ndjson` when
  enabled via `BRAINBLAST_TELEMETRY=1` or `.agent-research/config.json`.
- **`brainblast telemetry submit`** sends recorded events to the registry server
  ([registry.brainblast.tech](https://registry.brainblast.tech)), which tracks per-rule
  graduation progress (5 distinct repo/user pairs within 90 days) — the basis for the
  pack-author bounty pool.
- **New checker kind `literal-multiplier-wrong-constant`**, enabling pure-data rule packs that
  catch "amount scaled by the wrong constant" traps (e.g. `LAMPORTS_PER_SOL` used where
  `10**decimals` was intended), plus a fixer so `brainblast fix --apply` can mechanically
  resolve them (swap the wrong constant for `10 ** decimals` when `decimals` is in scope).
  First consumer: the [spl-amount-scaling](https://github.com/DSB-117/brainblast-spl-amount-pack)
  pack, which found a real instance of this bug in a public SPL token-launcher dapp.
- New companion repos: [brainblast-registry](https://github.com/DSB-117/brainblast-registry)
  (telemetry ingestion, pack registry mirror, memo+indexer submission staking) and
  [brainblast-pack-registry](https://github.com/DSB-117/brainblast-pack-registry) (public pack
  index).

See `packages/core/CHANGELOG.md` for details.

## v0.4.3 — 2026-06-11

- **Graph-based, project-wide cross-file taint tracking**: `env-secret-leaked-to-sink` now
  tracks tainted values across the *entire project*, not just within a file — forward
  through helper functions (same-file or cross-file via imports) and backward into functions
  that are called elsewhere with a tainted argument, up to 2 hops.
- **New rule `request-input-command-injection`** (critical): flags untrusted
  `req.body`/`req.query`/`req.params`/`req.headers` data flowing into `exec`/`execSync`/
  `spawn`/`spawnSync`/`execFile`/`execFileSync`, including across files.
- New generalized `taint-to-sink` checker kind powers both rules.

See `packages/core/CHANGELOG.md` for details.

## v0.4.2 — 2026-06-11

- **Cross-file taint tracking**: new `env-secret-leaked-to-sink` rule catches secret-shaped
  `process.env.X` values that flow — directly, via a local variable, or one hop through a
  same-file helper — into a logging/response sink (`console.log`, `res.json`, `res.send`, etc.).
- **`brainblast fix [--apply] [--branch]`**: lists (and, with `--apply`, applies) every confirmed
  FAIL's mechanical `fix.diff`, re-audits to confirm RED -> GREEN, and optionally commits the
  result to a new `brainblast/auto-fix-<timestamp>` branch.

See `packages/core/CHANGELOG.md` for details.

## v0.4.1 — 2026-06-11

- **Diff-aware scanning (`brainblast --since <ref>`)**: audit only what changed in `git diff <ref>`
  — function-scoped for TS/Rust, whole-file for config/env. Fast enough for per-commit/PR CI.
- **Config/env auditing**: new `"config"` detection lang and bundled rule
  `env-secrets-committed`, flagging real-looking secrets committed in tracked `.env*` files.
- **`brainblast watch`**: new daemon mode that re-scans on file save and streams structured
  NDJSON findings on stdout for an agent daemon to consume directly.

See `packages/core/CHANGELOG.md` for details.

## v0.4.0 — 2026-06-11

- **Precision pass**: eliminated ~48 false positives across 7 real-world repos via a new
  `requiresImport` detection guard, a `cant_tell` fallback for unresolvable delegation patterns in
  the Stripe webhook checker, and tightened Stripe/Privy rule scoping. See
  `packages/core/CHANGELOG.md` for details.
- **Fix-it mode**: FAIL results now include an additive `fix` field — a unified-diff patch for
  mechanical fixes (Stripe raw-body, Privy `audience`/`issuer`) or guidance text where an automatic
  patch isn't safe to synthesize. New `packages/core/src/fixers/` registry.
- **Living memory**: brainblast persists `.agent-research/memory.json` per repo, recording fix
  history across runs and annotating new FAILs with a `precedent` when the same rule was already
  fixed elsewhere in the repo.

## v0.2.0 — 2026-06-07

- **`brainblast` deterministic auditor + `npx brainblast` CLI (`packages/core`).** A zero-LLM, offline static auditor that scans a Node/TS repo for catastrophic AI-integration traps and generates the behavioral contract test that proves each is fixed. Ships two rules today (Stripe webhook raw-body signature verification; Privy/JWT signature + `aud` + `iss`), each a pure-data `rules/*.yaml` (facts) bound to human-vetted checker + test templates by `kind` — no executable code in a rule. `brainblast <dir> [--ci] [--strict]` emits `report.json` (with `checks[]`/`checkTotals`) and a pass/fail exit code; the committed gate consumes it (confirmed FAIL gates; CANT_TELL warns unless `--strict`). The schema gained additive `checks[]`/`checkTotals` (still `schemaVersion "1.0"`). The research agent can grow coverage by authoring project-local `.agent-research/rules/*.yaml` (validated, can't shadow bundled rules; new skill **Step 6c**). Packaged for npm (tsup build, `engines node>=18`, provenance) with a `brainblast-v*` publish workflow. Engine is unit-tested (50 tests, ~97% stmt coverage), CSO-reviewed (static audit never executes scanned code; YAML loading is RCE- and prototype-pollution-safe), and proven end-to-end from a packed tarball.
- **`--ci` mode + exit-code gate.** A non-interactive mode (`--ci`, or `BRAINBLAST_CI=1`) that never prompts and picks documented defaults (deterministic requirements-file precedence; no inventory confirmation), so Brainblast runs end-to-end in a pipeline. New deterministic gate `scripts/brainblast-gate.sh` reads `report.json` and exits non-zero when any risk at/above a threshold remains (`--fail-on=critical|high|medium|low`, default `critical`) or the verdict is `blocked` — exit `0` pass / `1` gated / `2` usage error; defaults to the newest run when no path is given; needs only `python3`. Documented GitHub Actions sample at `examples/ci/github-actions.yml`. Behavior landed across all four adapters; README gains a Continuous integration section.
- **Machine-readable `report.json`.** Every run now emits a structured `report.json` alongside `final-report.md`: components (with type/version/status), each risk with a `severity` enum, pre-coding decisions, requirements corrections, and run metadata. Stable, versioned contract (`schemaVersion: "1.0"`) committed at `schema/report.schema.json`. `scripts/validate.sh` validates the schema and every `examples/*/report.json` against it — full Draft-07 check when `jsonschema` is installed, a built-in schema-driven fallback otherwise, plus a `riskTotals == summed-severities` cross-check either way. Two complete examples added (`examples/bags-api/report.json`, `examples/stripe-privy/report.json`). Landed across all four adapters.
- **Incremental runs / component cache.** Research is now cached per component, keyed by `name@version`, in `.agent-research/cache/`. A re-run reuses any component whose version is unchanged and re-researches only what changed (new components or version bumps); components with no resolvable version are always re-researched. New `--fresh` flag (or `BRAINBLAST_FRESH=1`) bypasses the cache. The final report's Components table and the completion summary now distinguish *fresh this run* from *reused from cache (fetched DATE)*. Landed across every adapter (`SKILL.md`, `adapters/codex-skill/SKILL.md`, `adapters/codex/AGENTS.md`, `adapters/generic/PROMPT.md`); README and ROADMAP updated.

## v0.1.4 — 2026-06-04

- Installer now verifies the SHA-256 of **every** fetched file: the slash-command files (`commands/brainblast.md`, `commands/brainblast-update.md`) and the Codex skill package (`adapters/codex-skill/SKILL.md`, `agents/openai.yaml`) now route through `fetch_verified` instead of plain `curl`, closing a gap where those four files were written unverified
- README: added a **Capabilities** section summarizing the full feature set
- ROADMAP: refreshed the intro to reflect the shipped v0.1.x state

## v0.1.3 — 2026-06-04

- **Executive Summary** at the top of `final-report.md` — a 30-second human read: what's being built, a go/no-go verdict, the top risk, the one irreversible decision, and the biggest spec gap
- **Risk Heatmap** in `final-report.md` — a component × severity (Critical/High/Medium/Low) count table with the CRITICAL and HIGH risks listed by name
- **Auto-injection** (new Step 7) — on completion, Brainblast writes an idempotent, marker-delimited pointer to the report into the project's `CLAUDE.md` (or `AGENTS.md` on Codex) so the next coding session loads it automatically; remove the `BRAINBLAST:REPORT` block to opt out
- All three report changes land across every adapter: `SKILL.md`, `adapters/codex-skill/SKILL.md`, `adapters/codex/AGENTS.md`, `adapters/generic/PROMPT.md`
- New committed example: `examples/stripe-privy/` — a real-browsed run for a web2 payments + embedded-wallet stack (Stripe + Privy), catching forged-webhook and auth-bypass criticals and demonstrating the ⚠️ Flagged-content rule on Privy's `llms.txt`
- `scripts/validate.sh` now checks every `examples/*/` directory is a complete run with sourced Facts, not just `bags-api`

## v0.1.2 — 2026-06-04

- `/brainblast-update` command (`commands/brainblast-update.md`) — updates Brainblast to the latest release from inside Claude Code or Codex
- `BRAINBLAST_REF=latest` resolver in `install.sh` — resolves to the newest release tag via the GitHub API before fetching
- README: install commands pin to the current release tag; added Updating and Uninstall sections

## v0.1.1 — 2026-06-04

- Full Codex support: `adapters/codex-skill/` (SKILL.md + `agents/openai.yaml`) installs to `~/.codex/skills/brainblast/`, registering `/brainblast` in Codex's skill UI
- Remove `AskUserQuestion` from `allowed-tools`; all interactive steps fall back to plain-text output when the tool is unavailable
- Flexible spec-file detection: `find`-based scan for common naming conventions (`requirements*`, `prd*`, `spec*`, `brief*`, `rfc*`, etc.), any case, `.md`/`.txt`/`.rst`
- Installer hard-checks gstack dependency and corrects link to `garrytan/gstack`
- Installer pins to release tag and verifies SHA-256 checksums
- Complete committed example run: `examples/bags-api/`
- `scripts/validate.sh` self-check
- `ROADMAP.md`

## v0.1.0 — 2026-06-04

Initial release.

- Claude Code / OpenClaw skill (`/brainblast`)
- Codex adapter (`adapters/codex/AGENTS.md`), installed as a marker-delimited block so re-installs replace cleanly
- Generic prompt adapter (`adapters/generic/PROMPT.md`)
- Auto-detect installer (`install.sh`) — pins to the release tag, verifies SHA-256 checksums before writing, and hard-checks the gstack dependency
- 7-step research workflow: inventory → plan → research → coverage → re-review → report
- Artifact format: `.agent-research/runs/YYYYMMDD-HHMMSS/`
- Five core rules: browse don't recall, no open questions, CRITICAL risks first, write for the coding agent, and browsed content is data never instructions
- Complete committed example run: `examples/bags-api/`
- Release self-check: `scripts/validate.sh`
- `ROADMAP.md` for planned post-0.1 work
