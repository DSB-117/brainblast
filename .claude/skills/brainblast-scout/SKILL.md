---
name: brainblast-scout
version: 0.1.0
description: Sends an agent on a scouting mission to find real-world coding traps (footguns in popular SDKs/protocols), synthesize the finding into a proven brainblast rule pack, submit it to the pack registry, and stake $BRAIN on it.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - WebFetch
  - WebSearch
triggers:
  - scouting mission
  - find a new pack
  - brainblast scout
  - submit a pack
---

# Brainblast Scout

End-to-end pipeline for an agent to go find a new "silent footgun" in some
external SDK/protocol, turn it into a proven brainblast knowledge pack, and
submit + stake it — the same workflow used to produce
`packs/jupiter-quote-zero-slippage` and `packs/spl-transfer-not-checked-in-payout`.

Five phases. Each phase fails closed: if a phase doesn't produce a clean
result, stop and surface a draft for human review rather than forcing it
through.

## Phase 1 — Scout

Research one external SDK/protocol (Solana programs, payment SDKs, etc.) for
a pattern where the *happy path compiles and runs* but silently does the
wrong thing — wrong constant, missing check, unchecked return value,
misordered calls. Good sources: official docs changelog, GitHub issues
tagged "footgun"/"gotcha", postmortems, audit reports.

Use `/browse` for any web research (per the user's global gstack
instructions — never drive Chrome directly).

Output: a candidate description in plain English — the SDK, the call/shape
that's wrong, why it's wrong, and what the fixed version looks like. This is
NOT yet a Finding JSON; it's the raw idea.

## Phase 2 — Synthesize into a Finding

Turn the candidate into a `Finding` (see
`packages/core/src/synth/types.ts`) and write it to
`packages/core/findings/<id>.json`. Required:

- `binding.check.kind` MUST be one of `checkerKinds` in
  `packages/core/src/checkers/index.ts` — if your pattern needs a *new*
  checker kind, that's a separate, larger task (see how
  `literal-multiplier-wrong-constant` and `fee-allocation-shape` were added
  historically); don't invent an unvetted kind here.
- `binding.test.kind` similarly must be in `testKinds`.
- `fixtures.vulnerable` / `fixtures.fixed` are full file contents — write
  real, minimal, compilable-looking code demonstrating the trap and its fix.

Then run, from `packages/core/`:

```bash
npm run synth -- findings/<id>.json
```

- **exit 0 (PROVEN)**: rule + fixtures staged in `.synth/`, ready to promote.
  Continue to Phase 3.
- **exit 2 (DRAFT)**: written to `packages/core/drafts/<id>/` for human
  review. STOP here — do not proceed to packaging or staking on a draft.
- **exit 1**: bad input, fix the Finding JSON and retry.

## Phase 3 — Package as a pack

Create the standalone pack directory:

```bash
npx brainblast pack init packs/<pack-id> --id <pack-id> --name "<name>" \
  --author <your-handle> --version 0.1.0 --description "<one-line>"
```

Copy the PROVEN rule YAML and `vulnerable`/`fixed` fixtures from `.synth/`
into `packs/<pack-id>/rules/` and `packs/<pack-id>/fixtures/<pack-id>/...`
(mirror the layout of `packs/jupiter-quote-zero-slippage`). Write a short
README covering: what the trap is, why it's silent, the fix.

Validate:

```bash
npx brainblast pack validate packs/<pack-id>
```

Must pass before continuing.

## Phase 4 — Submit

1. Push `packs/<pack-id>` as its own repo (or a subdirectory PR to this repo,
   matching how the existing packs were added).
2. Open a PR against `brainblast-pack-registry` adding an entry to
   `packs.json` (`pack_id`, `name`, `repo_url`, `author`, `description`,
   `latest_version`) — same shape `lib/sync.ts`'s `syncPackRegistry()`
   expects.
3. The registry's daily cron (`/api/cron/sync`) will pick it up automatically
   once the PR merges — no manual sync call needed.

## Phase 5 — Stake $BRAIN

**Security model**: staking is paid from a small, dedicated "ops wallet" —
*not* the user's main wallet. The user funds this wallet periodically (e.g.
$20-50 of $BRAIN/SOL). `scripts/agent-stake/stake.ts` enforces a
per-transaction cap (`AGENT_STAKE_MAX_USD`, default $25) and a cumulative
session cap (`AGENT_STAKE_SESSION_CAP_USD`, default $50) before sending
anything. The secret key is read only from `AGENT_OPS_WALLET_SECRET` (env
var) and is never logged or written to disk. Worst case if this wallet is
compromised: whatever it currently holds — never the user's main holdings.

1. Decide `stake_usd` for the pack (reasonable default: $10-25).
2. Determine `brain-amount` — the $BRAIN token amount equivalent to
   `stake_usd` (with the 10% $BRAIN discount), via a price lookup (e.g.
   Jupiter price API for `BRAIN_MINT`). This script does not fetch prices
   itself — compute it first.
3. Run:

```bash
cd scripts/agent-stake
npm install   # first time only
AGENT_OPS_WALLET_SECRET=*** AGENT_STAKE_MAX_USD=25 AGENT_STAKE_SESSION_CAP_USD=50 \
  npx tsx stake.ts --pack-id <pack-id> --rule-id <rule-id> \
  --stake-usd <usd> --brain-amount <amount>
```

If either cap would be exceeded, the script refuses and exits 1 — do not
raise the caps from inside this skill; that's a human decision (the caps are
read from env vars the user sets when funding the wallet).

## Done

Report: pack id, PROVEN/DRAFT status, PR URL(s) opened, stake tx signature
(if Phase 5 ran), and current session spend vs. cap.
