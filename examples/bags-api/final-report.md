# Brainblast Research Report

**Run:** 20260604-120000  
**Requirements:** Launch a Solana token via Bags API, earn and claim creator fees  
**Date:** 2026-06-04  
**Agent:** Brainblast v0 (manual demo run)

---

## Executive Summary

*The 30-second version.*

- **Building:** Launch a Solana token through the Bags API and earn + claim creator trading fees.
- **Verdict:** Build with caution — one configuration mistake permanently zeroes the creator's revenue.
- **Top risk:** Omitting the creator wallet from the fee-share array launches a token where the creator earns 0% of all trading fees, forever, with no fix after launch.
- **Must decide first:** The fee mode UUID (`bagsConfigType`) and the fee-share array — both are immutable on-chain after launch.
- **Watch out for:** Mainnet-only (no devnet — testing costs real SOL), a mandatory fee-share step with no skip path, and a Jito-bundle submission that needs a tip.

---

## Risk Heatmap

| Component | 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low |
|---|---|---|---|---|
| Bags API | 1 | 1 | 2 | 1 |
| **Total** | **1** | **1** | **2** | **1** |

**Critical & High, by name:**
1. **[CRITICAL] Bags API — zero-revenue config** — creator omitted from `feeClaimers` earns nothing, permanently and silently.
2. **[HIGH] Bags API — launch fails without fee-share config** — `createLaunchTransaction` errors if the fee-share step is skipped.

---

## Components researched

| Component | Source found | Status |
|---|---|---|
| Bags API | https://docs.bags.fm/ | Verified |
| `@bagsfm/bags-sdk` | https://docs.bags.fm/how-to-guides/launch-token.md | Verified |
| Solana / Jito bundles | Referenced in SDK flow | Partially verified |
| Meteora DAMM V2 | Mentioned as post-migration pool | Partially verified |

---

## What a coding agent needs to know before starting

### 1. Fee sharing is not optional — it is required for every launch

Token Launch v2 mandates a fee share config. There is no simpler launch path. The config must be created on-chain before the launch transaction can be built.

The minimum viable config:
```typescript
const feeClaimers = [{ user: creatorPublicKey, userBps: 10000 }];
```

**If the creator is omitted from this array, they earn zero fees from all trades, forever.** This cannot be corrected after launch.

### 2. Choose the fee mode before coding — it cannot be changed later

Four modes exist. The choice is permanent (stored on-chain in the fee share config).

For a straightforward launch, the Default mode (2%/2% fee, 25% compounding post-migration) is the right call. Pass the UUID: `fa29606e-5e48-4c37-827f-4b03d58ee23d` as `bagsConfigType`, or omit it to get the default.

### 3. Transactions must be signed locally and submitted — this is not a REST API in the conventional sense

Every mutating call returns an unsigned Solana transaction. The agent must:
- Deserialize it
- Sign it with the creator's keypair
- Submit it via Jito bundle (for fee share config) or standard RPC (for launch tx)

### 4. The 5-step launch sequence is strict

```
1. createTokenInfoAndMetadata()   → tokenMint, metadataUrl
2. createBagsFeeShareConfig()     → meteoraConfigKey  (Jito bundle required)
3. createLaunchTransaction()      → unsigned tx
4. sign tx locally
5. signAndSendTransaction()
```

Skipping or reordering steps 1-2 will error.

### 5. Jito tip is required for fee share config submission

The fee share config is submitted as a Jito bundle, not via `sendTransaction`. A tip transaction (0.015 SOL fallback, or 95th percentile from `getJitoRecentFees()`) must be prepended to the bundle.

---

## Requirements review

The requirements are sound but missing two constraints:

1. **RPC endpoint**: The spec says nothing about which RPC to use. `api.mainnet-beta.solana.com` is public and rate-limited. A paid RPC (Helius, QuickNode, etc.) is needed for anything that runs more than a few times.

2. **Fee mode choice**: The spec says "creator keeps 100% of trading fees" — this means Default or High Flat mode. The spec should name the mode explicitly, since it cannot be changed after deployment.

---

## Pre-coding questions — researched and answered

**SDK install:** `@bagsfm/bags-sdk` is publicly on npm (v1.3.7, MIT). `npm install @bagsfm/bags-sdk` works. Pin `@solana/web3.js@1.98.4` and `bs58@6.0.0` to match SDK peer deps.

**Devnet:** No Bags API devnet exists. All testing hits mainnet. Budget real SOL for integration work. Meteora's manual migrator (`migrator.meteora.ag`) supports devnet for pool migration testing only — Bags has no devnet API.

**Migration trigger:** Graduation happens automatically when the bonding curve's quote reserve reaches a configured threshold. Meteora keepers watch mainnet and trigger migration at ≥10 SOL / ≥750 USDC / ≥1500 JUP (or ≥750 USD equivalent). Fee claiming code does not need to handle migration state manually — the v3 claim endpoint (`POST /token-launch/claim-txs/v3`) detects the pool state and builds the correct transaction automatically.

**Fee accrual events:** No webhooks. Claiming requires polling `GET /token-launch/claimable-positions?wallet=WALLET` and invoking the v3 claim flow when positions are non-zero.

---

## What this report prevents

Without this research, a coding agent implementing "launch a token and earn fees" would almost certainly:

- Skip the fee share config step (treats it as optional) → launch fails with API error
- Or build the config but omit the creator wallet → token launches successfully, creator earns 0% of all future trading fees, permanently

Both failures are invisible until the agent tries to claim fees and finds nothing there.
