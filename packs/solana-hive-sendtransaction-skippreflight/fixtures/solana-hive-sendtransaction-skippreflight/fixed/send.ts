import { Connection, VersionedTransaction } from '@solana/web3.js';

declare const wallet: {
  sendTransaction(
    tx: VersionedTransaction,
    connection: Connection,
    opts: { skipPreflight: boolean }
  ): Promise<string>;
};

export async function send(tx: VersionedTransaction) {
  const connection = new Connection(process.env.SOLANA_RPC_URL!);
  return wallet.sendTransaction(tx, connection, {
    skipPreflight: false,
  });
}
