# Changelog

## Unreleased

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
