import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { createTransferCheckedInstruction, getAssociatedTokenAddress } from "@solana/spl-token";

const TOKEN_DECIMALS = 6;

export async function executeSolanaPayout(
  connection: Connection,
  payer: Keypair,
  mintAddress: string,
  destinationOwner: string,
  amountTokens: number,
) {
  const sourceAta = await getAssociatedTokenAddress(mintAddress as any, payer.publicKey);
  const destinationAta = await getAssociatedTokenAddress(mintAddress as any, destinationOwner as any);

  const amount = amountTokens * 10 ** TOKEN_DECIMALS;

  const transferIx = createTransferCheckedInstruction(
    sourceAta,
    mintAddress as any,
    destinationAta,
    payer.publicKey,
    amount,
    TOKEN_DECIMALS,
  );

  const tx = new Transaction().add(transferIx);
  return connection.sendTransaction(tx, [payer]);
}
