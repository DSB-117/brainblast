import { Connection, Transaction, Keypair, sendAndConfirmTransaction } from "@solana/web3.js";

export async function sendPayment(
  connection: Connection,
  tx: Transaction,
  signer: Keypair,
): Promise<string> {
  // FIXED: blocks until the transaction is confirmed by the cluster
  return sendAndConfirmTransaction(connection, tx, [signer]);
}
