export function splitEqually(total: number, n: number): number[] {
  // VULNERABLE: floors each share and never redistributes the remainder, so the
  // returned shares sum to LESS than total. Splitting 100 across 3 pays out 99 —
  // one unit is silently lost on every uneven split.
  const share = Math.floor(total / n);
  return Array.from({ length: n }, () => share);
}
