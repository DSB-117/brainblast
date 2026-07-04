# brainblast-verified-traps — catalog

_Generated 2026-07-04T07:19:42.279Z from 1 lot(s): seed-vti.jsonl._

**26 verified trap instances** across **21 SDKs** and **9 trap classes**. Quality score mean 50/100 (range 30–60). Freshness: 2026-07-04T07:19:39.875Z → 2026-07-04T07:19:39.875Z.

Every record is RED→GREEN-proven and ships its reproducibility receipt — the credibility scraped data can't offer.

## Access tiers

| Tier | Access | Price (USD) | In $BRAIN (10% off) | Min $BRAIN held | What you get |
|---|---|---|---|---|---|
| sample | open | free | — | 0 | Open teaser: metadata + the RED→GREEN receipt (the proof). No trainable fixtures. |
| standard | brain-gated | $2,500 | $2,250 | 100,000 | Full fixtures + a 24h-delayed delta. Pay in $BRAIN at a 10% discount; USDC accepted → buyback. |
| firehose | brain-gated | $10,000 | $9,000 | 1,000,000 | Unlimited records + the freshest delta (zero holdback). The freshness edge is the moat. |

> USD is the on-ramp; $BRAIN is the unit of access at a standing discount. USDC accepted at full price → programmatic buyback into the contributor/burn pool. Settlement is a deliberate, out-of-band step — this catalog only quotes the price.

## Coverage by trap class

| Class | Count |
|---|---|
| auth-bypass | 12 |
| unconfirmed-state | 3 |
| missing-slippage-guard | 3 |
| silent-zero-revenue | 2 |
| missing-verification | 2 |
| immutable-after-deploy | 1 |
| unchecked-staleness | 1 |
| wrong-constant | 1 |
| other | 1 |

## Coverage by SDK

| SDK | Count |
|---|---|
| jsonwebtoken | 4 |
| cors | 2 |
| @solana/web3.js | 2 |
| cookie-session | 1 |
| express-jwt | 1 |
| express-session | 1 |
| helmet | 1 |
| node:https | 1 |
| Jito (block engine / bundles) | 1 |
| Jupiter Aggregator API | 1 |
| @metaplex-foundation/mpl-token-metadata | 1 |
| @metaplex-foundation/js | 1 |
| @meteora-ag/dlmm | 1 |
| mongoose | 1 |
| Pyth Network price feeds | 1 |
| python | 1 |
| @raydium-io/raydium-sdk-v2 | 1 |
| express | 1 |
| Solana lamports arithmetic | 1 |
| SPL Token | 1 |
| Stripe Node SDK | 1 |

## Sample (receipt-only teasers)

The open sample tier shows metadata + the RED→GREEN receipt (proof we have it) — never the trainable fixtures.

| Trap | SDK | Class | Severity | Score | Corroboration | RED→GREEN |
|---|---|---|---|---|---|---|
| cookie-session-secure-false | cookie-session | auth-bypass | high | 48 | 0 | ✓/✓ |
| cors-credentials-reflect-origin-true | cors | auth-bypass | high | 48 | 0 | ✓/✓ |
| cors-wildcard-origin | cors | auth-bypass | high | 48 | 0 | ✓/✓ |
| express-jwt-credentials-not-required | express-jwt | auth-bypass | critical | 60 | 0 | ✓/✓ |
| express-session-saveuninitialized-true | express-session | auth-bypass | high | 48 | 0 | ✓/✓ |

---

To buy: obtain a signed access grant for your tier, then `brainblast feed --grant <file>` streams the delta filtered to your stack. Each pull is metered (`brainblast usage`).
