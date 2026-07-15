# Contributor lot — `contributor-grant-v1`

**Physically separate from the owned corpus.** This directory holds VTIs ingested
from real contributor submissions via `npm run ingest:vti` (community submission —
[`ROADMAP.md`](../../ROADMAP.md), Lane 3). It is kept apart
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
re-proof in the **hardened sandbox**, consent stamp, and a **provenance /
anti-fabrication** check — and only inserts records that reproduce. `GET /api/vti`
returns open sample-tier teasers (metadata + the receipt), never the trainable
fixtures.

### Provenance — the check that replaces PR review

RED→GREEN only proves a submission *reproduces*; it cannot tell an
invented-but-reproducing fixture from a real find (a fabricated candidate proves
green just fine). So every submission must **cite the real source**, and the
server verifies it:

```jsonc
"provenance": {
  // a COMMIT-PINNED reference — a mutable branch (main/master/…) is rejected
  "sourceRef": "owner/repo@<7-40 hex sha>:path/to/file.ts",
  // a verbatim snippet of the vulnerable line; must contain the trap's own target
  "evidence": "skipPreflight: true"
}
```

The server fetches that exact file at that exact commit and confirms `evidence`
is present (whitespace-tolerant) and mentions the trap's forbidden property. If
the commit 404s or the line isn't there, the submission is rejected as
unverifiable — exactly the fabrication case. Preview locally with
`npm run submit:vti -- --candidate <file> --dry-run --verify-provenance`.

### Auth posture: open + rate-limited

Decision: **open by default**, like the fleet ledger — the gates above are the
real guard, not a shared password. A per-IP rate limit
(`BRAINBLAST_INGEST_RATELIMIT`, default 30 POST/min) stops one caller exhausting
the prover. Set `BRAINBLAST_INGEST_TOKEN` to close POST behind a Bearer token if a
deployment needs it; `GET` (the public sample tier) always stays open.

### Production store — Supabase

`storeFromEnv` uses Supabase when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are
set (else the local JSONL reference). The service-role key is a **server secret** —
`SupabaseVtiStore` is instantiated only inside the registry, never shipped to a
client. One table:

```sql
create table vtis (
  trap_id    text primary key,
  record     jsonb not null,
  created_at timestamptz not null default now()
);
-- Idempotency = the PK + POST `Prefer: resolution=ignore-duplicates` (a retried
-- submission is a no-op at the DB). The open sample tier can read through a
-- restricted view exposing metadata + redGreenProof only, never the fixtures.
```

## Deferred (needs rails, not just code)
- `$BRAIN` **stake-and-slash** bonding and the **data dividend** payout settle
  on-chain via the ops-wallet flow (`scripts/agent-stake`) + registry; wired in a
  later step. The reproduction gate above is the slashing trigger.
