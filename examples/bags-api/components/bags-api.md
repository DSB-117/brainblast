# Component Research: Bags API

**Date checked:** 2026-06-04  
**Sources:**
- https://docs.bags.fm/ (official docs, checked 2026-06-04)
- https://docs.bags.fm/llms.txt (full doc index)
- https://docs.bags.fm/how-to-guides/launch-token.md
- https://docs.bags.fm/how-to-guides/customize-token-fees.md
- https://docs.bags.fm/how-to-guides/agent-authentication.md
- https://docs.bags.fm/principles/rate-limits.md

---

## Facts

**SDK package name**
- Package: `@bagsfm/bags-sdk`
- Install alongside: `npm install @solana/web3.js bs58`
- Import: `import { BagsSDK, ... } from "@bagsfm/bags-sdk"`

**API**
- Base URL: `https://public-api-v2.bags.fm/api/v1/`
- Auth header: `x-api-key: YOUR_API_KEY`
- API keys are obtained at `dev.bags.fm`, not `bags.fm`
- Max 10 API keys per user

**Rate limits**
- 5,000 requests per hour, scoped **per user AND per IP** (dual limit — hitting either triggers throttling)
- Monitor via `X-RateLimit-Remaining` and `X-RateLimit-Reset` response headers

**Token launch: fee sharing is MANDATORY (not optional)**
- Token Launch v2 requires a fee share configuration for every launch — there is no path that skips this step
- Without a fee share config, the launch transaction cannot be created

**Fee sharing: creator must be explicitly included**
- The creator's wallet must appear in the `feeClaimers` array with an explicit `userBps` value
- Omitting the creator does not default them to receiving fees — they receive nothing
- To keep all fees: `[{ user: creatorPublicKey, userBps: 10000 }]`
- All BPS values in the array must sum to exactly **10,000** (100%)

**Fee sharing: maximum claimers**
- Up to **100** fee claimers (including the creator) per token
- When claimers exceed **15**, Address Lookup Tables (LUTs) are required
- LUT creation requires waiting **one Solana slot** between the creation transaction and the extend transaction(s); skipping this wait causes the extend to fail

**Supported social providers for fee claimer lookup**
- `"twitter"`, `"kick"`, `"github"` only
- Providers like Discord, Telegram, Farcaster are not supported
- Lookup: `sdk.state.getLaunchWalletV2(username, provider)`

**Fee modes (`bagsConfigType`) — four options, set once, cannot be changed after launch**

| Mode | Config UUID | Pre-migration fee | Post-migration fee | Compounding |
|---|---|---|---|---|
| Default | `fa29606e-5e48-4c37-827f-4b03d58ee23d` | 2% | 2% | 25% post |
| Low Pre / High Post | `d16d3585-6488-4a6c-9a6f-e6c39ca0fda3` | 0.25% | 1% | 50% post |
| High Pre / Low Post | `a7c8e1f2-3d4b-5a6c-9e0f-1b2c3d4e5f6a` | 1% | 0.25% | 50% post |
| High Flat | `48e26d2f-0a9d-4625-a3cc-c3987d874b9e` | 10% | 10% | 50% post |

- "Pre-migration" = bonding curve phase
- "Post-migration" = after token graduates to Meteora DAMM V2 pool
- Creator receives 50% of non-compounded fees; protocol receives the other 50%
- Default if `bagsConfigType` is omitted: the 2%/2% Default config

**Transaction pattern: sign-then-submit, not fire-and-forget**
- All mutating endpoints return an unsigned transaction (or bundle of transactions)
- You must sign locally and submit via `sdk.tokenLaunch.signAndSendTransaction()` or `POST /solana/send-transaction`
- Fee share config creation uses **Jito bundles**, not standard Solana `sendTransaction`

**Jito tip**
- Required for bundle submission
- Recommended: query `sdk.solana.getJitoRecentFees()` and use `landed_tips_95th_percentile`
- Fallback: 0.015 SOL tip if the fee endpoint is unavailable

**Launch flow (5 steps)**
1. `sdk.tokenLaunch.createTokenInfoAndMetadata()` — upload metadata, get `tokenMint`
2. `sdk.config.createBagsFeeShareConfig()` — create fee share config, get `meteoraConfigKey`
3. `sdk.tokenLaunch.createLaunchTransaction()` — get unsigned launch tx
4. Sign the transaction locally
5. Submit (via `signAndSendTransaction` or `POST /solana/send-transaction`)

**Fee claiming (v3 — simplified)**
- Endpoint: `POST /token-launch/claim-txs/v3`
- Automatically handles all fee claiming logic based on token state (pre/post migration)
- Returns transactions to sign and submit
- Check claimable positions first: `GET /token-launch/claimable-positions?wallet=WALLET`

**Agent authentication (alternative to dev portal API keys)**
- Challenge-response flow using Ed25519 wallet signature (not username/password)
- Endpoints: `POST /agent/v2/auth/init` → sign challenge → `POST /agent/v2/auth/callback`
- MFA is possible: callback may return `mfaRequired: true` with an `authCode` for a second callback
- Nonces are single-use and expire quickly; regenerate if expired
- Credentials stored at `~/.config/bags/credentials.json` (`chmod 600`)

**Program IDs and pools**
- Post-migration pool: Meteora DAMM V2
- Pool data: `GET /bags-pools` or `GET /bags-pools/:tokenMint`
- Bags maintains public Address Lookup Tables (LUTs) — docs at `/principles/lookup-tables`

---

## Assumptions

- The `SOLANA_RPC_URL` env var should be a paid RPC endpoint (e.g., Helius, QuickNode) for reliability; the public `api.mainnet-beta.solana.com` is rate-limited and will cause intermittent failures in production
- `sdk.state.getCommitment()` defaults to `"processed"` — may need `"confirmed"` or `"finalized"` for production fee claiming where finality matters

---

## Inferences

- Fee compounding is always post-migration only; pre-migration fees go straight to protocol + creator with no compounding regardless of config chosen
- Changing the `bagsConfigType` after launch is impossible because it is baked into the on-chain fee share config account, not a server-side setting

---

## Risks

**CRITICAL — Revenue at risk if missed:**  
Fee sharing BPS must sum to 10,000 and the creator must be explicitly included. An agent that builds the fee share config without the creator wallet in the array will deploy a token where the creator earns zero fees forever. This cannot be corrected after launch (the `bagsConfigType` and claimer structure are set on-chain).

**HIGH — Launch will fail:**  
Attempting to call `createLaunchTransaction` before a fee share config exists returns an error. The fee share config step cannot be skipped.

**MEDIUM — Subtle failure:**  
Using `"discord"` or `"telegram"` as a social provider will fail at fee claimer lookup. Only `"twitter"`, `"kick"`, and `"github"` are supported.

**MEDIUM — Slot timing:**  
When LUTs are required (>15 claimers), the extend transaction must wait one Solana slot after LUT creation. Parallelizing or skipping the wait causes the extend to fail silently or revert.

**LOW:**  
Jito tip calculation uses 95th percentile. During high-network-load periods, bundles may not land if the tip is too low. The fallback of 0.015 SOL is conservative but may be expensive at high SOL prices.

---

## Resolved questions

**Is `@bagsfm/bags-sdk` on npm, or does install require a private registry?**  
Publicly available on npm. Latest: v1.3.7 (MIT, published ~1 month ago by the Bags team). 30 versions published. Standard install works: `npm install @bagsfm/bags-sdk`. No private registry needed.  
Peer dependency pinned in the SDK: `@solana/web3.js@1.98.4`, `bs58@6.0.0` — match these versions to avoid conflicts.

**Is there a devnet environment, or does all testing go to mainnet?**  
No Bags API devnet exists. All API endpoints (`public-api-v2.bags.fm`) target Solana mainnet-beta only. The program IDs page explicitly notes "mainnet-beta deployments unless otherwise noted" with no devnet alternatives listed. All integration testing requires real SOL on mainnet. Meteora does offer a manual migration tool at `migrator.meteora.ag` that supports devnet for pool migration testing, but Bags has no corresponding devnet API surface.

**What triggers post-migration (DAMM V2 graduation)?**  
Migration triggers automatically when the bonding curve's quote reserve reaches the configured threshold. Meteora runs keeper bots on mainnet that watch for eligible pools:

| Keeper | Triggers at |
|---|---|
| `CQdrEsYAxRqkwmpycuTwnMKggr3cr9fqY8Qma4J9TudY` | ≥10 SOL, ≥750 USDC, or ≥1500 JUP |
| `DeQ8dPv6ReZNQ45NfiWwS5CchWpB2BVq1QMyNV8L2uSW` | ≥750 USD equivalent in the quote token |

The specific threshold for any Bags-launched token is set in the bonding curve config at launch time (not a user-settable parameter in the Bags API — Bags configures it). Post-trigger, the pool progresses through states: `PreBondingCurve → PostBondingCurve → LockedVesting → CreatedPool`. The v3 claim endpoint (`POST /token-launch/claim-txs/v3`) detects which state the token is in and builds the correct transaction automatically — fee claiming code does not need to branch on migration state manually.

**Are there webhook events for fee accrual, or does claiming require polling?**  
No webhook events are documented. Fee discovery requires polling: `GET /token-launch/claimable-positions?wallet=WALLET` returns current claimable positions. For scheduled claiming, poll this endpoint and invoke the v3 claim flow when positions are non-zero.
