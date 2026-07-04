export function wrapIndex(i: number, n: number): number {
  // FIXED: normalize into [0, n) so negative inputs wrap correctly.
  return ((i % n) + n) % n;
}
