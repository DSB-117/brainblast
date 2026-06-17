# Requirements Re-review

## Missing constraints

- **RPC endpoint not specified.** The requirements name Solana mainnet but not which RPC. `api.mainnet-beta.solana.com` is public and rate-limited and will cause intermittent failures. A paid RPC (Helius, QuickNode) is needed for anything beyond a one-off run.
- **No devnet path acknowledged.** The requirements implicitly assume a test environment exists. It does not — there is no Bags devnet API. All integration testing spends real SOL on mainnet. This should be stated and budgeted.

## Wrong assumptions

- **"Creator keeps 100% of trading fees (no co-claimers)" reads as the simple/default path.** It is not automatic. Token Launch v2 requires an explicit fee-share config, and the creator must be listed explicitly with `userBps: 10000`. Omitting the creator does not default them in — it zeroes them out permanently. The requirements imply a no-op; the reality is a mandatory, irreversible config step.

## Underspecified decisions

- **Fee mode (`bagsConfigType`) is not chosen.** Four modes exist (Default 2%/2%, Low-Pre/High-Post, High-Pre/Low-Post, High-Flat 10%). The choice is permanent. The requirements should name one. For "creator keeps fees, keep it simple," Default (`fa29606e-5e48-4c37-827f-4b03d58ee23d`) is correct.
- **Partner config is listed as optional but undefined.** If a partner share is wanted, a partner key must be created first (separate flow). The requirements should say yes or no.

## Immutable choices

- **`bagsConfigType` and the fee-claimer structure are written on-chain at launch and cannot be changed afterward.** Both must be finalized before the launch transaction is built. This is the single most important thing to get right before coding.

## Sound

- The 5-step launch sequence, the single-wallet scope, and the CLI-invocation shape (`npx ts-node launch-token.ts`) are all well-specified and ready to implement as written.
- The success criteria (token visible on bags.fm, creator receives fees, script prints mint + signature) are observable and correct.
