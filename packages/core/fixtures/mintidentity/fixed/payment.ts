import { PublicKey } from "@solana/web3.js";

// Correct USDC mint address
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

export function getPaymentMint(): PublicKey {
  return USDC_MINT;
}
