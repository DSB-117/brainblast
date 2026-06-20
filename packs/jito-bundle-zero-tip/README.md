# jito-bundle-zero-tip

**Severity:** HIGH

## What's the trap?

Jito bundles are ordered by their **tip**. The block engine prioritizes bundles that pay more; a bundle that tips **0** is deprioritized and, under any competition, simply never lands.

The trap is that sending a zero-tip bundle still *succeeds* at the API level — you get a bundle id back — so the code proceeds as if the transactions submitted. They didn't. For an arbitrage or liquidation bot, "the bundle silently never landed" is the difference between a profit and a missed opportunity (or a half-executed position).

## Why it's silent

`sendBundle(...)` returns a bundle id regardless of the tip. Nothing throws. The bundle just isn't included, and you only notice when on-chain state never reflects your transactions.

## The fix

```typescript
// BEFORE (vulnerable — no tip, bundle won't land)
return sendBundle({ transactions, tipLamports: new BN(0) });

// AFTER (fixed — nonzero tip the block engine can prioritize)
return sendBundle({ transactions, tipLamports: new BN(100_000) });
```

In production, **scale the tip with competition** rather than hardcoding it.

## Scope

This rule (`object-arg-property-forbidden-literal`, `BN(0)`-aware) targets the common wrapper signature `sendBundle({ ..., tipLamports })` and fires only in files that import a Jito SDK. The positional `Bundle.addTipTx(payer, lamports, tipAccount, blockhash)` form isn't matched by a single object-field rule — verify that path manually, or add a project-local rule for your exact tip-builder signature.

## References

- [Jito — low-latency transaction send](https://docs.jito.wtf/lowlatencytxnsend/)
