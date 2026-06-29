# brainblast-verified-traps — catalog

_Generated 2026-06-29T18:11:03.692Z from 1 lot(s): seed-vti.jsonl._

**8 verified trap instances** across **8 SDKs** and **5 trap classes**. Quality score mean 48/100 (range 48–48). Freshness: 2026-06-23T18:59:28.069Z → 2026-06-23T18:59:28.069Z.

Every record is RED→GREEN-proven and ships its reproducibility receipt — the credibility scraped data can't offer.

## Access tiers

| Tier | Access | Price (USD) | In $BRAIN (10% off) | Min $BRAIN held | What you get |
|---|---|---|---|---|---|
| sample | open | free | — | 0 | Open teaser: metadata + the RED→GREEN receipt (the proof). No trainable fixtures. |
| standard | brain-gated | $2,500 | $2,250 | 1,000 | Full fixtures + a 24h-delayed delta. Pay in $BRAIN at a 10% discount; USDC accepted → buyback. |
| firehose | brain-gated | $10,000 | $9,000 | 10,000 | Unlimited records + the freshest delta (zero holdback). The freshness edge is the moat. |

> USD is the on-ramp; $BRAIN is the unit of access at a standing discount. USDC accepted at full price → programmatic buyback into the contributor/burn pool. Settlement is a deliberate, out-of-band step — this catalog only quotes the price.

## Coverage by trap class

| Class | Count |
|---|---|
| missing-slippage-guard | 3 |
| unconfirmed-state | 2 |
| silent-zero-revenue | 1 |
| unchecked-staleness | 1 |
| missing-verification | 1 |

## Coverage by SDK

| SDK | Count |
|---|---|
| Jito (block engine / bundles) | 1 |
| Jupiter Aggregator API | 1 |
| @metaplex-foundation/js | 1 |
| @meteora-ag/dlmm | 1 |
| Pyth Network price feeds | 1 |
| @raydium-io/raydium-sdk-v2 | 1 |
| @solana/web3.js | 1 |
| SPL Token | 1 |

## Sample (receipt-only teasers)

The open sample tier shows metadata + the RED→GREEN receipt (proof we have it) — never the trainable fixtures.

| Trap | SDK | Class | Severity | Score | Corroboration | RED→GREEN |
|---|---|---|---|---|---|---|
| jito-bundle-zero-tip | Jito (block engine / bundles) | unconfirmed-state | high | 48 | 0 | ✓/✓ |
| jupiter-quote-zero-slippage | Jupiter Aggregator API | missing-slippage-guard | high | 48 | 0 | ✓/✓ |
| metaplex-nft-royalty-zero | @metaplex-foundation/js | silent-zero-revenue | high | 48 | 0 | ✓/✓ |
| meteora-dlmm-zero-min-out | @meteora-ag/dlmm | missing-slippage-guard | high | 48 | 0 | ✓/✓ |
| pyth-price-unchecked-staleness | Pyth Network price feeds | unchecked-staleness | high | 48 | 0 | ✓/✓ |

---

To buy: obtain a signed access grant for your tier, then `brainblast feed --grant <file>` streams the delta filtered to your stack. Each pull is metered (`brainblast usage`).
