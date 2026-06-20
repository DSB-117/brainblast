# meteora-dlmm-zero-min-out

**Severity:** HIGH

## What's the trap?

Meteora DLMM's `swap()` takes a `minOutAmount` — the minimum number of output tokens the swap must return, or it reverts. Passing `new BN(0)` (or `0`) removes that floor entirely.

With no floor, any price movement between when you quoted and when the swap lands on-chain — including a deliberate **sandwich attack** — fills the swap at whatever price results. There is no protection.

AI-written swap bots reach for `minOutAmount: new BN(0)` to "just make the swap go through," not realizing they've disabled all slippage protection.

## Why it's silent

`swap()` with `minOutAmount: new BN(0)` builds and submits successfully. The trade executes. The loss only shows up as consistently worse-than-quoted fills — value quietly extracted by MEV.

## The fix

```typescript
// BEFORE (vulnerable — no floor)
return dlmmPool.swap({ /* ... */, minOutAmount: new BN(0) });

// AFTER (fixed — floor from the quote + slippage tolerance)
const quote = dlmmPool.swapQuote(inAmount, swapForY, new BN(50), binArrays); // 0.5%
return dlmmPool.swap({ /* ... */, minOutAmount: quote.minOutAmount });
```

> This rule is `BN(0)`-aware (brainblast v0.7.6): it flags `minOutAmount: 0` **and** the idiomatic `minOutAmount: new BN(0)`.

## References

- [Meteora DLMM overview](https://docs.meteora.ag/product-overview/meteora-liquidity-pools/dlmm-overview)
