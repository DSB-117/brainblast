// The Agent Wallet's on-chain layer. Everything here is network-facing and
// lazy-imports @solana/web3.js + @solana/spl-token, so the audit path never
// pays for them. The pure policy gate (policy.ts) decides; this module only
// reads balances and, once allowed, builds + sends transactions.

import type { Keypair } from "@solana/web3.js";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // mainnet USDC
// Lamports kept back when sweeping SOL, to cover the transfer fee itself.
const SWEEP_FEE_BUFFER_LAMPORTS = 5000;

export function rpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
}
export function brainMint(): string {
  return process.env.BRAIN_MINT ?? "5wxVBRmjaRLw71SE7nNFzTioEtQdzM5EkdP5k1BDBAGS";
}

async function web3() {
  return import("@solana/web3.js");
}
async function spl() {
  return import("@solana/spl-token");
}

export function keypairFromSecret(secret: Uint8Array): Promise<Keypair> {
  return web3().then((w) => w.Keypair.fromSecretKey(secret));
}

export interface TokenBalance {
  uiAmount: number;
  rawAmount: bigint;
  decimals: number;
}
export interface Balances {
  sol: number;
  lamports: bigint;
  brain: TokenBalance;
  usdc: TokenBalance;
}

const ZERO_TOKEN: TokenBalance = { uiAmount: 0, rawAmount: 0n, decimals: 0 };

async function tokenBalance(connection: any, owner: any, mintStr: string): Promise<TokenBalance> {
  const w = await web3();
  const s = await spl();
  const mint = new w.PublicKey(mintStr);
  const ata = await s.getAssociatedTokenAddress(mint, owner);
  try {
    const bal = await connection.getTokenAccountBalance(ata);
    return {
      uiAmount: bal.value.uiAmount ?? 0,
      rawAmount: BigInt(bal.value.amount),
      decimals: bal.value.decimals,
    };
  } catch {
    return { ...ZERO_TOKEN };
  }
}

export async function getBalances(pubkeyStr: string): Promise<Balances> {
  const w = await web3();
  const connection = new w.Connection(rpcUrl(), "confirmed");
  const owner = new w.PublicKey(pubkeyStr);
  const lamports = BigInt(await connection.getBalance(owner));
  const [brain, usdc] = await Promise.all([
    tokenBalance(connection, owner, brainMint()),
    tokenBalance(connection, owner, USDC_MINT),
  ]);
  return { sol: Number(lamports) / 1e9, lamports, brain, usdc };
}

// Build + send an SPL token transfer (with idempotent ATA creation). Returns the
// signature. Used by the staking and generic-transfer executors.
export async function sendTokenTransfer(opts: {
  secret: Uint8Array;
  mint: string;
  to: string;
  uiAmount: number;
  memo?: string;
}): Promise<string> {
  const w = await web3();
  const s = await spl();
  const connection = new w.Connection(rpcUrl(), "confirmed");
  const kp = w.Keypair.fromSecretKey(opts.secret);
  const mint = new w.PublicKey(opts.mint);
  const to = new w.PublicKey(opts.to);
  const mintInfo = await s.getMint(connection, mint);
  const fromAta = await s.getAssociatedTokenAddress(mint, kp.publicKey);
  const toAta = await s.getAssociatedTokenAddress(mint, to);
  const amountRaw = BigInt(Math.round(opts.uiAmount * 10 ** mintInfo.decimals));

  const tx = new w.Transaction();
  tx.add(s.createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, toAta, to, mint));
  tx.add(s.createTransferCheckedInstruction(fromAta, mint, toAta, kp.publicKey, amountRaw, mintInfo.decimals));
  if (opts.memo) {
    tx.add(
      new w.TransactionInstruction({
        keys: [],
        programId: new w.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
        data: Buffer.from(opts.memo, "utf8"),
      }),
    );
  }
  return w.sendAndConfirmTransaction(connection, tx, [kp]);
}

// The panic button: move every token balance, then the remaining SOL, to `to`.
// Returns the signatures of each leg that actually ran.
export async function sweepAll(secret: Uint8Array, to: string): Promise<{ signatures: string[]; movedSol: number }> {
  const w = await web3();
  const s = await spl();
  const connection = new w.Connection(rpcUrl(), "confirmed");
  const kp = w.Keypair.fromSecretKey(secret);
  const dest = new w.PublicKey(to);
  const signatures: string[] = [];

  // 1) Tokens first (their fees are paid from SOL, so drain SOL last).
  for (const mintStr of [brainMint(), USDC_MINT]) {
    const bal = await tokenBalance(connection, kp.publicKey, mintStr);
    if (bal.rawAmount > 0n) {
      const mint = new w.PublicKey(mintStr);
      const fromAta = await s.getAssociatedTokenAddress(mint, kp.publicKey);
      const toAta = await s.getAssociatedTokenAddress(mint, dest);
      const tx = new w.Transaction();
      tx.add(s.createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, toAta, dest, mint));
      tx.add(s.createTransferCheckedInstruction(fromAta, mint, toAta, kp.publicKey, bal.rawAmount, bal.decimals));
      signatures.push(await w.sendAndConfirmTransaction(connection, tx, [kp]));
    }
  }

  // 2) Remaining SOL minus a fee buffer.
  const lamports = await connection.getBalance(kp.publicKey);
  const movableLamports = lamports - SWEEP_FEE_BUFFER_LAMPORTS;
  let movedSol = 0;
  if (movableLamports > 0) {
    const tx = new w.Transaction();
    tx.add(w.SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: dest, lamports: movableLamports }));
    signatures.push(await w.sendAndConfirmTransaction(connection, tx, [kp]));
    movedSol = movableLamports / 1e9;
  }
  return { signatures, movedSol };
}
