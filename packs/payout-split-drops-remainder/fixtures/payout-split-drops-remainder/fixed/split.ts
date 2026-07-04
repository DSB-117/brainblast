export function splitEqually(total: number, n: number): number[] {
  // FIXED: distribute the remainder one unit at a time so the shares sum to total.
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_unused, i) => base + (i < remainder ? 1 : 0));
}
