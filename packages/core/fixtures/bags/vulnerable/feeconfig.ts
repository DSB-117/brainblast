// VULNERABLE: builds the Bags fee-share config WITHOUT the creator wallet in
// feeClaimers. The launch succeeds, but the creator earns 0 fees forever — and
// the fee config is immutable on-chain, so this cannot be corrected after launch.
import { createBagsFeeShareConfig } from "@bagsfm/bags-sdk";

export function buildFeeShareConfig(creatorWallet: string) {
  const feeClaimers = [
    { user: "Partner1Wa11et11111111111111111111111111111", userBps: 6000 },
    { user: "Partner2Wa11et22222222222222222222222222222", userBps: 4000 },
  ];
  return createBagsFeeShareConfig({ feeClaimers });
}
