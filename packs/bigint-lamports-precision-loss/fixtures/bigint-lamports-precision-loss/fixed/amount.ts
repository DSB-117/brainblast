export function addAmounts(a: string, b: string): string {
  // FIXED: BigInt arithmetic is exact for arbitrarily large integer amounts.
  return (BigInt(a) + BigInt(b)).toString();
}
