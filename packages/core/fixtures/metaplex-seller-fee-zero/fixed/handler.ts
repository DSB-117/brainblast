import { createV1, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";

// FIXED — sellerFeeBasisPoints is set explicitly (500 = 5%). Creators earn a
// 5% royalty on every secondary sale, configured at mint time.
export async function mintToken(umi: any) {
  return createV1(umi, {
    mint: umi.mint,
    authority: umi.authority,
    name: "My Token",
    uri: "https://example.com/token.json",
    tokenStandard: TokenStandard.NonFungible,
    sellerFeeBasisPoints: 500,
  } as any);
}
