import { Connection, Transaction, Keypair } from "@solana/web3.js";

export async function sendPayment(
  connection: Connection,
  tx: Transaction,
  signer: Keypair,
): Promise<string> {
  // VULNERABLE: fire-and-forget — no confirmation that the transaction landed
  return connection.sendTransaction(tx, [signer]);
}
