# Brainblast beta operations runbook

Everything an operator needs to sell access, deliver it, and keep the corpus
growing during beta. Settlement is **out-of-band** for beta: you issue a signed
grant by hand and invoice separately. Every command below is verified working.

## 0. One-time setup — distributor identity

The grant signer. Generate once; keep the secret key safe.

```bash
cd packages/core
npx tsx src/cli.ts grant keygen --out distributor-keys.json
#   → { "address": "<base58 pubkey>", "secretKey": "<base58 secret>" }
```

- **`address`** is public — publish it; buyers/servers verify grants with it.
- **`secretKey`** signs grants — set it as `BRAINBLAST_MARKET_KEY` when issuing.
- On the hosted registry, set `BRAINBLAST_MARKET_PUBKEY=<address>` so `/api/feed`
  verifies buyer grants.

## 1. The product — lots + Scale

The corpus is sold as **curated lots** (à-la-carte) or **Scale** (everything).
A grant is defined by two things: which **lots** it names, and its **tier**
(entitlement mechanics). Sample is the free anonymous teaser.

| SKU | Price/yr | Grant `tier` | Grant `lots` |
|---|---|---|---|
| Curated lot (à-la-carte) | $2,500 each ($2,250 in $BRAIN) | `standard` | the lot(s) bought, e.g. `solana` |
| Scale | $10,000 ($9,000 in $BRAIN) | `firehose` | all lots: `solana evm-defi web-backend other` |
| Sample (free) | — | anonymous, no grant | receipts-only teaser |

Lot names: **`solana`**, **`evm-defi`**, **`web-backend`** (sellable) + `other`
(Scale-only). Both paid tiers get full fixtures, **0 holdback**, and every record
**in the granted lots** — the product axis is lot-scope, not volume or freshness.

## 2. Issue a grant for a paying customer

**À-la-carte (one or more lots):**
```bash
BRAINBLAST_MARKET_KEY=$(jq -r .secretKey distributor-keys.json) \
npx tsx src/cli.ts grant issue \
  --buyer acme-labs \
  --tier standard \
  --lot solana \
  --lot evm-defi \
  --ttl-days 365 \
  --out acme-grant.json
```

**Scale (whole corpus + all future lots):**
```bash
BRAINBLAST_MARKET_KEY=$(jq -r .secretKey distributor-keys.json) \
npx tsx src/cli.ts grant issue \
  --buyer acme-labs --tier firehose \
  --lot solana --lot evm-defi --lot web-backend --lot other \
  --ttl-days 365 --out acme-scale.json
```

Deliver **two files/values** to the customer: their `grant.json` and your public
`address`. That's it — no secret leaves your side (Ed25519).

## 3. What the customer does

Point their trainer/agent at the hosted feed with their grant:

```bash
brainblast feed \
  --remote https://registry.brainblast.tech \
  --grant acme-grant.json \
  --pubkey <distributor address> \
  --sdk solana --severity high        # optional filters
```

They receive NDJSON: `feed_meta` (their tier + entitlement) then one `vti` per
record (full `fixtures` for paid tiers) then `feed_complete` with a resume
cursor. Anonymous (no grant) → sample tier (receipts only, held back).

## 4. Metering & accounting

The hosted `/api/feed` meters every gated pull into a hash-chained ledger
(Supabase). To review usage from a local ledger (e.g. a self-hosted `serve`):

```bash
npx tsx src/cli.ts usage --ledger datasets/usage-ledger.jsonl
#   Buyer        Pulls  Records  Tiers       Last seen
#   acme-labs        3      412  standard    2026-07-05T...
```

Bill from this per-buyer summary. Grants carry `expiresAt`; renew by re-issuing.

## 5. Grow supply (keep the corpus fresh)

The fleet engine is a two-dispatch loop (operator token stays in GitHub secrets):

```bash
# 1) source + submit (Sourcegraph discovery, cap-exempt with the operator token)
gh workflow run fleet-submit.yml --ref main -f seams=all
# 2) prove + surface (flips proof_verified → shows on the site)
gh workflow run reprove.yml
```

To widen coverage, add a seam to `fleet/scripts/sg_scout.py` (five check kinds
supported: object-arg, positional, absence, CST-Go, CST-Solidity), push, and
dispatch `fleet-submit --ref <branch>`.

## 6. Verify a grant is valid (support / debugging)

```bash
BRAINBLAST_MARKET_PUBKEY=<address> \
  npx tsx src/cli.ts grant verify --grant acme-grant.json
#   → valid: tier, buyer, lots, expiry  (or the reason it was rejected)
```
Tamper-evident: any edit to buyer/tier/lots invalidates the signature (403
`bad-signature` at the feed).

## Known / deferred (beta)
- **Settlement is manual** — issue grant + invoice. On-chain pay→auto-grant is post-beta.
- **3 legacy candidates** (`solaai`, `madgic`, `hop`) never reproduce and stay
  hidden (fail-closed); they re-draft harmlessly each reprove. Purge post-beta.
- **$BRAIN discount** is quoted (10%); the buyback/settlement rail is out-of-band.
