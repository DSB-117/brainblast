// Signguard — quantify value movement out of a transaction.
//
// The firewall says *what kind* of instruction this is; Signguard says *how much
// leaves and to whom*. We decode SystemProgram lamport movements (Transfer,
// CreateAccount) and SPL token transfers from a DecodedTx, attributing SOL that
// leaves the fee payer so a spend cap has a real number to check.

import type { DecodedTx } from "../firewall.ts";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);

export interface SolTransfer {
  from: string | null;
  to: string | null;
  lamports: bigint;
  kind: "transfer" | "create-account";
}

export interface TokenTransfer {
  source: string | null;
  dest: string | null;
  amount: bigint;
  program: string;
}

export interface TransferSummary {
  feePayer: string;
  solOutLamports: bigint; // lamports leaving the fee payer
  solTransfers: SolTransfer[];
  tokenTransfers: TokenTransfer[];
  recipients: string[]; // distinct destinations that are not the fee payer
  imprecise: boolean; // an account was resolved via a lookup table (not visible)
}

function readU32LE(d: Uint8Array, o: number): number {
  return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
}
function readU64LE(d: Uint8Array, o: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[o + i] ?? 0);
  return v;
}

export function summarizeTransfers(tx: DecodedTx): TransferSummary {
  const feePayer = tx.staticAccountKeys[0] ?? "(none)";
  const resolve = (ix: { accountIndexes: number[] }, n: number): string | null => {
    const idx = ix.accountIndexes[n];
    return idx != null && idx < tx.staticAccountKeys.length ? tx.staticAccountKeys[idx] : null;
  };

  const solTransfers: SolTransfer[] = [];
  const tokenTransfers: TokenTransfer[] = [];
  let solOutLamports = 0n;
  let imprecise = tx.addressTableLookups.length > 0;

  for (const ix of tx.instructions) {
    if (ix.programId === SYSTEM_PROGRAM && ix.data.length >= 4) {
      const disc = readU32LE(ix.data, 0);
      if (disc === 2 && ix.data.length >= 12) {
        // Transfer: from, to ; lamports at offset 4
        const from = resolve(ix, 0);
        const to = resolve(ix, 1);
        const lamports = readU64LE(ix.data, 4);
        solTransfers.push({ from, to, lamports, kind: "transfer" });
        if (from === feePayer) solOutLamports += lamports;
        if (from === null || to === null) imprecise = true;
      } else if (disc === 0 && ix.data.length >= 12) {
        // CreateAccount: from, new ; lamports at offset 4
        const from = resolve(ix, 0);
        const to = resolve(ix, 1);
        const lamports = readU64LE(ix.data, 4);
        solTransfers.push({ from, to, lamports, kind: "create-account" });
        if (from === feePayer) solOutLamports += lamports;
        if (from === null) imprecise = true;
      }
    } else if (TOKEN_PROGRAMS.has(ix.programId) && ix.data.length >= 9) {
      const disc = ix.data[0];
      if (disc === 3) {
        // Transfer: [source, dest, authority] ; amount u64 at offset 1
        tokenTransfers.push({ source: resolve(ix, 0), dest: resolve(ix, 1), amount: readU64LE(ix.data, 1), program: ix.programId });
      } else if (disc === 12) {
        // TransferChecked: [source, mint, dest, authority] ; amount u64 at offset 1
        tokenTransfers.push({ source: resolve(ix, 0), dest: resolve(ix, 2), amount: readU64LE(ix.data, 1), program: ix.programId });
      }
    }
  }

  const recipients = [
    ...new Set(
      [...solTransfers.map((t) => t.to), ...tokenTransfers.map((t) => t.dest)].filter(
        (r): r is string => !!r && r !== feePayer,
      ),
    ),
  ];

  return { feePayer, solOutLamports, solTransfers, tokenTransfers, recipients, imprecise };
}

export const LAMPORTS_PER_SOL = 1_000_000_000;
export function lamportsToSol(l: bigint): number {
  return Number(l) / LAMPORTS_PER_SOL;
}
