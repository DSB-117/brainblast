import { PublicKey } from "@solana/web3.js";

// VULNERABLE: the constant is labelled USDC, but this address is actually the
// USDT mint (Es9vMFrz…). Any payment routed through this constant moves the
// wrong token. The variable name "USDC_MINT" is a lie the compiler can't catch.
const USDC_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

export function getPaymentMint(): PublicKey {
  return USDC_MINT;
}
