import DLMM from "@meteora-ag/dlmm";
import BN from "bn.js";

// VULNERABLE — minOutAmount: new BN(0) removes the slippage floor. The swap
// will fill at any price; a sandwich bot can move the pool and extract value
// with no revert protection.
export async function swapExactIn(dlmmPool: DLMM, user: any, inAmount: BN) {
  const swapForY = true;
  const binArrays = await dlmmPool.getBinArrayForSwap(swapForY);
  return dlmmPool.swap({
    inToken: (dlmmPool as any).tokenX.publicKey,
    outToken: (dlmmPool as any).tokenY.publicKey,
    inAmount,
    minOutAmount: new BN(0),
    lbPair: (dlmmPool as any).pubkey,
    user,
    binArraysPubkey: binArrays.map((b: any) => b.publicKey),
  });
}
