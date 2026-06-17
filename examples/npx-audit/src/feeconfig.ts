// This is exactly the kind of code an AI agent ships when it knows the Bags
// SDK shape but not the trap: the launch succeeds, the partners get paid, and
// the creator silently earns 0% of trading fees — forever, because the fee
// config is immutable on-chain after launch. There is no way to fix this
// after the token goes live.
import { createBagsFeeShareConfig } from "@bagsfm/bags-sdk";

export function buildFeeShareConfig(creatorWallet: string) {
  const feeClaimers = [
    { user: "Partner1Wa11et11111111111111111111111111111", userBps: 6000 },
    { user: "Partner2Wa11et22222222222222222222222222222", userBps: 4000 },
  ];
  return createBagsFeeShareConfig({ feeClaimers });
}
