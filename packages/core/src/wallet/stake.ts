// Stake the anti-poisoning bond on a contributed VTI, from the Vault-managed
// agent wallet, THROUGH the policy gate. This is the in-core successor to
// scripts/agent-stake/stake.ts: same registry protocol (register → memo + pay_to
// → $BRAIN transfer with memo), but the secret comes from the Vault (not an env
// var) and every send passes signWithPolicy() first (caps + session ledger).

import { loadSecretKey, getActiveWallet } from "./agentWallet.ts";
import { signWithPolicy, type SignResult } from "./policy.ts";
import { brainMint, sendTokenTransfer } from "./chain.ts";

function apiBase(): string {
  return process.env.BRAINBLAST_API_BASE ?? "https://app.brainblast.tech";
}

export interface StakeArgs {
  packId: string;
  ruleId: string;
  stakeUsd: number; // the cap currency
  brainAmount: number; // $BRAIN (human units) to send — computed from a price quote upstream
}

export interface StakeOutcome extends SignResult {
  stakeId?: string;
  memoCode?: string;
  payTo?: string;
}

// Register the stake with the registry to obtain a memo code + payout address,
// then send the bonded $BRAIN — but only if the policy gate allows it.
export async function stakeBond(args: StakeArgs): Promise<StakeOutcome> {
  const active = getActiveWallet();
  if (!active) throw new Error("wallet: no active agent wallet (run `brainblast wallet init`)");
  const secret = loadSecretKey(active.pubkey);

  const res = await fetch(`${apiBase()}/api/stakes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pack_id: args.packId,
      rule_id: args.ruleId,
      author_wallet: active.pubkey,
      stake_usd: args.stakeUsd,
    }),
  });
  if (!res.ok) {
    throw new Error(`POST /api/stakes failed: ${res.status} ${await res.text()}`);
  }
  const stake = (await res.json()) as { id: string; memo_code: string; pay_to: string };

  // The gate runs BEFORE the transfer; a cap/recipient violation refuses here
  // and nothing is sent.
  const result = await signWithPolicy(
    { purpose: "stake", recipient: stake.pay_to, usd: args.stakeUsd },
    () =>
      sendTokenTransfer({
        secret,
        mint: brainMint(),
        to: stake.pay_to,
        uiAmount: args.brainAmount,
        memo: stake.memo_code,
      }),
  );

  return { ...result, stakeId: stake.id, memoCode: stake.memo_code, payTo: stake.pay_to };
}
