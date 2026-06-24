# Corpus coverage — Brainblast Verified Traps

_Generated 2026-06-24T01:08:31.271Z by corpus-report@0.1.0. Source of truth: `datasets/corpus-index.json`._

## Summary
- **8** VTIs (8 unique, 0 duplicate) across **8** SDKs and **5** trap classes.
- **Quality** (0–100): mean 48, median 48, range 48–48.
  Buckets — high (≥70): 0, medium (40–69): 8, low (<40): 0.
- **Lots:** synthetic-owned (8).

## Coverage heatmap (class × SDK, unique records)
| class \ sdk | @metaplex-foundation/js | @meteora-ag/dlmm | @raydium-io/raydium-sdk-v2 | @solana/web3.js | Jito (block engine / bundles) | Jupiter Aggregator API | Pyth Network price feeds | SPL Token |
|---|---|---|---|---|---|---|---|---|
| missing-slippage-guard | · | 1 | 1 | · | · | 1 | · | · |
| missing-verification | · | · | · | · | · | · | · | 1 |
| silent-zero-revenue | 1 | · | · | · | · | · | · | · |
| unchecked-staleness | · | · | · | · | · | · | 1 | · |
| unconfirmed-state | · | · | · | 1 | 1 | · | · | · |

(`·` = no coverage yet.)

## Scout work-orders (where to dig next)
**Thin cells** (only one instance — corroborate or broaden):
- unconfirmed-state · Jito (block engine / bundles)
- unconfirmed-state · @solana/web3.js
- missing-slippage-guard · Jupiter Aggregator API
- missing-slippage-guard · @meteora-ag/dlmm
- missing-slippage-guard · @raydium-io/raydium-sdk-v2
- silent-zero-revenue · @metaplex-foundation/js
- unchecked-staleness · Pyth Network price feeds
- missing-verification · SPL Token

**Uncovered trap classes** (no instance yet):
- immutable-after-deploy
- auth-bypass
- wrong-constant

## $BRAIN curation
The per-record `score` in `corpus-index.json` is what pricing and the curation
market key off: buyers filter on it, and stakers can **stake `$BRAIN` to up-rank**
a trap they believe labs will pay for (earning on usage, losing on disuse). Thin
cells and uncovered classes above are the scout work-orders that staking funds.
