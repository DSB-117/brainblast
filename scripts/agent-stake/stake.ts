// Pays a brainblast pack stake from a dedicated, capped "ops wallet".
//
// SECURITY MODEL (see .claude/skills/brainblast-scout/SKILL.md for the full
// writeup): this script is meant to be run by an autonomous agent. It only
// ever touches a small, dedicated wallet that the human funds periodically
// (e.g. $20-50 of $BRAIN/SOL). Worst case if this wallet is compromised is
// whatever balance it happens to hold at the time — never the user's main
// holdings.
//
// Hard requirements enforced here:
//   - secret key comes ONLY from AGENT_OPS_WALLET_SECRET (base58), never a
//     file, never a CLI arg, never logged.
//   - every payment is checked against a per-transaction cap
//     (AGENT_STAKE_MAX_USD) and a cumulative session cap
//     (AGENT_STAKE_SESSION_CAP_USD), tracked in .session-spend.json next to
//     this script.
//
// Usage:
//   AGENT_OPS_WALLET_SECRET=... tsx stake.ts \
//     --pack-id <id> --rule-id <id> --stake-usd 12.5 --brain-amount 4231.7
//
// `--brain-amount` is the amount of $BRAIN (human units, not lamports) to
// transfer — computed by the agent ahead of time from a price quote. This
// script does not fetch prices; it only enforces caps and moves tokens.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getMint,
} from "@solana/spl-token";

const HERE = dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = join(HERE, ".session-spend.json");

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const BRAIN_MINT = process.env.BRAIN_MINT ?? "5wxVBRmjaRLw71SE7nNFzTioEtQdzM5EkdP5k1BDBAGS";
const API_BASE = process.env.BRAINBLAST_API_BASE ?? "https://app.brainblast.tech";
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const PER_TX_CAP_USD = Number(process.env.AGENT_STAKE_MAX_USD ?? "25");
const SESSION_CAP_USD = Number(process.env.AGENT_STAKE_SESSION_CAP_USD ?? "50");

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      out[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function readSessionSpend(): number {
  if (!existsSync(SESSION_FILE)) return 0;
  try {
    const data = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
    return Number(data.spentUsd ?? 0);
  } catch {
    return 0;
  }
}

function recordSessionSpend(usd: number) {
  const total = readSessionSpend() + usd;
  writeFileSync(SESSION_FILE, JSON.stringify({ spentUsd: total, updatedAt: new Date().toISOString() }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packId = args["pack-id"];
  const ruleId = args["rule-id"];
  const stakeUsd = Number(args["stake-usd"]);
  const brainAmount = Number(args["brain-amount"]);

  if (!packId || !ruleId || !Number.isFinite(stakeUsd) || !Number.isFinite(brainAmount)) {
    console.error(
      "usage: tsx stake.ts --pack-id <id> --rule-id <id> --stake-usd <usd> --brain-amount <brain>",
    );
    process.exit(1);
  }

  // --- Hard spend caps, enforced before anything touches the chain. ---
  if (stakeUsd > PER_TX_CAP_USD) {
    console.error(
      `refusing: stake $${stakeUsd} exceeds per-transaction cap $${PER_TX_CAP_USD} (AGENT_STAKE_MAX_USD)`,
    );
    process.exit(1);
  }
  const spent = readSessionSpend();
  if (spent + stakeUsd > SESSION_CAP_USD) {
    console.error(
      `refusing: stake $${stakeUsd} would bring session spend to $${(spent + stakeUsd).toFixed(2)}, ` +
        `exceeding session cap $${SESSION_CAP_USD} (AGENT_STAKE_SESSION_CAP_USD, already spent $${spent.toFixed(2)})`,
    );
    process.exit(1);
  }

  const secret = process.env.AGENT_OPS_WALLET_SECRET;
  if (!secret) {
    console.error("AGENT_OPS_WALLET_SECRET is not set");
    process.exit(1);
  }
  const keypair = Keypair.fromSecretKey(bs58.decode(secret));
  const authorWallet = keypair.publicKey.toBase58();

  // --- Register the stake to get a memo code + payout address. ---
  const stakeRes = await fetch(`${API_BASE}/api/stakes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack_id: packId, rule_id: ruleId, author_wallet: authorWallet, stake_usd: stakeUsd }),
  });
  if (!stakeRes.ok) {
    console.error(`POST /api/stakes failed: ${stakeRes.status} ${await stakeRes.text()}`);
    process.exit(1);
  }
  const stake = (await stakeRes.json()) as { id: string; memo_code: string; pay_to: string };
  console.log(`registered stake ${stake.id} (memo ${stake.memo_code}) -> ${stake.pay_to}`);

  // --- Build + send the $BRAIN transfer with memo. ---
  const connection = new Connection(RPC_URL, "confirmed");
  const mint = new PublicKey(BRAIN_MINT);
  const payTo = new PublicKey(stake.pay_to);
  const mintInfo = await getMint(connection, mint);

  const fromAta = await getAssociatedTokenAddress(mint, keypair.publicKey);
  const toAta = await getAssociatedTokenAddress(mint, payTo);

  const amountRaw = BigInt(Math.round(brainAmount * 10 ** mintInfo.decimals));

  const tx = new Transaction();
  tx.add(createAssociatedTokenAccountIdempotentInstruction(keypair.publicKey, toAta, payTo, mint));
  tx.add(createTransferCheckedInstruction(fromAta, mint, toAta, keypair.publicKey, amountRaw, mintInfo.decimals));
  tx.add(
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(stake.memo_code, "utf8"),
    }),
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
  console.log(`sent ${brainAmount} $BRAIN to ${stake.pay_to} (memo ${stake.memo_code})`);
  console.log(`tx: ${sig}`);

  recordSessionSpend(stakeUsd);
  console.log(`session spend now $${(spent + stakeUsd).toFixed(2)} / $${SESSION_CAP_USD}`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
