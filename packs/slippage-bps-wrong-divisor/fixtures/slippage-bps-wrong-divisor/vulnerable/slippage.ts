export function minAmountOut(quote: number, slippageBps: number): number {
  // VULNERABLE: basis points are out of 10000, but this divides by 100 (treats
  // bps as a percent). A 50-bps (0.5%) tolerance deducts 50%, so minAmountOut is
  // far below the real floor and the swap accepts catastrophic fills / MEV.
  return quote - Math.floor((quote * slippageBps) / 100);
}
