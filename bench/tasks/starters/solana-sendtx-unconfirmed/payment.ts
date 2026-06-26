import { Connection, Transaction, Keypair, sendAndConfirmTransaction } from "@solana/web3.js";

export async function sendPayment(
  connection: Connection,
  tx: Transaction,
  signer: Keypair,
): Promise<string> {
  // TODO: implement correctly using the SDK.
}
