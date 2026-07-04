export function applyDiscounts(price: number, pct1: number, pct2: number): number {
  // FIXED: apply the discounts multiplicatively (compound), never additively.
  return Math.round((price * (100 - pct1)) / 100 * (100 - pct2) / 100);
}
