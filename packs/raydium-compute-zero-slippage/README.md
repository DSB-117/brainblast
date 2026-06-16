# raydium-compute-zero-slippage

**Severity:** HIGH

## What's the trap?

`@raydium-io/raydium-sdk-v2`'s `computeAmountOut()` takes a `slippage` parameter (a decimal fraction, e.g. `0.5` = 0.5%). When `slippage: 0`, the SDK sets `minAmountOut === amountOut` — the swap will only succeed if the received amount is exactly equal to the computed output with zero tolerance.

In practice this means:

- Any price movement between compute and on-chain execution causes the tx to fail (not protected, just fails)
- A sandwich attack can front-run the swap and move the price; at `slippage: 0` there is no minimum-out floor, so the swap either fails with no protection or (depending on pool type) executes at a worse effective rate

AI-generated swap bots frequently default to `slippage: 0` to "avoid slippage" without understanding that they're actually removing all minimum-output guarantees.

## Why it's silent

`computeAmountOut()` succeeds with `slippage: 0`. The route is computed, the tx is built, and the swap may execute. The trap only becomes apparent at the wallet level when MEV bots consistently extract value from the unprotected path.

## The fix

```typescript
// BEFORE (vulnerable — no minimum output protection)
return raydium.liquidity.computeAmountOut({
  poolInfo: pool.poolInfo,
  amountIn,
  mintInfo: pool.mintInfos,
  slippage: 0,    // ← trap
});

// AFTER (fixed — 0.5% tolerance)
return raydium.liquidity.computeAmountOut({
  poolInfo: pool.poolInfo,
  amountIn,
  mintInfo: pool.mintInfos,
  slippage: 0.5,  // 0.5% — adjust to suit trade size and volatility
});
```

## References

- [Raydium SDK v2 GitHub](https://github.com/raydium-io/raydium-sdk-v2)
- `ComputeAmountOutParam.slippage: number` — confirmed in `src/raydium/liquidity/type.ts`
