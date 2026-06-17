import { PublicKey } from "@solana/web3.js";

// FIXED: USDC_MINT now points at the canonical USDC mint.
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

export function getPaymentMint(): PublicKey {
  return USDC_MINT;
}
