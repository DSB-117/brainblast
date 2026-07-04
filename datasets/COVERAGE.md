# Corpus coverage — Brainblast Verified Traps

_Generated 2026-07-04T01:19:21.372Z by corpus-report@0.1.0. Source of truth: `datasets/corpus-index.json`._

## Summary
- **24** VTIs (24 unique, 0 duplicate) across **17** SDKs and **8** trap classes.
- **Quality** (0–100): mean 48, median 48, range 30–60.
  Buckets — high (≥70): 0, medium (40–69): 23, low (<40): 1.
- **Lots:** synthetic-owned (24).

## Coverage heatmap (class × SDK, unique records)
| class \ sdk | @metaplex-foundation/js | @meteora-ag/dlmm | @raydium-io/raydium-sdk-v2 | @solana/web3.js | Jito (block engine / bundles) | Jupiter Aggregator API | Pyth Network price feeds | SPL Token | Solana lamports arithmetic | Stripe Node SDK | better-auth | cors | express-jwt | jsonwebtoken | mongoose | node:https | python |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| auth-bypass | · | · | · | · | · | · | · | · | · | · | · | 1 | · | 2 | · | 1 | · |
| missing-slippage-guard | · | 1 | 1 | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · |
| missing-verification | · | · | · | · | · | · | · | 1 | · | · | 2 | · | 1 | · | · | · | · |
| other | · | · | · | · | · | · | · | · | · | 1 | · | · | · | · | 1 | · | · |
| silent-zero-revenue | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 1 |
| unchecked-staleness | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | · |
| unconfirmed-state | · | · | · | 6 | 1 | · | · | · | · | · | · | · | · | · | · | · | · |
| wrong-constant | · | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · |

(`·` = no coverage yet.)

## Scout work-orders (where to dig next)
**Thin cells** (only one instance — corroborate or broaden):
- auth-bypass · cors
- auth-bypass · node:https
- unconfirmed-state · Jito (block engine / bundles)
- missing-slippage-guard · Jupiter Aggregator API
- missing-slippage-guard · @meteora-ag/dlmm
- missing-slippage-guard · @raydium-io/raydium-sdk-v2
- missing-verification · express-jwt
- missing-verification · SPL Token
- other · mongoose
- other · Stripe Node SDK
- silent-zero-revenue · @metaplex-foundation/js
- silent-zero-revenue · python
- unchecked-staleness · Pyth Network price feeds
- wrong-constant · Solana lamports arithmetic

**Uncovered trap classes** (no instance yet):
- immutable-after-deploy

## $BRAIN curation
The per-record `score` in `corpus-index.json` is what pricing and the curation
market key off: buyers filter on it, and stakers can **stake `$BRAIN` to up-rank**
a trap they believe labs will pay for (earning on usage, losing on disuse). Thin
cells and uncovered classes above are the scout work-orders that staking funds.
