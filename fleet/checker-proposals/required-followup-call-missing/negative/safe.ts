import { createWalletClient, createPublicClient, http, type Account, type Hex } from "viem";

// Known-good viem code the proposed checker MUST NOT flag. If it fires `fail` on
// any of these, it is unsound and the gate rejects it.

// The canonical safe pattern: send, then block on the receipt in the same scope.
export async function submitTransfer(
  client: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  account: Account,
  to: Hex,
  value: bigint,
) {
  const hash = await client.sendTransaction({ account, to, value });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt;
}

// The follow-up lives in a nested continuation — still in scope, still discharges
// the obligation. The checker walks all descendant calls, so this must PASS.
export async function transferThen(
  client: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  account: Account,
  to: Hex,
  value: bigint,
) {
  const hash = await client.sendTransaction({ account, to, value });
  return Promise.resolve(hash).then((h) => publicClient.waitForTransactionReceipt({ hash: h }));
}

// writeContract + confirmation — a different trigger, also confirmed. The candidate
// binds triggerCall="sendTransaction", so here the checker simply abstains; either
// way it must never fail.
export async function writeAndConfirm(
  client: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  request: any,
) {
  const hash = await client.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// Matches the name pattern (submit) but calls neither trigger — the obligation
// never arose, so the checker must ABSTAIN (cant_tell), not fail.
export async function submitLog(publicClient: ReturnType<typeof createPublicClient>, hash: Hex) {
  const receipt = await publicClient.getTransactionReceipt({ hash });
  return receipt.status;
}

// A pure read — no send at all. Must not be flagged.
export async function readBalance(
  publicClient: ReturnType<typeof createPublicClient>,
  address: Hex,
) {
  return publicClient.getBalance({ address });
}
