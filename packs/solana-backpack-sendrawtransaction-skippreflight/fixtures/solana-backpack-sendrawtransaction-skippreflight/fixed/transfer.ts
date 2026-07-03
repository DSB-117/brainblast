import { Connection, Transaction } from '@solana/web3.js';

export async function transferProgrammableNft(
  connection: Connection,
  signedTx: Transaction,
  commitment: 'confirmed'
) {
  const rawTx = signedTx.serialize();
  return await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    preflightCommitment: commitment,
  });
}
