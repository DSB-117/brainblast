# Research Plan

## Bags API
**Type:** API
**Priority:** High
**Sources to check:**
1. Docs index (llms.txt): https://docs.bags.fm/llms.txt
2. Getting started / auth: https://docs.bags.fm/
3. Rate limits: https://docs.bags.fm/principles/rate-limits.md
4. Base URL & versioning: https://docs.bags.fm/principles/base-url-versioning.md
5. Token launch guide: https://docs.bags.fm/how-to-guides/launch-token.md
6. Fee customization: https://docs.bags.fm/how-to-guides/customize-token-fees.md
7. Agent auth: https://docs.bags.fm/how-to-guides/agent-authentication.md
8. Changelog (breaking changes): https://docs.bags.fm/changelog/changelog.md
9. Program IDs: https://docs.bags.fm/principles/program-ids.md

## @bagsfm/bags-sdk
**Type:** SDK
**Priority:** High
**Sources to check:**
1. npm registry entry (version, deps): `npm info @bagsfm/bags-sdk`
2. Peer dependency versions (web3.js, bs58)

## Meteora DBC / DAMM V2
**Type:** Blockchain
**Priority:** Medium
**Sources to check:**
1. Docs index: https://docs.meteora.ag/llms.txt
2. Migration / graduation threshold: https://docs.meteora.ag/core-products/dbc/migration-and-liquidity.md

## Prioritization rationale

Bags API first — it is the integration surface the whole script is built on, and its docs reveal which of the other components are actually required. SDK second to pin the install. Meteora last, only to answer the migration-threshold question that the fee-claiming code path depends on.
