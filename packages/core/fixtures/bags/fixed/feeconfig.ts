// FIXED: the creator wallet is explicitly included in feeClaimers with its own
// userBps, and all userBps sum to exactly 10000 (100%). The creator now earns
// their share of fees on every claim.
import { createBagsFeeShareConfig } from "@bagsfm/bags-sdk";

export function buildFeeShareConfig(creatorWallet: string) {
  const feeClaimers = [
    { user: creatorWallet, userBps: 5000 },
    { user: "Partner1Wa11et11111111111111111111111111111", userBps: 3000 },
    { user: "Partner2Wa11et22222222222222222222222222222", userBps: 2000 },
  ];
  return createBagsFeeShareConfig({ feeClaimers });
}
