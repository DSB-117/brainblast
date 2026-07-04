import type { Signature } from '@solana/web3.js';

type Signed = unknown;
type SendAndConfirm = (tx: Signed, config: { commitment: string; skipPreflight: boolean }) => Promise<void>;

export async function transferSol(
  sendAndConfirmTransaction: SendAndConfirm,
  signedTransaction: Signed,
): Promise<void> {
  await sendAndConfirmTransaction(
    signedTransaction,
    { commitment: 'confirmed', skipPreflight: true },
  );
}
