# brainblast

Deterministic auditor for catastrophic AI-integration bugs. Point it at a repo;
it finds the silent money/auth traps an AI agent ships, and generates the
behavioral test that proves they're fixed. No LLM, no API key, no network — it
parses your code statically and runs offline.

## Use

```sh
npx brainblast .            # scan the repo, write .agent-research/report.json
npx brainblast . --ci       # exit 1 if a confirmed FAIL remains
npx brainblast . --ci --strict   # also fail on CANT_TELL (can't statically prove)
npx brainblast . --since origin/main   # diff-aware: only audit what changed
npx brainblast fix .                   # dry run: list mechanical fixes
npx brainblast fix . --apply           # write fixes, re-audit RED -> GREEN
```

Exit codes: **0** clean · **1** a confirmed FAIL · CANT_TELL is a warning by
default (a red build always means a real, confirmed problem). `2` means
`--since <ref>` could not run `git diff` (bad ref, or not a git work tree).

### Diff-aware scanning (`--since <ref>`)

`--since <ref>` audits only what's changed relative to `<ref>` (any git
revision: a branch, `HEAD~1`, a commit SHA): TS/Rust functions whose line
range overlaps `git diff <ref>`, and config/env files that changed at all.
This makes brainblast fast enough to run on every commit or PR instead of a
full-repo scan:

```sh
npx brainblast . --since origin/main   # CI: only the PR's diff
npx brainblast . --since HEAD          # pre-commit/save hook: working tree changes
```

Living-memory precedents (see below) are still looked up and shown in
`--since` mode, but the memory snapshot itself is only written on full
(non-`--since`) runs — a partial diff-scan never overwrites the full picture.

### Watch mode (`brainblast watch`)

```sh
npx brainblast watch .
```

Runs as a daemon: every time a file is saved, brainblast re-scans only the
working-tree changes (uncommitted edits vs `HEAD`, plus untracked files —
the "what did I just save?" view) and emits one **NDJSON event per line** on
stdout:

```json
{"type":"watch_started","targetDir":"."}
{"type":"finding","ruleId":"stripe-webhook-raw-body-verification","severity":"critical","result":"fail","file":"src/webhook.ts","line":3,"detail":"...","fix":{...}}
{"type":"scan_complete","filesChanged":1,"findings":1,"durationMs":62}
```

Event types: `watch_started`, `finding` (one per FAIL/CANT_TELL), `scan_complete`
(per debounced save, even if nothing changed), and `scan_error` (e.g. not a
git work tree). This is the integration point for an agent daemon — tail
stdout for structured findings instead of polling `.agent-research/report.json`.
Exit with Ctrl-C / SIGTERM.

### Auto-fix (`brainblast fix`)

```sh
npx brainblast fix .            # dry run: list available mechanical fixes
npx brainblast fix . --apply    # write each fix.diff to disk, then re-audit
npx brainblast fix . --apply --branch   # also commit to brainblast/auto-fix-<ts>
```

Every confirmed FAIL that ships a mechanical `fix.diff` (e.g. Stripe raw-body,
Privy `audience`/`issuer`) can be applied directly. `--apply` writes each diff,
then re-runs the audit to confirm the finding now passes (RED -> GREEN) — any
fix that doesn't take is reported, not silently dropped. Findings with only a
`suggestion` (structural fixes brainblast won't auto-synthesize) are listed as
guidance, not applied. `--branch` additionally creates a new branch and commits
the applied changes.

## What it catches

### Web2 / Node.js

| Rule | What's wrong | Consequence |
|------|--------------|-------------|
| `stripe-webhook-raw-body` | `constructEvent` called on the parsed body, not the raw buffer | Any `payment_intent.succeeded` can be forged |
| `privy-jwt-verification` | JWT decoded without signature verification, or without `aud`+`iss` claims | Auth bypass / cross-app token reuse |

### Solana / Anchor (TypeScript + Rust)

| Rule | What's wrong | Consequence |
|------|--------------|-------------|
| `bags-fee-share-creator-included` | Creator wallet omitted from `feeClaimers`, or `userBps` don't sum to 10000 | Creator earns zero fees forever — the config is immutable on-chain |
| `token-2022-program-id-pinned` | `createMint` passes the legacy `TOKEN_PROGRAM_ID` where Token-2022 was intended | Mint is owned by the wrong program; Token-2022 features (transfer hooks, fees, confidential transfers) are silently absent with no on-chain fix |
| `metaplex-metadata-immutable` | `createV1` / `createNft` omits `isMutable: false` | Metadata defaults to mutable; any update authority can change the token's name, image, or attributes after launch |
| `anchor-init-if-needed-guarded` | Anchor instruction uses `init_if_needed` without a re-initialization guard | Any user can reinitialize another user's account, overwriting its state |

### Config / env

| Rule | What's wrong | Consequence |
|------|--------------|-------------|
| `env-secrets-committed` | A `.env*` file (not `.env.example`/`.sample`/`.template`) is tracked by git and contains a secret-shaped key (`SECRET`, `*_PRIVATE_KEY`, `*_API_KEY`, `*_TOKEN`, `*_PASSWORD`, etc.) with a real-looking (non-placeholder) value | Anyone with read access to the repo — including forks of a public repo — can read the live credential |
| `env-secret-leaked-to-sink` | A secret-shaped `process.env.X` value (directly, via a local variable, or one hop through a same-file helper) is passed to `console.log`/`res.json`/`res.send`/etc. | Credentials end up in logs, error trackers, or API responses — readable by anyone with log/response access |

Each finding lands in `.agent-research/report.json` (stable `schemaVersion: "1.0"`)
with a `checks[]` array a CI gate can read. Each confirmed FAIL ships a
generated behavioral test (RED on vulnerable, GREEN on fixed).

## Cost & Rent Analysis

Every run also produces `.agent-research/cost-analysis.md` — a breakdown of
rent-exempt lamport lockups, scalable flows (calls inside loops that grow with N),
and a priority-fee posture check:

```
── Cost & Rent ──────────────────────────────────────────────
  [HIGH ] priority fee not configured — add setComputeUnitPrice to critical paths
  Metaplex Token Metadata  src/mint.ts:42  +5,312,760 lamports (0.00531276 SOL)  [non-recoverable]
  ─── static lockup total: 5,312,760 lamports (~0.00531276 SOL)
```

## Trust Graph

Resolve on-chain upgrade-authority and verified-build status for any Solana
program:

```sh
npx brainblast trust-graph TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
npx brainblast trust-graph <id1> <id2> --rpc https://api.mainnet-beta.solana.com
npx brainblast trust-graph <id> --no-probe   # directory + cache only, no RPC
npx brainblast trust-graph <id> --json       # machine-readable output
```

Program metadata is cached in `~/.brainblast/program-cache.json` (keyed by
program ID, TTL 1 week). A program researched for one project pre-populates
all future runs — no repeat RPC probes needed. Override with
`BRAINBLAST_CACHE_PATH` or pass `--no-cache` to skip entirely.

## Rules are data

Detection lives in `*.yaml` rules (facts) that bind to a small set of vetted,
human-maintained checker + test templates by `kind` — never executable code in a
rule. Drop project-specific rules in `.agent-research/rules/*.yaml` and the
auditor loads them on top of the bundled pack (they can add traps, not shadow
bundled ones). Invalid rules are rejected at load.

## Library API

```ts
import {
  audit, resolveRules,
  analyzeCosts, renderCostReportMd,
  buildTrustGraph,
  loadProgramCache, getCacheEntry,
} from "brainblast";

// Static audit
const { checks, report } = audit(process.cwd(), resolveRules(process.cwd()));

// Cost analysis
const costReport = analyzeCosts(process.cwd());
console.log(renderCostReportMd(costReport));

// Trust graph (program-keyed cache is consulted automatically)
const graph = await buildTrustGraph(["TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
```

All types are exported: `Rule`, `CheckResult`, `CostReport`, `AccountFlow`,
`OnChainProgram`, `TrustGraph`, `ProgramCache`, and more.

## Security model

- **The audit is static.** `brainblast <dir>` parses source with ts-morph and
  never executes it, so auditing untrusted code does not run it. YAML rules are
  data only (no code execution, no prototype pollution).
- **Generated behavioral tests execute the audited repo's code when you run
  them.** That's expected when you audit your own repo. If you run brainblast on
  untrusted code (e.g. a fork PR) and then run the generated tests, run them in a
  sandbox — the same caution as running any untrusted test suite.
- **Trust-graph RPC probes are read-only.** `getAccountInfo` calls only; no
  transactions are sent.

## Develop

```sh
npm install
npm test         # unit suite (173 tests)
npm run prove    # end-to-end: generated tests RED on vulnerable, GREEN on fixed
npm run build    # produce dist/ (the published artifact)
```

MIT.
