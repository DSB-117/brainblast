import { Metaplex } from "@metaplex-foundation/js";

export async function mintNft(metaplex: Metaplex, uri: string) {
  // FIXED: 5% royalty on secondary sales
  return metaplex.nfts().create({
    uri,
    name: "My NFT",
    sellerFeeBasisPoints: 500,
    symbol: "MNFT",
  });
}
