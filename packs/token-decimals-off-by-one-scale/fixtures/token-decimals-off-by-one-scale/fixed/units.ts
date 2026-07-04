export function toBaseUnits(uiAmount: number, decimals: number): number {
  // FIXED: scale by 10^decimals — the correct base-unit conversion.
  return uiAmount * 10 ** decimals;
}
