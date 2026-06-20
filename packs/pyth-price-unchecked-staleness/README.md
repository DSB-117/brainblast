# pyth-price-unchecked-staleness

**Severity:** HIGH

## What's the trap?

Pyth `PriceFeed` objects expose two ways to read a price:

- **`getPriceUnchecked()`** — returns the most recent price **regardless of how old it is**.
- **`getPriceNoOlderThan(maxAgeSeconds)`** — returns the price only if it's fresh, otherwise `undefined`.

Using `getPriceUnchecked()` means that if the feed stops updating — a publisher outage, network congestion, a halted market — your protocol keeps pricing swaps, loans, and liquidations against a **stale price** with no guard.

## Why it's silent

`getPriceUnchecked()` always succeeds and always returns a number. Nothing throws. The bug only surfaces when the feed goes stale at exactly the wrong moment — and by then someone has been liquidated at a wrong price, or drained an over-valued position.

## The fix

```typescript
// BEFORE (vulnerable — ignores staleness)
const price = feed.getPriceUnchecked();

// AFTER (fixed — refuse stale prices)
const price = feed.getPriceNoOlderThan(60); // 60s max age
if (!price) throw new Error("Pyth price is stale — refusing to trade");
```

Pyth's own best-practices doc says to **never** use `getPriceUnchecked()` in production.

## References

- [Pyth — price availability best practices](https://docs.pyth.network/price-feeds/best-practices#price-availability)
- Companion: `brainblast oracle <account>` checks the same staleness question live, on-chain.
