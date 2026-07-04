import { Connection, VersionedTransaction } from '@solana/web3.js';

export async function tryArbSwap(connection: Connection, transaction: VersionedTransaction): Promise<string> {
  const sig = await connection.sendTransaction(transaction, { skipPreflight: false });
  return sig;
}
