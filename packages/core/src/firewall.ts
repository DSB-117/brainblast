// AI-agent transaction firewall.
//
// Before an autonomous agent signs and sends a Solana transaction, this module
// answers one question: "is this safe to sign?" It decodes the serialized
// transaction locally (no network), flags dangerous instruction patterns
// (delegate-approval drains, authority changes, program upgrades, unknown
// programs), and — when an RPC endpoint is available — simulates the
// transaction to surface the CPI tree and any execution error.
//
// Everything network-touching goes through an injectable `fetchImpl`, so the
// whole pipeline is deterministic and unit-testable offline.

import { base58Encode } from "./trustGraph/base58.ts";
import type { RpcOpts } from "./trustGraph/rpc.ts";

// ── Known programs (labelled) ────────────────────────────────────────────────
// A transaction that only touches well-known programs is far less likely to be
// a drain. This is a curated allowlist of system + blue-chip DeFi programs.
export const KNOWN_PROGRAMS: Record<string, string> = {
  "11111111111111111111111111111111": "System Program",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "SPL Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token Account",
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: "Metaplex Token Metadata",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "SPL Memo",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  AddressLookupTab1e1111111111111111111111111: "Address Lookup Table",
  BPFLoaderUpgradeab1e11111111111111111111111: "BPF Upgradeable Loader",
  // Blue-chip DeFi / launch programs
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter Aggregator v6",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM v4",
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Orca Whirlpools",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "pump.fun",
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: "PumpSwap AMM",
};

const SPL_TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);

const BPF_UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";

export type FirewallSeverity = "info" | "warn" | "critical";
export type FirewallVerdict = "allow" | "warn" | "block";

export interface FirewallFinding {
  severity: FirewallSeverity;
  kind: string;
  detail: string;
}

export interface FirewallProgram {
  id: string;
  label: string | null;
  known: boolean;
  topLevel: boolean;
}

export interface DecodedInstruction {
  programIdIndex: number;
  programId: string;
  accountIndexes: number[];
  data: Uint8Array;
}

export interface DecodedTx {
  version: "legacy" | number;
  numRequiredSignatures: number;
  numReadonlySigned: number;
  numReadonlyUnsigned: number;
  staticAccountKeys: string[];
  recentBlockhash: string;
  instructions: DecodedInstruction[];
  addressTableLookups: { accountKey: string; writableCount: number; readonlyCount: number }[];
}

export interface FirewallReport {
  version: "legacy" | number;
  feePayer: string;
  numSigners: number;
  staticAccounts: number;
  programs: FirewallProgram[];
  usesAddressLookupTables: boolean;
  simulation: {
    ran: boolean;
    ok?: boolean;
    err?: unknown;
    unitsConsumed?: number;
    logsCount?: number;
    cpiPrograms?: string[];
  };
  findings: FirewallFinding[];
  verdict: FirewallVerdict;
}

// ── compact-u16 (shortvec) decoding ──────────────────────────────────────────
function readCompactU16(buf: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let shift = 0;
  let o = offset;
  for (;;) {
    const byte = buf[o++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 21) throw new Error("compact-u16 too long");
  }
  return [value, o];
}

// ── Transaction decoder (pure) ───────────────────────────────────────────────
// Accepts a fully serialized transaction (signatures + message). Set
// `messageOnly` when the input is a bare message with no signature array.
export function decodeTransaction(base64: string, opts: { messageOnly?: boolean } = {}): DecodedTx {
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (bytes.length < 35) throw new Error("transaction too short to be valid");

  let o = 0;
  if (!opts.messageOnly) {
    // Skip the signature array: compact-u16 count, then count * 64 bytes.
    const [sigCount, afterCount] = readCompactU16(bytes, 0);
    o = afterCount + sigCount * 64;
    if (o >= bytes.length) throw new Error("signature array overruns buffer");
  }

  const msg = bytes.subarray(o);
  let mo = 0;

  let version: "legacy" | number = "legacy";
  if ((msg[0] & 0x80) !== 0) {
    version = msg[0] & 0x7f;
    mo = 1;
  }

  const numRequiredSignatures = msg[mo++];
  const numReadonlySigned = msg[mo++];
  const numReadonlyUnsigned = msg[mo++];

  const [acctCount, afterAccts] = readCompactU16(msg, mo);
  mo = afterAccts;
  const staticAccountKeys: string[] = [];
  for (let i = 0; i < acctCount; i++) {
    staticAccountKeys.push(base58Encode(msg.subarray(mo, mo + 32)));
    mo += 32;
  }

  const recentBlockhash = base58Encode(msg.subarray(mo, mo + 32));
  mo += 32;

  const [ixCount, afterIxCount] = readCompactU16(msg, mo);
  mo = afterIxCount;
  const instructions: DecodedInstruction[] = [];
  for (let i = 0; i < ixCount; i++) {
    const programIdIndex = msg[mo++];
    const [naccts, afterNaccts] = readCompactU16(msg, mo);
    mo = afterNaccts;
    const accountIndexes: number[] = [];
    for (let j = 0; j < naccts; j++) accountIndexes.push(msg[mo++]);
    const [datalen, afterDatalen] = readCompactU16(msg, mo);
    mo = afterDatalen;
    const data = msg.subarray(mo, mo + datalen);
    mo += datalen;
    instructions.push({
      programIdIndex,
      programId: staticAccountKeys[programIdIndex] ?? `#${programIdIndex}`,
      accountIndexes,
      data,
    });
  }

  const addressTableLookups: DecodedTx["addressTableLookups"] = [];
  if (version !== "legacy") {
    const [altCount, afterAlt] = readCompactU16(msg, mo);
    mo = afterAlt;
    for (let i = 0; i < altCount; i++) {
      const accountKey = base58Encode(msg.subarray(mo, mo + 32));
      mo += 32;
      const [wlen, afterW] = readCompactU16(msg, mo);
      mo = afterW + wlen;
      const [rlen, afterR] = readCompactU16(msg, mo);
      mo = afterR + rlen;
      addressTableLookups.push({ accountKey, writableCount: wlen, readonlyCount: rlen });
    }
  }

  return {
    version,
    numRequiredSignatures,
    numReadonlySigned,
    numReadonlyUnsigned,
    staticAccountKeys,
    recentBlockhash,
    instructions,
    addressTableLookups,
  };
}

// ── Static instruction heuristics (pure) ─────────────────────────────────────
function splTokenFinding(disc: number): FirewallFinding | null {
  switch (disc) {
    case 4: // Approve
    case 13: // ApproveChecked
      return {
        severity: "warn",
        kind: "token-delegate-approval",
        detail: "Approves a delegate over a token account — a common drain vector. Verify the delegate is trusted.",
      };
    case 6: // SetAuthority
      return {
        severity: "critical",
        kind: "token-set-authority",
        detail: "Changes a mint/account authority (SetAuthority). This can hand control of a token to another party.",
      };
    case 9: // CloseAccount
      return {
        severity: "info",
        kind: "token-close-account",
        detail: "Closes a token account and reclaims its rent to the destination.",
      };
    default:
      return null;
  }
}

function bpfLoaderFinding(disc: number): FirewallFinding | null {
  // u32 LE discriminator
  if (disc === 3)
    return {
      severity: "critical",
      kind: "program-upgrade",
      detail: "Upgrades a deployed program (BPF Upgradeable Loader Upgrade). Replaces on-chain code.",
    };
  if (disc === 4 || disc === 6)
    return {
      severity: "critical",
      kind: "program-set-authority",
      detail: "Changes a program's upgrade authority (BPF Loader SetAuthority).",
    };
  return null;
}

export function analyzeInstructions(decoded: DecodedTx, known: Record<string, string>): FirewallFinding[] {
  const findings: FirewallFinding[] = [];

  for (const ix of decoded.instructions) {
    const pid = ix.programId;

    if (SPL_TOKEN_PROGRAMS.has(pid) && ix.data.length >= 1) {
      const f = splTokenFinding(ix.data[0]);
      if (f) findings.push(f);
    }

    if (pid === BPF_UPGRADEABLE_LOADER && ix.data.length >= 4) {
      const disc = ix.data[0] | (ix.data[1] << 8) | (ix.data[2] << 16) | (ix.data[3] << 24);
      const f = bpfLoaderFinding(disc);
      if (f) findings.push(f);
    }

    if (!(pid in known)) {
      findings.push({
        severity: "warn",
        kind: "unknown-program",
        detail: `Top-level instruction invokes an unrecognized program: ${pid}. Verify it is a program you intend to call.`,
      });
    }
  }

  if (decoded.addressTableLookups.length > 0) {
    findings.push({
      severity: "info",
      kind: "address-lookup-tables",
      detail: `Transaction uses ${decoded.addressTableLookups.length} address lookup table(s); some accounts are resolved off-message and not statically visible.`,
    });
  }

  return findings;
}

// ── Simulation log parsing ───────────────────────────────────────────────────
// Extracts the set of programs invoked (including via CPI) from simulation logs.
export function parseCpiPrograms(logs: string[]): string[] {
  const programs = new Set<string>();
  for (const line of logs) {
    const m = line.match(/^Program (\S+) invoke \[\d+\]$/);
    if (m) programs.add(m[1]);
  }
  return [...programs];
}

interface SimResult {
  err: unknown;
  logs: string[] | null;
  unitsConsumed?: number;
}

async function simulate(base64: string, opts: RpcOpts): Promise<SimResult> {
  const { DEFAULT_RPC } = await import("./trustGraph/rpc.ts");
  const url = opts.rpcUrl ?? DEFAULT_RPC;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateTransaction",
        params: [base64, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }],
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`simulateTransaction: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: { value: any }; error?: { message: string } };
    if (body.error) throw new Error(`simulateTransaction: ${body.error.message}`);
    const v = body.result?.value ?? {};
    return { err: v.err ?? null, logs: v.logs ?? null, unitsConsumed: v.unitsConsumed };
  } finally {
    clearTimeout(t);
  }
}

// ── Orchestration ────────────────────────────────────────────────────────────
export interface FirewallOpts extends RpcOpts {
  simulate?: boolean; // default true
  messageOnly?: boolean;
  knownPrograms?: Record<string, string>;
}

function worstSeverity(findings: FirewallFinding[]): FirewallVerdict {
  if (findings.some((f) => f.severity === "critical")) return "block";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "allow";
}

export async function inspectTransaction(base64: string, opts: FirewallOpts = {}): Promise<FirewallReport> {
  const known = { ...KNOWN_PROGRAMS, ...(opts.knownPrograms ?? {}) };
  const decoded = decodeTransaction(base64, { messageOnly: opts.messageOnly });

  const findings = analyzeInstructions(decoded, known);

  // Programs touched at the top level
  const topLevelIds = new Set(decoded.instructions.map((ix) => ix.programId));
  const programs: FirewallProgram[] = [...topLevelIds].map((id) => ({
    id,
    label: known[id] ?? null,
    known: id in known,
    topLevel: true,
  }));

  const report: FirewallReport = {
    version: decoded.version,
    feePayer: decoded.staticAccountKeys[0] ?? "(none)",
    numSigners: decoded.numRequiredSignatures,
    staticAccounts: decoded.staticAccountKeys.length,
    programs,
    usesAddressLookupTables: decoded.addressTableLookups.length > 0,
    simulation: { ran: false },
    findings,
    verdict: "allow",
  };

  if (opts.simulate !== false) {
    try {
      const sim = await simulate(base64, opts);
      const cpiPrograms = sim.logs ? parseCpiPrograms(sim.logs) : [];
      report.simulation = {
        ran: true,
        ok: sim.err === null,
        err: sim.err ?? undefined,
        unitsConsumed: sim.unitsConsumed,
        logsCount: sim.logs?.length,
        cpiPrograms,
      };

      // Flag unknown programs surfaced only via CPI (not at the top level).
      for (const pid of cpiPrograms) {
        if (!(pid in known) && !topLevelIds.has(pid)) {
          findings.push({
            severity: "warn",
            kind: "unknown-cpi-program",
            detail: `Cross-program invocation to an unrecognized program: ${pid}.`,
          });
          report.programs.push({ id: pid, label: null, known: false, topLevel: false });
        }
      }

      if (sim.err !== null) {
        findings.push({
          severity: "warn",
          kind: "simulation-failed",
          detail: `Transaction simulation returned an error: ${JSON.stringify(sim.err)}. Signing it would likely fail on-chain.`,
        });
      }
    } catch (e: any) {
      report.simulation = { ran: false };
      findings.push({
        severity: "info",
        kind: "simulation-unavailable",
        detail: `Could not simulate (static analysis only): ${e?.message ?? String(e)}`,
      });
    }
  }

  report.verdict = worstSeverity(findings);
  return report;
}

// ── Rendering ────────────────────────────────────────────────────────────────
const SEV_ICON: Record<FirewallSeverity, string> = { critical: "⛔", warn: "⚠ ", info: "· " };
const VERDICT_BANNER: Record<FirewallVerdict, string> = {
  allow: "ALLOW — no dangerous patterns detected",
  warn: "WARN — review before signing",
  block: "BLOCK — dangerous pattern detected, do not sign blind",
};

export function renderFirewallText(r: FirewallReport): string {
  const lines: string[] = [];
  lines.push(`Transaction firewall  [${VERDICT_BANNER[r.verdict]}]`);
  lines.push("");
  lines.push(`  Version:     ${r.version}`);
  lines.push(`  Fee payer:   ${r.feePayer}`);
  lines.push(`  Signers:     ${r.numSigners}`);
  lines.push(`  Accounts:    ${r.staticAccounts}${r.usesAddressLookupTables ? " (+ lookup tables)" : ""}`);
  lines.push(`  Programs:`);
  for (const p of r.programs) {
    const tag = p.known ? p.label : "UNKNOWN";
    lines.push(`    ${p.known ? "✓" : "?"} ${p.id}  ${tag}${p.topLevel ? "" : " (via CPI)"}`);
  }
  if (r.simulation.ran) {
    lines.push(`  Simulation:  ${r.simulation.ok ? "ok" : "FAILED"}${r.simulation.unitsConsumed != null ? ` (${r.simulation.unitsConsumed} CU)` : ""}`);
  } else {
    lines.push(`  Simulation:  not run`);
  }
  lines.push("");
  if (r.findings.length === 0) {
    lines.push("  No findings.");
  } else {
    lines.push("  Findings:");
    for (const f of r.findings) {
      lines.push(`    ${SEV_ICON[f.severity]} [${f.kind}] ${f.detail}`);
    }
  }
  return lines.join("\n");
}
