import { Connection, Transaction } from "@solana/web3.js";

export async function submitTransfer(conn: Connection, tx: Transaction) {
  // VULNERABLE: skipPreflight bypasses simulation — a failing tx is broadcast and its error is never surfaced.
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    preflightCommitment: "confirmed",
  });
  return sig;
}
