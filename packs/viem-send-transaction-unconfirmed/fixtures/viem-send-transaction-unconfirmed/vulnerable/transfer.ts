import { createWalletClient, http, type Account, type Hex } from "viem";

export async function submitTransfer(
  client: ReturnType<typeof createWalletClient>,
  account: Account,
  to: Hex,
  value: bigint,
): Promise<Hex> {
  // VULNERABLE: fire-and-forget. sendTransaction resolves to a HASH the instant
  // the tx is broadcast — not a mined receipt. We hand it back as if it settled.
  const hash = await client.sendTransaction({ account, to, value });
  return hash;
}
