import { createWalletClient, createPublicClient, http, type Account, type Hex } from "viem";

export async function submitTransfer(
  client: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  account: Account,
  to: Hex,
  value: bigint,
) {
  // FIXED: block until the transaction is mined, then act on the receipt.
  const hash = await client.sendTransaction({ account, to, value });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt;
}
