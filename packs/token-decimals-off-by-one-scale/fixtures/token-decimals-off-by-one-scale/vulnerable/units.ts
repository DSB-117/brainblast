export function toBaseUnits(uiAmount: number, decimals: number): number {
  // VULNERABLE: exponent is off by one (decimals - 1), so every amount is scaled
  // to 1/10th of its true base-unit value. A 1.0 USDC transfer moves 0.1 USDC.
  return uiAmount * 10 ** (decimals - 1);
}
