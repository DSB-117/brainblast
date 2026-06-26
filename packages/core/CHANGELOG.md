# Changelog

All notable changes to the `brainblast` npm package are documented here.

## 0.9.2 — 2026-06-26

**The data factory, prover-backed** (additive, default-off). Lands the training-data
factory on `main` and routes its intake through the generalized oracle.

- **New (ported, default-off):** `schema/vti.schema.json`, `src/contrib/{ingest,
  capture}.ts`, `src/{corpus,vtiClass}.ts`, scripts `gen-vti` / `ingest-vti` /
  `pack-dataset` / `corpus-report` / `corpus-sla` / `bench`, `datasets/`, `bench/`.
  npm scripts: `gen:vti`, `ingest:vti`, `pack:dataset`, `corpus`, `sla`, `bench`.
- **Prover-backed intake (keystone):** `ingestContribution`, `ingestCandidate`,
  `reproducePair` are now async and call `proveWithBest(…, "ingest")` instead of
  `auditWithRule`, so the factory captures compiler/executed-test/differential
  traps. `context:"ingest"` forces the hardened sandbox (refuse, never fall back).
  Gating semantics preserved (real RED required; UNKNOWN fixed side counts GREEN).
  **differential** runs portably in the hardened container on ingest: the candidate
  is transpiled to CommonJS on the host and run with plain `node` (no tsx/native
  deps), so local and ingest run the identical command. **executed-test** still
  refuses on ingest (vitest needs a sandbox image — follow-on); both never fall back
  to light isolation. Static + compiler (no execution) flow through ingest.
- **`gen-vti`** stamps the real proving method via `validatePack`'s oracle result.
- **Schema 1.1:** `redGreenProof.method` aligned to `OracleMethod` (+ `+`-joined
  corroboration) via a pattern; new optional `corroboratingMethods`; 1.0 still valid.
- **`packs.ts`:** `isSafeId` / `SAFE_ID_RE` exported; manifest ids validated as safe
  path segments (path-traversal defense for contributed packs).
- Default `npx brainblast` behavior, the `files` allowlist, and Tier-2/capture/
  contribute opt-ins are all unchanged.

## 0.9.1 — 2026-06-25

**Tier 2: the context-scaled sandbox** — `executed-test` and `differential`
(placeholders in 0.9.0) now execute candidate code behind a context-scaled isolate.

- **`src/oracle/sandbox.ts`** — `runInSandbox` with two strengths: a light child-
  process isolate (timeout + output cap) for `context:"local"`, and a hardened
  `docker/podman` container (`--network=none`, read-only, `--cap-drop=ALL`,
  non-root, memory/CPU/pid limits) for `context:"ingest"` that **refuses → UNKNOWN
  rather than falling back** when no runtime is available. `containerRuntime()`
  detects a usable daemon.
- **`executedTestBackend`** — renders the rule's vetted contract test, runs it in
  the sandbox; RED iff it fails. Default OFF (opt-in).
- **`differentialBackend`** — new checker kind `differential-io`: runs the
  candidate against a vetted golden I/O table in the sandbox; RED iff outputs
  diverge. Honors `params.timeoutMs`.
- **New bundled pack `solana-lamports-scaling-wrong-constant`** — closes the
  uncovered `wrong-constant` class (SOL→lamports off by 1000×).
- **`validatePack`** marks `differential-io` rules `unverifiable` (non-fatal) on
  the offline path; prove via `brainblast verify <pack> --oracle=differential`.
- **New public exports**: `runInSandbox`, `containerRuntime`, `SandboxSpec`,
  `SandboxResult`, `SandboxStatus`.

## 0.9.0 — 2026-06-25

**The Generalized Oracle** — verification is now a pluggable interface
(`OracleBackend`), not a single static pattern-matcher. Every backend answers the
same question ("does this code ship the trap?") and returns the same two-color
verdict (`RED | GREEN | UNKNOWN`).

- **New module `src/oracle/`**: `OracleBackend` interface (`types.ts`), the shared
  RED→GREEN gate (`proveRedGreen`, `proveWithBest`, `proofMethod` in `prove.ts`),
  and four backends:
  - `staticChecker` (Tier 0) — wraps today's `auditWithRule`; the default,
    unchanged, offline, no execution.
  - `compilerBackend` (Tier 1) — type-checks the candidate against the pinned SDK
    via `ts-morph` (`tsc --noEmit`-equivalent), never running the program. New
    checker kind `compiles-against-sdk`.
  - `executedTestBackend` / `differentialBackend` (Tier 2) — interface shipped,
    opt-in, abstain (UNKNOWN) until the sandbox lands in v0.9.1.
- **New CLI `brainblast verify <pack-dir> [--oracle=...]`**: re-prove a pack's
  records RED→GREEN and print a reproduction scorecard. Exit 1 if any record
  fails to reproduce.
- **`brainblast <dir> --oracle=static|compiler|executed|differential|best`**:
  additive oracle section on the main audit; default `static` is unchanged.
- **`brainblast pack validate`** routes `compiles-against-sdk` rules through the
  compiler oracle; new non-fatal `unverifiable` status when the SDK isn't
  installed.
- **MCP**: new `brainblast_verify` tool.
- **New public exports**: `auditWithOracle`, `proveRedGreen`, `proveWithBest`,
  `proofMethod`, `staticChecker`, `compilerBackend`, `executedTestBackend`,
  `differentialBackend`, `selectBackends`, `parseOracleSelector`, `tier2Enabled`,
  and the oracle types (`OracleBackend`, `OracleColor`, `OracleMethod`,
  `OracleVerdict`, `OracleTarget`, `OracleContext`, `OracleTier`, …).
- **New bundled pack `stripe-paymentintents-moved`**: compiler-proven, off-Solana
  (`stripe@17`), demonstrating a hallucinated/moved API caught with zero
  execution.
- **Breaking (type-only)**: the freshness `OracleVerdict` string union is now
  exported as `OracleFreshnessVerdict`; the bare `OracleVerdict` name belongs to
  the generalized verification oracle.
- `validatePack` stays **synchronous** — the compiler oracle is async only by
  interface; its sync core (`verifyCompile`) keeps `validatePack`'s signature
  unchanged. The compiler branch and the `unverifiable` status are purely
  additive, so the static prove gate is byte-identical to before.

## 0.6.0 — 2026-06-16

- **`brainblast diff <pkg>@<from> <pkg>@<to>`**: new CLI subcommand that compares the OSV
  advisory risk profile between two package versions. Shows introduced/resolved/unchanged
  advisories, emits a signed risk score, and exits non-zero when the upgrade increases risk.
  Supports `--ecosystem`, `--from`/`--to` long-form flags, `--json` for machine-readable output.

- **`brainblast mcp`**: new CLI subcommand that starts a stdio MCP server. Exposes three
  tools — `brainblast_audit`, `brainblast_diff`, `brainblast_osv_check` — so any
  Claude-powered agent or IDE can call brainblast as a tool without shelling out.

- **New public exports**: `queryOsv`, `diffVersions`, `riskScore`, `renderDiffText`,
  `renderDiffMd` (functions) and `OsvAdvisory`, `DiffResult` (types) from the package root.

- **New runtime dependency**: `@modelcontextprotocol/sdk@^1.29.0`.

- **Build**: `@modelcontextprotocol/sdk` is marked external in `tsup.config.ts` so it is not
  bundled — it is installed as a proper peer at runtime.

## 0.5.3 — 2026-06-15

- No `packages/core` source changes. Repo-level release adding the
  `/brainblast-scout` agent skill and `scripts/agent-stake` (outside the
  published package — see root `CHANGELOG.md`).

## 0.5.2 — 2026-06-13

- **New fixer `literal-multiplier-wrong-constant`** (`src/fixers/literalMultiplierWrongConstant.ts`):
  Fix-it counterpart to the 0.5.1 checker of the same name. When the rule's
  `expectedIdentifiers` (e.g. `decimals`) is already a parameter of the
  enclosing function, produces a mechanical diff swapping the forbidden
  constant (e.g. `LAMPORTS_PER_SOL`) for `10 ** decimals`. Otherwise returns
  guidance to add the missing parameter, since synthesizing and threading a
  new parameter isn't a safe mechanical change. Lets `brainblast fix --apply`
  (and its opt-in graduation telemetry) work for `literal-multiplier-wrong-constant`
  rule packs, e.g. `spl-amount-scaling`.

## 0.5.1 — 2026-06-13

- **New checker `literal-multiplier-wrong-constant`** (`src/checkers/literalMultiplierWrongConstant.ts`):
  flags a call argument whose expression scales by the WRONG named constant —
  e.g. `amount * LAMPORTS_PER_SOL` passed to an SPL-token instruction that
  expects `amount * 10 ** decimals`. The two only coincide for 9-decimal
  mints; for any other decimals count the minted amount is off by orders of
  magnitude with no on-chain fix. Added to support third-party rule packs
  (no bundled rule ships this checker yet — first consumer is the
  `spl-amount-scaling` pack).

## 0.5.0 — 2026-06-13

- **Rule packs**: `Rule.pack?: { id, version, author? }`, a `brainblast-pack.yaml` manifest
  format (`validatePackManifest`, `loadPack`, `loadPacksFromDir` in `src/packs.ts`), and
  `resolveRules(targetDir, extraPackDirs)` extended to auto-discover packs under
  `.agent-research/packs/` and load packs passed via `--packs`. Pack rules are merged with
  shadow protection — they cannot override a bundled or project-local rule id.
- **`brainblast pack init <dir> --id <pack-id> [--name] [--author] [--version]
  [--description]`** scaffolds `brainblast-pack.yaml`, `rules/`, and `fixtures/`
  (`initPack` in `src/pack.ts`).
- **`brainblast pack validate <dir>`** loads a pack and runs the prove gate: for each rule
  with `fixtures/<rule-id>/{vulnerable,fixed}/`, the rule must FAIL on `vulnerable/` and not
  FAIL on `fixed/` (`validatePack` in `src/pack.ts`). Rules without fixtures warn rather than
  hard-fail. Exits 1 on any prove-gate failure or manifest/rule load error.
- **Opt-in telemetry** (`src/telemetry.ts`): `isTelemetryEnabled`, `getUserHash`,
  `getRepoHash`, `recordGraduationEvents` — `brainblast fix --apply` appends NDJSON
  `{pack_id, rule_id, repo_hash, user_hash, timestamp}` events to
  `.agent-research/telemetry.ndjson` for confirmed RED → GREEN fixes of pack rules, when
  enabled via `BRAINBLAST_TELEMETRY=1`/`0` or `.agent-research/config.json`'s
  `{"telemetry": true}`. Both hashes are one-way (sha256, truncated) — no repo URLs, paths,
  or identities are recorded.
- **`brainblast telemetry submit [targetDir]`** (`submitTelemetry` in `src/telemetry.ts`)
  POSTs `.agent-research/telemetry.ndjson` to `<registryUrl>/api/telemetry`
  (`BRAINBLAST_REGISTRY_URL`, default `https://registry.brainblast.tech`) and prints each
  `(pack_id, rule_id)`'s graduation progress (graduates at 5 distinct repo/user pairs within
  90 days, rate-limited to one accepted event per user/rule per 30 days).

## 0.4.3 — 2026-06-11

- **Generalized, project-wide `taint-to-sink` checker** — replaces the v0.4.2 intra-file
  `env-taint-to-sink` checker with a true graph-based, multi-hop, cross-file taint analysis:
  - **Direct**: a source expression (or local variable initialized from one) is passed
    straight to a sink call within the candidate function.
  - **Forward**: the candidate function calls another function — same-file or, via import
    resolution, in a different file — passing a tainted value into a parameter that itself
    reaches a sink, recursively up to `maxHops` (default 2).
  - **Backward**: the candidate function sinks one of its own parameters directly, and is
    called *anywhere else in the project* with a tainted argument.
  - Configured per-rule via `params: { sources: [{ name, pattern }], sinkCalls, maxHops }`.
- **`env-secret-leaked-to-sink`** now uses `taint-to-sink`, gaining cross-file detection for
  secret-shaped `process.env.X` values.
- **New rule `request-input-command-injection`** (critical, `taint-to-sink`): flags untrusted
  `req.body`/`req.query`/`req.params`/`req.headers` flowing into `exec`/`execSync`/`spawn`/
  `spawnSync`/`execFile`/`execFileSync`.
- New fixtures: `fixtures/cmdinject/{vulnerable,fixed}` and
  `fixtures/taint-crossfile/{vulnerable,fixed}` (cross-file backward leak).

## 0.4.2 — 2026-06-11

- **Cross-file taint tracking** — new `"env-taint-to-sink"` checker kind and
  bundled rule `env-secret-leaked-to-sink`: a shallow (1-2 hop), intra-file
  data-flow pass that flags secret-shaped `process.env.X` values (directly,
  via a local variable, or one hop through a same-file helper function) that
  reach a logging/response sink (`console.log`, `res.json`, `res.send`, etc.).
  Catches the "secret flows through 2-3 functions and gets logged" class of
  bug that single-function rules miss entirely.
- **`brainblast fix [--apply] [--branch]`** — auto-remediation for mechanical
  fixes. Dry run lists every confirmed FAIL that ships a `fix.diff`; `--apply`
  writes each diff to disk and re-audits to confirm RED -> GREEN, reporting
  any fix that didn't take (e.g. stale diff). `--branch` additionally creates
  `brainblast/auto-fix-<timestamp>` and commits the applied changes. New
  `src/fixers/applyDiff.ts` (`parseDiff`/`applyDiffToFile`), exported from the
  library API.

## 0.4.1 — 2026-06-11

- **Diff-aware scanning (`--since <ref>`)** — audit only what changed relative to any git
  revision (a branch, `HEAD~1`, a commit SHA): TS/Rust functions whose line range overlaps
  `git diff <ref>`, and config/env files that changed at all. Makes brainblast fast enough to
  run on every commit/PR instead of a full-repo scan. Exits `2` if `--since` can't run `git diff`
  (bad ref, or not a git work tree). The living-memory snapshot is only written on full
  (non-`--since`) runs, but precedents are still looked up and shown.
- **Config/env auditing** — new `"config"` detection lang for whole-file audits outside function
  scope (`detect.filePatterns`, matched via `findConfigCandidates` + git-tracked status).
  - New bundled rule `env-secrets-committed`: flags git-tracked `.env*` files (excluding
    `.env.example`/`.sample`/`.template`) containing secret-shaped keys (`SECRET`, `*_API_KEY`,
    `*_PASSWORD`, `*_TOKEN`, etc.) with real-looking (non-placeholder) values.
  - New `none` test-template kind for rules with no behavioral-contract test.
- **`brainblast watch`** — new daemon mode. On every file save, re-scans only the working-tree
  changes (uncommitted edits vs `HEAD`, plus untracked files) and emits one NDJSON event per line
  on stdout (`watch_started` / `finding` / `scan_complete` / `scan_error`) — an agent daemon can
  tail this directly instead of polling `.agent-research/report.json`.

## 0.4.0 — 2026-06-11

- **Precision pass — eliminated ~48 false positives** across 7 real-world repos (open-saas, plotwist,
  OneStopShop, ai_saas_app, desciersol, hospital-mgmt, dev_desk). Every repo now scans clean
  (`verdict: ready`, 0 unexpected FAILs).
  - New `Rule.detect.requiresImport` flag: when set, a candidate must import the rule's module
    *and* match by name or trigger call — preventing generic name matches (e.g. a Fastify
    `verifyJwt` middleware) from tripping module-specific rules (Privy/jose, Stripe).
  - `positional-arg-identity` (Stripe webhook) now returns `cant_tell` instead of a hard `fail`
    when `constructEvent` is called elsewhere in the file (delegation pattern brainblast can't
    statically follow), instead of a false FAIL.
  - Privy/jose and Stripe rules tightened to `requiresImport: true`, removing cross-matches with
    LemonSqueezy/Polar/Sendgrid webhooks and Fastify JWT middleware.
- **Fix-it mode** — FAIL results now carry an additive `fix` field (`report.json` `checks[].fix`,
  also printed by the CLI):
  - `diff`: a unified-diff hunk an agent can apply directly for mechanical fixes — e.g. swap
    `JSON.parse(rawBody)` for `rawBody` in `stripe.webhooks.constructEvent`, or merge
    `audience`/`issuer` into a Privy `jwtVerify` options object.
  - `suggestion`: guidance text for fails that need structural changes brainblast won't
    auto-synthesize (a missing `constructEvent` call; decode-only JWT verification).
  - New `src/fixers/` registry, mirrored from `src/checkers/` and keyed by the same `check.kind`.
- **Living memory** — brainblast now persists `.agent-research/memory.json` per repo. Each run
  diffs against the prior snapshot, records `fail → pass/cant_tell` transitions as fix events, and
  annotates current FAILs with an additive `precedent` field when the same rule was already fixed
  in a different file ("you fixed this exact issue in `<file>` on `<date>` — this file has the
  same gap").

## 0.2.0 — 2026-06-07

First public release, published to npm with [SLSA provenance](https://slsa.dev/) attestation via
GitHub Actions OIDC.

- **Deterministic offline auditor + `npx brainblast` CLI** — scans a repo for built-in integration
  traps without network access or an LLM, emits CI-readable `checks[]` / `checkTotals` into
  `report.json`, and can generate behavioral contract tests that fail on the vulnerable shape and
  pass on the fixed one.
- **Three built-in guardrails (CRITICAL severity)**:
  - Stripe webhook raw-body signature verification (forged-event acceptance).
  - Privy/JWT signature + `aud` + `iss` verification (auth bypass via decode-only tokens).
  - Bags/Solana fee-share creator inclusion — catches a config that omits the creator wallet from
    `feeClaimers` or whose `userBps` don't sum to 10,000, a permanent zero-revenue misconfiguration
    that cannot be corrected after launch.
- **Data-driven rules** — checks bind to vetted checker/test-template kinds via committed YAML; no
  executable code ships in a rule. Project-local `.agent-research/rules/*.yaml` rules load
  alongside the bundled pack without shadowing it.
- **RED→GREEN proof** (`npm run prove`) — every generated contract test is proven to fail against
  the vulnerable fixture and pass against the fixed one before it ships.
