import { describe, it, expect } from "vitest";
import { summarizeTransfers } from "../src/signguard/transfers.ts";
import { evaluateSigning } from "../src/signguard/evaluate.ts";
import { evaluateSolanaCommand } from "../src/signguard/commands.ts";
import { inspectSigning } from "../src/signguard/index.ts";
import { DEFAULT_POLICY, normalizePolicy } from "../src/signguard/policy.ts";
import { base58Encode } from "../src/trustGraph/base58.ts";
import type { DecodedTx } from "../src/firewall.ts";

const SYSTEM = "11111111111111111111111111111111";
const FEE_PAYER = base58Encode(new Uint8Array(32).fill(1));
const RECIPIENT = base58Encode(new Uint8Array(32).fill(2));

// A legacy DecodedTx with one SystemProgram Transfer of `lamports` from fee payer.
function transferTx(lamports: bigint): DecodedTx {
  const data = new Uint8Array(12);
  data.set([2, 0, 0, 0], 0); // Transfer discriminant
  let l = lamports;
  for (let i = 0; i < 8; i++) { data[4 + i] = Number(l & 0xffn); l >>= 8n; }
  return {
    version: "legacy",
    numRequiredSignatures: 1,
    numReadonlySigned: 0,
    numReadonlyUnsigned: 1,
    staticAccountKeys: [FEE_PAYER, RECIPIENT, SYSTEM],
    recentBlockhash: base58Encode(new Uint8Array(32).fill(9)),
    instructions: [{ programIdIndex: 2, programId: SYSTEM, accountIndexes: [0, 1], data }],
    addressTableLookups: [],
  };
}

describe("transfers: SOL quantification", () => {
  it("sums lamports leaving the fee payer and lists the recipient", () => {
    const s = summarizeTransfers(transferTx(2_500_000_000n));
    expect(s.solOutLamports).toBe(2_500_000_000n);
    expect(s.recipients).toEqual([RECIPIENT]);
    expect(s.imprecise).toBe(false);
  });
});

describe("evaluate: policy verdicts", () => {
  it("BLOCKS a transfer over the per-tx SOL cap", () => {
    const v = evaluateSigning(transferTx(5_000_000_000n), [], DEFAULT_POLICY); // 5 SOL > 1 cap
    expect(v.decision).toBe("block");
    expect(v.solOut).toBe(5);
    expect(v.findings.some((f) => f.kind === "spend-cap-tx")).toBe(true);
  });

  it("ALLOWS a transfer under the cap", () => {
    const v = evaluateSigning(transferTx(500_000_000n), [], DEFAULT_POLICY); // 0.5 SOL
    expect(v.decision).toBe("allow");
  });

  it("BLOCKS on the cumulative session cap", () => {
    const v = evaluateSigning(transferTx(800_000_000n), [], DEFAULT_POLICY, { sessionSolOut: 4.8 }); // 0.8 ok per-tx, 5.6 > 5 session
    expect(v.decision).toBe("block");
    expect(v.findings.some((f) => f.kind === "spend-cap-session")).toBe(true);
  });

  it("maps a SetAuthority firewall finding to the action policy (block by default)", () => {
    const v = evaluateSigning(transferTx(0n), [{ severity: "critical", kind: "token-set-authority", detail: "x" }], DEFAULT_POLICY);
    expect(v.decision).toBe("block");
  });

  it("respects an action policy override to allow", () => {
    const policy = normalizePolicy({ actions: { setAuthority: "allow" } as any });
    const v = evaluateSigning(transferTx(0n), [{ severity: "critical", kind: "token-set-authority", detail: "x" }], policy);
    expect(v.decision).toBe("allow");
  });

  it("blocks unknown programs when policy says so, warns otherwise", () => {
    const finding = { severity: "warn" as const, kind: "unknown-program", detail: "x" };
    expect(evaluateSigning(transferTx(0n), [finding], DEFAULT_POLICY).decision).toBe("block");
    const lax = normalizePolicy({ blockUnknownPrograms: false });
    expect(evaluateSigning(transferTx(0n), [finding], lax).decision).toBe("warn");
  });

  it("enforces a recipient allowlist", () => {
    const policy = normalizePolicy({ allowedRecipients: ["SomeOtherAddress11111111111111111111111111"] });
    const v = evaluateSigning(transferTx(100_000_000n), [], policy);
    expect(v.findings.some((f) => f.kind === "recipient-not-allowed")).toBe(true);
    expect(v.decision).toBe("block");
  });
});

describe("commands: Solana CLI interception", () => {
  it("BLOCKS `solana transfer` over the cap", () => {
    const v = evaluateSolanaCommand(`solana transfer ${RECIPIENT} 9`, DEFAULT_POLICY);
    expect(v.recognized).toBe(true);
    expect(v.decision).toBe("block");
  });
  it("ALLOWS a small transfer", () => {
    expect(evaluateSolanaCommand(`solana transfer ${RECIPIENT} 0.2`, DEFAULT_POLICY).decision).toBe("allow");
  });
  it("BLOCKS `solana transfer … ALL`", () => {
    expect(evaluateSolanaCommand(`solana transfer ${RECIPIENT} ALL`, DEFAULT_POLICY).decision).toBe("block");
  });
  it("BLOCKS `solana program set-upgrade-authority`", () => {
    expect(evaluateSolanaCommand("solana program set-upgrade-authority Prog1 --new-upgrade-authority X", DEFAULT_POLICY).decision).toBe("block");
  });
  it("ignores unrelated commands", () => {
    const v = evaluateSolanaCommand("ls -la && echo hi", DEFAULT_POLICY);
    expect(v.recognized).toBe(false);
    expect(v.decision).toBe("allow");
  });
});

// Build a real serialized legacy tx (sigs + message) to exercise the full
// decode → firewall → policy pipeline.
function encodeTransferTx(lamports: bigint): string {
  const keys = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2), new Uint8Array(32)]; // feePayer, recipient, System(zeros)
  const data = new Uint8Array(12);
  data.set([2, 0, 0, 0], 0);
  let l = lamports;
  for (let i = 0; i < 8; i++) { data[4 + i] = Number(l & 0xffn); l >>= 8n; }
  const parts: number[] = [];
  parts.push(1); for (let i = 0; i < 64; i++) parts.push(0); // 1 signature
  parts.push(1, 0, 1); // header
  parts.push(3); for (const k of keys) parts.push(...k); // 3 account keys
  for (let i = 0; i < 32; i++) parts.push(9); // blockhash
  parts.push(1); // 1 instruction
  parts.push(2); // programIdIndex → System
  parts.push(2, 0, 1); // 2 account indexes
  parts.push(12); parts.push(...data); // data
  return Buffer.from(Uint8Array.from(parts)).toString("base64");
}

describe("inspectSigning: full pipeline (decode → policy)", () => {
  it("BLOCKS a 5 SOL transfer against the default policy (no network)", async () => {
    const r = await inspectSigning(encodeTransferTx(5_000_000_000n), { simulate: false });
    expect(r.solOut).toBe(5);
    expect(r.decision).toBe("block");
    expect(r.transfers.recipients).toEqual([RECIPIENT]);
  });
  it("ALLOWS a 0.1 SOL transfer", async () => {
    const r = await inspectSigning(encodeTransferTx(100_000_000n), { simulate: false });
    expect(r.decision).toBe("allow");
  });
});
