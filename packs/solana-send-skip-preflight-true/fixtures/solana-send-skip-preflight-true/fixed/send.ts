import { Connection, Transaction } from "@solana/web3.js";

export async function submitTransfer(conn: Connection, tx: Transaction) {
  // FIXED: preflight simulation runs, so a failing transaction is caught before broadcast.
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  return sig;
}
