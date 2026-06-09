// FIXED: creates on-chain token metadata with isMutable: false explicitly set.
// The metadata is permanently sealed at mint time — name, symbol, and URI
// cannot be changed regardless of who holds the update authority.
import { createV1, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";

export async function mintToken(umi: any) {
  await createV1(umi, {
    mint: "11111111111111111111111111111111" as any,
    name: "My Token",
    symbol: "MTK",
    uri: "https://arweave.net/metadata.json",
    sellerFeeBasisPoints: 0 as any,
    tokenStandard: TokenStandard.Fungible,
    isMutable: false,
  });
}
