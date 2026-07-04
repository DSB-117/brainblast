# Corpus coverage — Brainblast Verified Traps

_Generated 2026-07-04T07:39:17.694Z by corpus-report@0.1.0. Source of truth: `datasets/corpus-index.json`._

## Summary
- **42** VTIs (42 unique, 0 duplicate) across **33** SDKs and **9** trap classes.
- **Quality** (0–100): mean 50, median 48, range 30–60.
  Buckets — high (≥70): 0, medium (40–69): 39, low (<40): 3.
- **Lots:** synthetic-owned (42).

## Coverage heatmap (class × SDK, unique records)
| class \ sdk | @metaplex-foundation/js | @metaplex-foundation/mpl-token-metadata | @meteora-ag/dlmm | @raydium-io/raydium-sdk-v2 | @solana/web3.js | Jito (block engine / bundles) | Jupiter Aggregator API | Pyth Network price feeds | SPL Token | Solana lamports arithmetic | Stripe Node SDK | aws-sdk | cookie-session | cors | express | express-jwt | express-rate-limit | express-session | helmet | jose | jsonwebtoken | mongodb | mongoose | mysql2 | node:https | nodemailer | passport-jwt | pg | playwright | puppeteer | python | stripe | ws |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| auth-bypass | · | · | · | · | · | · | · | · | · | · | · | 1 | 2 | 2 | 1 | 1 | 1 | 1 | 3 | 1 | 4 | · | · | · | 2 | · | 1 | · | · | · | · | · | 1 |
| immutable-after-deploy | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| missing-slippage-guard | · | · | 1 | 1 | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| missing-verification | · | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | 1 | 1 | 1 | · | 1 | · | 1 | 1 | 1 | · | · | · |
| other | · | · | · | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| silent-zero-revenue | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 1 | 1 | · |
| unchecked-staleness | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| unconfirmed-state | · | · | · | · | 2 | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| wrong-constant | · | · | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |

(`·` = no coverage yet.)

## Scout work-orders (where to dig next)
**Thin cells** (only one instance — corroborate or broaden):
- auth-bypass · aws-sdk
- auth-bypass · express-jwt
- auth-bypass · express-rate-limit
- auth-bypass · express-session
- auth-bypass · jose
- auth-bypass · passport-jwt
- auth-bypass · express
- auth-bypass · ws
- unconfirmed-state · Jito (block engine / bundles)
- missing-slippage-guard · Jupiter Aggregator API
- missing-slippage-guard · @meteora-ag/dlmm
- missing-slippage-guard · @raydium-io/raydium-sdk-v2
- immutable-after-deploy · @metaplex-foundation/mpl-token-metadata
- silent-zero-revenue · @metaplex-foundation/js
- silent-zero-revenue · python
- silent-zero-revenue · stripe
- missing-verification · mongodb
- missing-verification · mongoose
- missing-verification · mysql2
- missing-verification · nodemailer
- missing-verification · pg
- missing-verification · playwright
- missing-verification · puppeteer
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
