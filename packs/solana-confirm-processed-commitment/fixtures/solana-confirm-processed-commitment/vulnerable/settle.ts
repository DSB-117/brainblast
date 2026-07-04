import { Connection, Transaction, Keypair, sendAndConfirmTransaction } from "@solana/web3.js";

export async function settlePayment(conn: Connection, tx: Transaction, payer: Keypair) {
  // VULNERABLE: "processed" can still be rolled back — treating it as settled enables phantom payments.
  return sendAndConfirmTransaction(conn, tx, [payer], { commitment: "processed" });
}
