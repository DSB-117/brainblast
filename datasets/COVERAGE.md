# Corpus coverage — Brainblast Verified Traps

_Generated 2026-07-04T07:19:42.266Z by corpus-report@0.1.0. Source of truth: `datasets/corpus-index.json`._

## Summary
- **26** VTIs (26 unique, 0 duplicate) across **21** SDKs and **9** trap classes.
- **Quality** (0–100): mean 50, median 48, range 30–60.
  Buckets — high (≥70): 0, medium (40–69): 25, low (<40): 1.
- **Lots:** synthetic-owned (26).

## Coverage heatmap (class × SDK, unique records)
| class \ sdk | @metaplex-foundation/js | @metaplex-foundation/mpl-token-metadata | @meteora-ag/dlmm | @raydium-io/raydium-sdk-v2 | @solana/web3.js | Jito (block engine / bundles) | Jupiter Aggregator API | Pyth Network price feeds | SPL Token | Solana lamports arithmetic | Stripe Node SDK | cookie-session | cors | express | express-jwt | express-session | helmet | jsonwebtoken | mongoose | node:https | python |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| auth-bypass | · | · | · | · | · | · | · | · | · | · | · | 1 | 2 | 1 | 1 | 1 | 1 | 4 | · | 1 | · |
| immutable-after-deploy | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| missing-slippage-guard | · | · | 1 | 1 | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| missing-verification | · | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | 1 | · | · |
| other | · | · | · | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | · |
| silent-zero-revenue | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 1 |
| unchecked-staleness | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · |
| unconfirmed-state | · | · | · | · | 2 | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| wrong-constant | · | · | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · |

(`·` = no coverage yet.)

## Scout work-orders (where to dig next)
**Thin cells** (only one instance — corroborate or broaden):
- auth-bypass · cookie-session
- auth-bypass · express-jwt
- auth-bypass · express-session
- auth-bypass · helmet
- auth-bypass · node:https
- auth-bypass · express
- unconfirmed-state · Jito (block engine / bundles)
- missing-slippage-guard · Jupiter Aggregator API
- missing-slippage-guard · @meteora-ag/dlmm
- missing-slippage-guard · @raydium-io/raydium-sdk-v2
- immutable-after-deploy · @metaplex-foundation/mpl-token-metadata
- silent-zero-revenue · @metaplex-foundation/js
- silent-zero-revenue · python
- missing-verification · mongoose
- missing-verification · SPL Token
- unchecked-staleness · Pyth Network price feeds
- wrong-constant · Solana lamports arithmetic
- other · Stripe Node SDK

_All trap classes have at least one instance._

## $BRAIN curation
The per-record `score` in `corpus-index.json` is what pricing and the curation
market key off: buyers filter on it, and stakers can **stake `$BRAIN` to up-rank**
a trap they believe labs will pay for (earning on usage, losing on disuse). Thin
cells and uncovered classes above are the scout work-orders that staking funds.
