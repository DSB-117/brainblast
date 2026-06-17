import { Metaplex } from "@metaplex-foundation/js";

export async function mintNft(metaplex: Metaplex, uri: string) {
  // VULNERABLE: royalties are permanently set to zero — cannot be changed after mint
  return metaplex.nfts().create({
    uri,
    name: "My NFT",
    sellerFeeBasisPoints: 0,
    symbol: "MNFT",
  });
}
