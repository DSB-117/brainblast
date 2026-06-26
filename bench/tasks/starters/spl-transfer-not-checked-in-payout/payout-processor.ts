import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { createTransferCheckedInstruction, getAssociatedTokenAddress } from "@solana/spl-token";

export async function executeSolanaPayout(
  connection: Connection,
  payer: Keypair,
  mintAddress: string,
  destinationOwner: string,
  amountTokens: number,
) {
  // TODO: implement correctly using the SDK.
}
