import { Raydium } from "@raydium-io/raydium-sdk-v2";

export async function getSwapOutput(raydium: Raydium, poolId: string, amountIn: bigint) {
  const pool = await raydium.liquidity.getPoolInfoFromRpc(poolId);
  // VULNERABLE: slippage: 0 means minAmountOut === amountOut — no sandwich protection
  return raydium.liquidity.computeAmountOut({
    poolInfo: pool.poolInfo,
    amountIn,
    mintInfo: pool.mintInfos,
    slippage: 0,
  });
}
