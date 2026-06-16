# Changelog

## Unreleased

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
