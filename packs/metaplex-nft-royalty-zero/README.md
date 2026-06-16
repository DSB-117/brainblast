# metaplex-nft-royalty-zero

**Severity:** HIGH

## What's the trap?

When minting an NFT with `@metaplex-foundation/js`, the `sellerFeeBasisPoints` field in `create()` sets the on-chain royalty percentage for the NFT's entire lifetime. A value of `0` means:

- Creators earn **zero** royalties on every secondary sale
- This is **immutable** — Metaplex token-metadata cannot be changed after mint without burning the NFT and reminting it

AI code generators frequently use `0` as a "fill in later" placeholder, and launch teams sometimes leave it in to appear collection-friendly. Either way, the economic harm is permanent.

## Why it's silent

The `create()` call succeeds with `sellerFeeBasisPoints: 0` — there is no warning, no validation error, no on-chain check. The NFT mints normally and is immediately tradeable. The royalty loss only becomes apparent when secondary sales generate no creator income.

## The fix

```typescript
// BEFORE (vulnerable — zero royalties, permanent)
return metaplex.nfts().create({
  uri,
  name: "My NFT",
  sellerFeeBasisPoints: 0,   // ← trap
});

// AFTER (fixed — 5% royalties)
return metaplex.nfts().create({
  uri,
  name: "My NFT",
  sellerFeeBasisPoints: 500, // 500 basis points = 5%
});
```

## References

- [Metaplex Token Metadata — Mint docs](https://developers.metaplex.com/token-metadata/mint)
- `CreateNftInput.sellerFeeBasisPoints` — required field, immutable after mint
