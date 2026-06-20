import { createV1, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";

// VULNERABLE — the generalized Bags exploit, royalty edition.
//
// `sellerFeeBasisPoints` is omitted from the createV1 config, so it defaults to
// zero. The token mints successfully and looks correct on-chain, but the
// creator earns NOTHING on every secondary sale, forever. No error, no warning,
// no migration path once minted. (The `as any` mirrors how loosely-typed launch
// scripts call the SDK — the field is silently absent.)
export async function mintToken(umi: any) {
  return createV1(umi, {
    mint: umi.mint,
    authority: umi.authority,
    name: "My Token",
    uri: "https://example.com/token.json",
    tokenStandard: TokenStandard.NonFungible,
    // sellerFeeBasisPoints: <— omitted → defaults to 0 → zero royalties
  } as any);
}
