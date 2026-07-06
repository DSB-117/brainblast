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

## 1. The product — lots, packages, Scale

The corpus is sold three ways, all lot-scoped: individual **curated lots** (à la
carte), **packages** (bundles of lots at a discount), or **Scale** (everything +
all future lots). A grant names the lots it covers; packages and Scale expand to
their member lots at issue time, so the grant itself only ever carries lot names.
Sample is the free anonymous teaser.

**Prices are derived from live coverage** (distinct footgun patterns × SDKs per
lot, quality-weighted), snapped to clean tiers — read the current numbers off the
pricing page (`registry.brainblast.tech/pricing`). A lot's price moves only when
it gains a new *pattern or SDK*, never from raw instance volume.

| SKU | Grant scope | Notes |
|---|---|---|
| **Lot** (à la carte) | `--lot <name>` | one curated lot · ~$1,500–$3,500/yr by coverage |
| **Package** | `--package web3\|appsec` | web3 = solana + evm · appsec = the 6 web/infra lots (~20–30% off à la carte) |
| **Scale** | `--package scale` | every lot + all future lots · best value |
| **Sample** (free) | anonymous, no grant | receipts-only teaser |

The 8 sellable lots: **`solana`**, **`evm`**, **`auth-sessions`**,
**`transport-tls`**, **`web-hardening`**, **`cloud-storage`**, **`crypto`**,
**`browser-desktop`** (+ `other`, Scale-only). Every paid grant gets full
fixtures, **0 holdback**, and every record in its lot scope — the product axis is
lot-scope, not volume or freshness.

## 2. Issue a grant for a paying customer

`--package` expands to its member lots and defaults the tier to `firehose` (full
access); combine with `--lot` for extras — all values de-dup.

**À la carte (one or more lots):**
```bash
BRAINBLAST_MARKET_KEY=$(jq -r .secretKey distributor-keys.json) \
npx tsx src/cli.ts grant issue \
  --buyer acme-labs \
  --lot solana --lot auth-sessions \
  --ttl-days 365 --out acme-grant.json
```

**Package (Web3 = Solana + EVM):**
```bash
BRAINBLAST_MARKET_KEY=$(jq -r .secretKey distributor-keys.json) \
npx tsx src/cli.ts grant issue \
  --buyer acme-labs --package web3 \
  --ttl-days 365 --out acme-web3.json
```

**Scale (whole corpus + all future lots):**
```bash
BRAINBLAST_MARKET_KEY=$(jq -r .secretKey distributor-keys.json) \
npx tsx src/cli.ts grant issue \
  --buyer acme-labs --package scale \
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
