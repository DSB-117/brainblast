import { Raydium } from "@raydium-io/raydium-sdk-v2";

export async function getSwapOutput(raydium: Raydium, poolId: string, amountIn: bigint) {
  const pool = await raydium.liquidity.getPoolInfoFromRpc(poolId);
  // FIXED: 0.5% slippage tolerance enforces a minimum output floor
  return raydium.liquidity.computeAmountOut({
    poolInfo: pool.poolInfo,
    amountIn,
    mintInfo: pool.mintInfos,
    slippage: 0.5,
  });
}
