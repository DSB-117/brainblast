import { Connection } from '@solana/web3.js';

export async function sendRawTransaction(
  connection: Connection,
  rawTx: Buffer,
): Promise<string> {
  const signature = await connection.sendRawTransaction(rawTx, {
    skipPreflight: true,
    preflightCommitment: 'confirmed',
    maxRetries: 0,
  });
  return signature;
}
