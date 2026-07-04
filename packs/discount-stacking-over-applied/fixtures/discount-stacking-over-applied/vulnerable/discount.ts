export function applyDiscounts(price: number, pct1: number, pct2: number): number {
  // VULNERABLE: two discounts should COMPOUND, but this ADDS the percentages, so a
  // 50%+50% promo makes the item free (or negative). Every stacked coupon
  // over-discounts the order — silent revenue loss.
  return Math.round((price * (100 - pct1 - pct2)) / 100);
}
