# Component Inventory

| Component | Type | Role | Confidence |
|---|---|---|---|
| Bags API | API | The platform the token is launched on; provides launch, fee-config, and fee-claim endpoints | High |
| `@bagsfm/bags-sdk` | SDK | TypeScript client used to call the Bags API and build/sign Solana transactions | High |
| Solana mainnet | Blockchain | The network the token and all transactions live on | High |
| Jito | Infra | Bundle/tip submission path required for the fee-share config transaction | Medium |
| Meteora DAMM V2 / DBC | Blockchain | The bonding curve and post-migration AMM the token graduates into | Medium |

## Notes

- "Jito" and "Meteora" surface as Medium confidence because the requirements never name them — they are implied by the Bags launch flow. Both were promoted to researched components once the launch guide revealed they are mandatory parts of the path.
- No database, auth provider, or deployment platform is in scope: this is a single-script, single-wallet integration.
