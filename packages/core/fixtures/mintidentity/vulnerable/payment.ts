import { PublicKey } from "@solana/web3.js";

// Wrong address — USDT address used for USDC_MINT
const USDC_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

export function getPaymentMint(): PublicKey {
  return USDC_MINT;
}
