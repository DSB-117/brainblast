// VULNERABLE: creates on-chain token metadata WITHOUT isMutable: false.
// The SDK defaults isMutable to true, leaving the update authority able to
// change the token name, symbol, or URI at any time after mint — permanently.
// There is no on-chain migration path once metadata is minted as mutable.
import { createV1, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";

export async function mintToken(umi: any) {
  await createV1(umi, {
    mint: "11111111111111111111111111111111" as any,
    name: "My Token",
    symbol: "MTK",
    uri: "https://arweave.net/metadata.json",
    sellerFeeBasisPoints: 0 as any,
    tokenStandard: TokenStandard.Fungible,
    // isMutable omitted — SDK defaults to true (mutable forever)
  });
}
