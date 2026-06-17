import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  createApproveInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  decodeTransaction,
  analyzeInstructions,
  parseCpiPrograms,
  inspectTransaction,
  renderFirewallText,
} from "../src/firewall.ts";

const DUMMY_BLOCKHASH = new PublicKey(new Uint8Array(32)).toBase58();

function legacyToBase64(ix: TransactionInstruction[], payer: PublicKey): string {
  const tx = new Transaction();
  tx.add(...ix);
  tx.recentBlockhash = DUMMY_BLOCKHASH;
  tx.feePayer = payer;
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

describe("decodeTransaction", () => {
  it("decodes a legacy SOL transfer round-trip", () => {
    const from = Keypair.generate();
    const to = Keypair.generate();
    const ix = SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to.publicKey, lamports: 1000 });
    const b64 = legacyToBase64([ix], from.publicKey);

    const decoded = decodeTransaction(b64);
    expect(decoded.version).toBe("legacy");
    expect(decoded.numRequiredSignatures).toBe(1);
    expect(decoded.staticAccountKeys[0]).toBe(from.publicKey.toBase58());
    expect(decoded.instructions).toHaveLength(1);
    expect(decoded.instructions[0].programId).toBe(SystemProgram.programId.toBase58());
  });

  it("decodes a v0 (versioned) transaction", () => {
    const from = Keypair.generate();
    const to = Keypair.generate();
    const ix = SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to.publicKey, lamports: 1000 });
    const msg = new TransactionMessage({
      payerKey: from.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [ix],
    }).compileToV0Message();
    const vtx = new VersionedTransaction(msg);
    const b64 = Buffer.from(vtx.serialize()).toString("base64");

    const decoded = decodeTransaction(b64);
    expect(decoded.version).toBe(0);
    expect(decoded.instructions[0].programId).toBe(SystemProgram.programId.toBase58());
  });

  it("decodes a v0 transaction that uses an address lookup table", () => {
    const from = Keypair.generate();
    const altKey = Keypair.generate().publicKey;
    const dest = Keypair.generate().publicKey;
    const lookup = new AddressLookupTableAccount({
      key: altKey,
      state: {
        deactivationSlot: BigInt("18446744073709551615"),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: from.publicKey,
        addresses: [dest],
      },
    });
    const ix = SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: dest, lamports: 1000 });
    const msg = new TransactionMessage({
      payerKey: from.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [ix],
    }).compileToV0Message([lookup]);
    const vtx = new VersionedTransaction(msg);
    const b64 = Buffer.from(vtx.serialize()).toString("base64");

    const decoded = decodeTransaction(b64);
    expect(decoded.version).toBe(0);
    expect(decoded.addressTableLookups.length).toBeGreaterThan(0);
    expect(decoded.addressTableLookups[0].accountKey).toBe(altKey.toBase58());
  });

  it("throws on a too-short buffer", () => {
    expect(() => decodeTransaction(Buffer.from([1, 2, 3]).toString("base64"))).toThrow();
  });
});

describe("analyzeInstructions static heuristics", () => {
  const KNOWN = { "11111111111111111111111111111111": "System Program", [TOKEN_PROGRAM_ID.toBase58()]: "SPL Token" };

  it("flags a token Approve as a delegate-approval warning", () => {
    const account = Keypair.generate().publicKey;
    const delegate = Keypair.generate().publicKey;
    const owner = Keypair.generate();
    const ix = createApproveInstruction(account, delegate, owner.publicKey, 1000);
    const decoded = decodeTransaction(legacyToBase64([ix], owner.publicKey));
    const findings = analyzeInstructions(decoded, KNOWN);
    expect(findings.some((f) => f.kind === "token-delegate-approval")).toBe(true);
  });

  it("flags a token SetAuthority as critical", () => {
    const account = Keypair.generate().publicKey;
    const current = Keypair.generate();
    const newAuth = Keypair.generate().publicKey;
    const ix = createSetAuthorityInstruction(account, current.publicKey, AuthorityType.AccountOwner, newAuth);
    const decoded = decodeTransaction(legacyToBase64([ix], current.publicKey));
    const findings = analyzeInstructions(decoded, KNOWN);
    const f = findings.find((x) => x.kind === "token-set-authority");
    expect(f?.severity).toBe("critical");
  });

  it("flags an unknown program", () => {
    const payer = Keypair.generate();
    const unknownProgram = Keypair.generate().publicKey;
    const ix = new TransactionInstruction({
      programId: unknownProgram,
      keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
      data: Buffer.from([0]),
    });
    const decoded = decodeTransaction(legacyToBase64([ix], payer.publicKey));
    const findings = analyzeInstructions(decoded, KNOWN);
    expect(findings.some((f) => f.kind === "unknown-program")).toBe(true);
  });

  it("produces no findings for a plain SOL transfer between known programs", () => {
    const from = Keypair.generate();
    const to = Keypair.generate();
    const ix = SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to.publicKey, lamports: 1000 });
    const decoded = decodeTransaction(legacyToBase64([ix], from.publicKey));
    const findings = analyzeInstructions(decoded, KNOWN);
    expect(findings).toHaveLength(0);
  });
});

describe("parseCpiPrograms", () => {
  it("extracts invoked program ids from logs", () => {
    const logs = [
      "Program 11111111111111111111111111111111 invoke [1]",
      "Program 11111111111111111111111111111111 success",
      "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]",
      "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success",
    ];
    const programs = parseCpiPrograms(logs);
    expect(programs).toContain("11111111111111111111111111111111");
    expect(programs).toContain("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  });
});

function mockSim(value: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: { value } }),
  });
}

describe("inspectTransaction (with simulation)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns allow for a benign transfer that simulates ok", async () => {
    const from = Keypair.generate();
    const to = Keypair.generate();
    const ix = SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to.publicKey, lamports: 1000 });
    const b64 = legacyToBase64([ix], from.publicKey);

    const fetchImpl = mockSim({
      err: null,
      logs: ["Program 11111111111111111111111111111111 invoke [1]", "Program 11111111111111111111111111111111 success"],
      unitsConsumed: 150,
    }) as unknown as typeof fetch;

    const report = await inspectTransaction(b64, { fetchImpl });
    expect(report.verdict).toBe("allow");
    expect(report.simulation.ran).toBe(true);
    expect(report.simulation.ok).toBe(true);
  });

  it("blocks a SetAuthority transaction", async () => {
    const account = Keypair.generate().publicKey;
    const current = Keypair.generate();
    const newAuth = Keypair.generate().publicKey;
    const ix = createSetAuthorityInstruction(account, current.publicKey, AuthorityType.AccountOwner, newAuth);
    const b64 = legacyToBase64([ix], current.publicKey);

    const report = await inspectTransaction(b64, { simulate: false });
    expect(report.verdict).toBe("block");
  });

  it("flags an unknown CPI program surfaced only in logs", async () => {
    const from = Keypair.generate();
    const to = Keypair.generate();
    const ix = SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to.publicKey, lamports: 1000 });
    const b64 = legacyToBase64([ix], from.publicKey);

    const fetchImpl = mockSim({
      err: null,
      logs: [
        "Program 11111111111111111111111111111111 invoke [1]",
        "Program Drainz1111111111111111111111111111111111111 invoke [2]",
        "Program Drainz1111111111111111111111111111111111111 success",
      ],
    }) as unknown as typeof fetch;

    const report = await inspectTransaction(b64, { fetchImpl });
    expect(report.findings.some((f) => f.kind === "unknown-cpi-program")).toBe(true);
    expect(report.verdict).toBe("warn");
  });

  it("degrades gracefully when simulation throws", async () => {
    const from = Keypair.generate();
    const to = Keypair.generate();
    const ix = SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to.publicKey, lamports: 1000 });
    const b64 = legacyToBase64([ix], from.publicKey);

    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const report = await inspectTransaction(b64, { fetchImpl });
    expect(report.simulation.ran).toBe(false);
    expect(report.findings.some((f) => f.kind === "simulation-unavailable")).toBe(true);
    // Benign transfer with no simulation → still allow
    expect(report.verdict).toBe("allow");
  });

  it("warns when simulation reports an execution error", async () => {
    const from = Keypair.generate();
    const to = Keypair.generate();
    const ix = SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to.publicKey, lamports: 1000 });
    const b64 = legacyToBase64([ix], from.publicKey);

    const fetchImpl = mockSim({ err: { InstructionError: [0, "Custom"] }, logs: [] }) as unknown as typeof fetch;
    const report = await inspectTransaction(b64, { fetchImpl });
    expect(report.findings.some((f) => f.kind === "simulation-failed")).toBe(true);
    expect(report.verdict).toBe("warn");
  });
});

describe("renderFirewallText", () => {
  it("renders a verdict banner and findings", async () => {
    const account = Keypair.generate().publicKey;
    const current = Keypair.generate();
    const newAuth = Keypair.generate().publicKey;
    const ix = createSetAuthorityInstruction(account, current.publicKey, AuthorityType.AccountOwner, newAuth);
    const report = await inspectTransaction(legacyToBase64([ix], current.publicKey), { simulate: false });
    const text = renderFirewallText(report);
    expect(text).toContain("BLOCK");
    expect(text).toContain("token-set-authority");
  });
});
