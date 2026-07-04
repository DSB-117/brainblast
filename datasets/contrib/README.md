# Contributor lot — `contributor-grant-v1`

**Physically separate from the owned corpus.** This directory holds VTIs ingested
from real contributor submissions via `npm run ingest:vti` (Stage 2 of
[`ROADMAP-TRAINING-DATA.md`](../../ROADMAP-TRAINING-DATA.md)). It is kept apart
from [`datasets/seed/`](../seed/) and [`datasets/v*/`](../) so a consent or
licensing issue here can **never** contaminate the `synthetic-owned` data.

## Why `contrib-vti.jsonl` is git-ignored
Contributed records are **licensed user data**, not Brainblast-owned. They are not
auto-published to this public repo. The ingest pipeline writes them here locally;
publishing/selling them is a separate, deliberate step governed by the
contributor's `consentScope`.

## What the ingest gate guarantees for every record here
1. **No secrets** — every file was run through Keyguard's classifier; any
   keypair / base58 secret / mnemonic refuses the whole submission.
2. **Reproduced RED→GREEN** — the vulnerable/fixed pair was re-proven against the
   trap's rule (the same oracle the dataset and benchmark use). Non-reproducing
   submissions are rejected. This is the gate `$BRAIN` stake-slashing keys off.
3. **Consent + license stamped** — `license: contributor-grant-v1` and the
   contributor's `consentScope` (`opt-in:train` / `eval` / `train+eval`).

## Two ways in: files (PR) or a direct POST (no PR)

The file/PR path (`npm run ingest:vti`) is the reviewable on-ramp. For scale —
where a PR per submission doesn't hold — a VTI can feed **straight into the
database** through the same three gates, run server-side:

```bash
# client — POST a candidate Finding to the registry; it re-proves RED→GREEN and,
# if it reproduces, inserts it. No fork, no branch, no PR.
npm run submit:vti -- --candidate fleet/candidates/<id>.json
npm run submit:vti -- --candidate <file> --dry-run   # run the identical gate locally first

# server — the reference ingest endpoint (POST/GET /api/vti). Swap the JSONL
# store for a Supabase VtiStore and this is the production route.
npm run registry:serve
```

The client is never trusted: `POST /api/vti` runs `ingestSubmission`
(`src/contrib/submit.ts`) — shape validation, Keyguard secret scan, RED→GREEN
re-proof in the **hardened sandbox**, consent stamp — and only inserts records
that reproduce. `GET /api/vti` returns open sample-tier teasers (metadata + the
receipt), never the trainable fixtures.

## Deferred (needs rails, not just code)
- `$BRAIN` **stake-and-slash** bonding and the **data dividend** payout settle
  on-chain via the ops-wallet flow (`scripts/agent-stake`) + registry; wired in a
  later step. The reproduction gate above is the slashing trigger.
