export function minAmountOut(quote: number, slippageBps: number): number {
  // FIXED: basis points divide by 10000 — a 50-bps tolerance deducts 0.5%.
  return quote - Math.floor((quote * slippageBps) / 10000);
}
