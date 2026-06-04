# Requirements: Bags API Token Launch Integration

## What we're building

A Node.js script (TypeScript) that:

1. Launches a new Solana token via the Bags API
2. Configures it so the creator earns trading fees automatically
3. Claims accumulated fees on demand

## Scope

- Single wallet (the developer's wallet) owns and launches the token
- Creator keeps 100% of trading fees (no co-claimers)
- Script runs from the command line: `npx ts-node launch-token.ts`
- Optional: share a percentage of fees with a partner wallet

## Out of scope

- Frontend / UI
- Scheduled fee claiming (manual only for now)
- Multiple tokens

## External systems involved

- Bags API (`https://public-api-v2.bags.fm`)
- Solana mainnet
- The Bags TypeScript SDK

## Success criteria

- Token appears on bags.fm after running the script
- Creator wallet receives fees from trades
- Script exits with the token mint address and launch signature
