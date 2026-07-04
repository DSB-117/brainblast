# Corpus coverage — Brainblast Verified Traps

_Generated 2026-07-04T16:33:27.238Z by corpus-report@0.1.0. Source of truth: `datasets/corpus-index.json`._

## Summary
- **85** VTIs (85 unique, 0 duplicate) across **62** SDKs and **9** trap classes.
- **Quality** (0–100): mean 50, median 48, range 30–60.
  Buckets — high (≥70): 0, medium (40–69): 79, low (<40): 6.
- **Lots:** synthetic-owned (85).

## Coverage heatmap (class × SDK, unique records)
| class \ sdk | @apollo/server | @aws-sdk/client-s3 | @elastic/elasticsearch | @fastify/cors | @metaplex-foundation/js | @metaplex-foundation/mpl-token-metadata | @meteora-ag/dlmm | @raydium-io/raydium-sdk-v2 | @solana/web3.js | Jito (block engine / bundles) | Jupiter Aggregator API | Pyth Network price feeds | SPL Token | Solana lamports arithmetic | Stripe Node SDK | amqplib | aws-sdk | better-auth | cassandra-driver | cookie | cookie-session | cors | crypto/tls | express | express-fileupload | express-jwt | express-rate-limit | express-session | got | helmet | ioredis | iron-session | jose | jsonwebtoken | kafkajs | knex | koa-session | ldapjs | libxmljs2 | mongodb | mongoose | mqtt | mssql | mysql2 | nats | node:https | nodemailer | passport-jwt | pg | playwright | puppeteer | python | redis | sequelize | socket.io | solidity | stripe | tedious | typeorm | typescript | undici | ws |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| auth-bypass | 1 | 1 | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | 1 | · | · | 1 | 2 | 2 | 1 | 1 | · | 1 | 1 | 3 | · | 5 | · | 1 | 1 | 4 | · | · | 1 | · | · | · | · | · | · | · | · | 2 | · | 1 | · | · | · | · | · | · | 1 | 1 | · | · | · | · | · | 1 |
| immutable-after-deploy | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| missing-slippage-guard | · | · | · | · | · | · | 1 | 1 | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 1 | · | · |
| missing-verification | · | · | 1 | · | · | · | · | · | · | · | · | · | 1 | · | · | 1 | · | 2 | 1 | · | · | · | · | · | · | 1 | · | · | 1 | · | 1 | · | · | · | 1 | 1 | · | 1 | · | 1 | 1 | 1 | 1 | 1 | 1 | · | 1 | · | 1 | 1 | 1 | · | 1 | 1 | · | · | · | 1 | 1 | · | 1 | · |
| other | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | 1 | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 2 | · | · |
| silent-zero-revenue | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 1 | · | · | · | · | 1 | · | · | · | · | · |
| unchecked-staleness | · | · | · | · | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| unconfirmed-state | · | · | · | · | · | · | · | · | 6 | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| wrong-constant | · | · | · | · | · | · | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 1 | · | · |

(`·` = no coverage yet.)

## Scout work-orders (where to dig next)
**Thin cells** (only one instance — corroborate or broaden):
- missing-verification · amqplib
- missing-verification · cassandra-driver
- missing-verification · @elastic/elasticsearch
- missing-verification · got
- missing-verification · ioredis
- missing-verification · express-jwt
- missing-verification · kafkajs
- missing-verification · knex
- missing-verification · ldapjs
- missing-verification · mongodb
- missing-verification · mongoose
- missing-verification · mqtt
- missing-verification · mssql
- missing-verification · mysql2
- missing-verification · nats
- missing-verification · nodemailer
- missing-verification · pg
- missing-verification · playwright
- missing-verification · puppeteer
- missing-verification · redis
- missing-verification · sequelize
- missing-verification · SPL Token
- missing-verification · tedious
- missing-verification · typeorm
- missing-verification · undici
- auth-bypass · @apollo/server
- auth-bypass · aws-sdk
- auth-bypass · @aws-sdk/client-s3
- auth-bypass · cookie
- auth-bypass · express-jwt
- auth-bypass · express-rate-limit
- auth-bypass · @fastify/cors
- auth-bypass · crypto/tls
- auth-bypass · iron-session
- auth-bypass · jose
- auth-bypass · koa-session
- auth-bypass · passport-jwt
- auth-bypass · express
- auth-bypass · socket.io
- auth-bypass · solidity
- auth-bypass · ws
- other · express-fileupload
- other · mongoose
- other · libxmljs2
- other · Stripe Node SDK
- unconfirmed-state · Jito (block engine / bundles)
- missing-slippage-guard · Jupiter Aggregator API
- missing-slippage-guard · @meteora-ag/dlmm
- missing-slippage-guard · @raydium-io/raydium-sdk-v2
- missing-slippage-guard · typescript
- immutable-after-deploy · @metaplex-foundation/mpl-token-metadata
- silent-zero-revenue · @metaplex-foundation/js
- silent-zero-revenue · python
- silent-zero-revenue · stripe
- unchecked-staleness · Pyth Network price feeds
- wrong-constant · Solana lamports arithmetic
- wrong-constant · typescript

_All trap classes have at least one instance._

## $BRAIN curation
The per-record `score` in `corpus-index.json` is what pricing and the curation
market key off: buyers filter on it, and stakers can **stake `$BRAIN` to up-rank**
a trap they believe labs will pay for (earning on usage, losing on disuse). Thin
cells and uncovered classes above are the scout work-orders that staking funds.
