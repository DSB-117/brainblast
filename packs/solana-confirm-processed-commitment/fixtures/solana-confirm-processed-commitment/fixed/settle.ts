import { Connection, Transaction, Keypair, sendAndConfirmTransaction } from "@solana/web3.js";

export async function settlePayment(conn: Connection, tx: Transaction, payer: Keypair) {
  // FIXED: wait for a durable commitment before treating the payment as settled.
  return sendAndConfirmTransaction(conn, tx, [payer], { commitment: "finalized" });
}
