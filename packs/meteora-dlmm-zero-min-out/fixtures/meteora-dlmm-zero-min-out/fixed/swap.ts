import DLMM from "@meteora-ag/dlmm";
import BN from "bn.js";

// FIXED — minOutAmount is derived from the on-chain quote and a 0.5% slippage
// tolerance, so the swap reverts if it would return less than expected.
export async function swapExactIn(dlmmPool: DLMM, user: any, inAmount: BN) {
  const swapForY = true;
  const binArrays = await dlmmPool.getBinArrayForSwap(swapForY);
  const quote = dlmmPool.swapQuote(inAmount, swapForY, new BN(50), binArrays); // 50 bps = 0.5%
  return dlmmPool.swap({
    inToken: (dlmmPool as any).tokenX.publicKey,
    outToken: (dlmmPool as any).tokenY.publicKey,
    inAmount,
    minOutAmount: quote.minOutAmount,
    lbPair: (dlmmPool as any).pubkey,
    user,
    binArraysPubkey: binArrays.map((b: any) => b.publicKey),
  });
}
