// Tier-2 custody: the agent never holds principal. The OWNER, from their own
// wallet, grants the agent pubkey a capped SPL allowance via `approve`; the
// agent spends as a delegate up to that on-chain allowance; the owner `revoke`s
// in one transaction. The cap is enforced by the SPL Token program itself, not
// by our code — the strongest separation we can offer.
//
// We cannot (and must not) sign for the owner, so `delegate`/`revoke` EMIT the
// exact owner-side command + structured params; the owner runs it from the
// wallet that actually holds the funds. The delegated SPEND path (agent moving
// the owner's tokens as delegate) lives here too.

import { brainMint, USDC_MINT } from "./chain.ts";

async function web3() {
  return import("@solana/web3.js");
}
async function spl() {
  return import("@solana/spl-token");
}

export function resolveMint(token: string): { mint: string; label: string } {
  const t = token.toLowerCase();
  if (t === "brain" || t === "$brain") return { mint: brainMint(), label: "$BRAIN" };
  if (t === "usdc" || t === "$usdc") return { mint: USDC_MINT, label: "USDC" };
  return { mint: token, label: token }; // treat as a raw mint address
}

export interface DelegateInstructions {
  ownerTokenAccount: string; // the owner's ATA the allowance is set on
  delegate: string; // the agent pubkey
  mint: string;
  label: string;
  uiAmount: number;
  approveCommand: string; // ready-to-run owner-side command
  note: string;
}

// Produce the owner-side `approve` for a capped allowance to the agent. Derives
// the owner's associated token account (no network needed) so the command is
// copy-paste runnable.
export async function buildDelegateInstructions(opts: {
  ownerPubkey: string;
  agentPubkey: string;
  token: string;
  uiAmount: number;
}): Promise<DelegateInstructions> {
  const w = await web3();
  const s = await spl();
  const { mint, label } = resolveMint(opts.token);
  const owner = new w.PublicKey(opts.ownerPubkey);
  const mintPk = new w.PublicKey(mint);
  const ownerAta = (await s.getAssociatedTokenAddress(mintPk, owner)).toBase58();
  return {
    ownerTokenAccount: ownerAta,
    delegate: opts.agentPubkey,
    mint,
    label,
    uiAmount: opts.uiAmount,
    approveCommand: `spl-token approve ${ownerAta} ${opts.uiAmount} ${opts.agentPubkey} --owner <your-wallet>`,
    note:
      `This grants the agent wallet (${opts.agentPubkey}) a capped allowance of ` +
      `${opts.uiAmount} ${label} from YOUR token account. The agent can spend up to that ` +
      `amount as a delegate; you keep custody and can revoke anytime.`,
  };
}

export async function buildRevokeInstructions(opts: {
  ownerPubkey: string;
  token: string;
}): Promise<{ ownerTokenAccount: string; revokeCommand: string }> {
  const w = await web3();
  const s = await spl();
  const { mint } = resolveMint(opts.token);
  const owner = new w.PublicKey(opts.ownerPubkey);
  const ownerAta = (await s.getAssociatedTokenAddress(new w.PublicKey(mint), owner)).toBase58();
  return {
    ownerTokenAccount: ownerAta,
    revokeCommand: `spl-token revoke ${ownerAta} --owner <your-wallet>`,
  };
}

// The agent spends the owner's tokens as an approved delegate: transfer FROM the
// owner's ATA, signed by the AGENT keypair (the delegate authority). Bounded by
// the on-chain allowance the owner set with `approve`.
export async function sendDelegatedTransfer(opts: {
  agentSecret: Uint8Array;
  ownerPubkey: string;
  to: string;
  token: string;
  uiAmount: number;
  memo?: string;
}): Promise<string> {
  const w = await web3();
  const s = await spl();
  const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } = w;
  const connection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
  const agent = Keypair.fromSecretKey(opts.agentSecret);
  const { mint } = resolveMint(opts.token);
  const mintPk = new PublicKey(mint);
  const owner = new PublicKey(opts.ownerPubkey);
  const to = new PublicKey(opts.to);
  const mintInfo = await s.getMint(connection, mintPk);
  const fromAta = await s.getAssociatedTokenAddress(mintPk, owner);
  const toAta = await s.getAssociatedTokenAddress(mintPk, to);
  const amountRaw = BigInt(Math.round(opts.uiAmount * 10 ** mintInfo.decimals));

  const tx = new Transaction();
  tx.add(s.createAssociatedTokenAccountIdempotentInstruction(agent.publicKey, toAta, to, mintPk));
  // Source = owner's ATA; authority = the agent (delegate). The SPL program
  // checks the delegated allowance and decrements it.
  tx.add(s.createTransferCheckedInstruction(fromAta, mintPk, toAta, agent.publicKey, amountRaw, mintInfo.decimals));
  if (opts.memo) {
    tx.add(
      new TransactionInstruction({
        keys: [],
        programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
        data: Buffer.from(opts.memo, "utf8"),
      }),
    );
  }
  return sendAndConfirmTransaction(connection, tx, [agent]);
}
