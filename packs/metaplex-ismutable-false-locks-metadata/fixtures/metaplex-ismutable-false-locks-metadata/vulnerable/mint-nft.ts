import { createNft } from '@metaplex-foundation/mpl-token-metadata';
import { generateSigner, percentAmount } from '@metaplex-foundation/umi';

export async function mint(umi: any) {
  const mint = generateSigner(umi);
  await createNft(umi, {
    mint,
    name: 'Super Sweet NFT',
    uri: 'https://example.com/token.json',
    sellerFeeBasisPoints: percentAmount(5),
    isMutable: false,
  }).sendAndConfirm(umi);
  return mint;
}
