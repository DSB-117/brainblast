// RED-TEAM SUITE. Threat model: the AI agent operating this wallet is assumed
// PROMPT-INJECTED — it will pass hostile arguments through the documented tool
// surface (the CLI / the exported gate). These tests assert the invariants that
// must hold against such an adversary. (Full arbitrary code execution is OUT of
// scope and cannot be defended in-process — see the trust-boundary note in
// WALLET-PLAN.md; the defenses there are a small balance + Tier-2 + sweep.)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-ignore — bs58 ships no type declarations; used only as a reference encoder.
import bs58 from "bs58";
import { randomBytes } from "node:crypto";
import { base58Encode, generateKeypair } from "../src/wallet/agentWallet.ts";
import { Keypair } from "@solana/web3.js";
import {
  checkSpend,
  signWithPolicy,
  readSessionSpend,
  readSessionBrain,
  recordSessionSpend,
  recordSessionBrain,
  DEFAULT_WALLET_POLICY,
  type WalletSpendPolicy,
} from "../src/wallet/policy.ts";

const PAYTO = Keypair.generate().publicKey.toBase58();
const OWNER = Keypair.generate().publicKey.toBase58();
const ATTACKER = Keypair.generate().publicKey.toBase58();
const bs58encode = (b: Uint8Array) => ((bs58 as any).default ?? bs58).encode(b);

function policy(over: Partial<WalletSpendPolicy> = {}): WalletSpendPolicy {
  return { ...DEFAULT_WALLET_POLICY, ...over };
}

describe("RED TEAM — encoding & key integrity", () => {
  it("base58Encode matches the reference bs58 on 2000 random buffers (no address corruption)", () => {
    for (let i = 0; i < 2000; i++) {
      const len = 1 + (i % 40);
      const buf = randomBytes(len);
      expect(base58Encode(buf)).toBe(bs58encode(buf));
    }
  });

  it("base58Encode handles all-zero and leading-zero buffers (no dropped '1's)", () => {
    for (const buf of [Buffer.alloc(0), Buffer.alloc(1), Buffer.alloc(8), Buffer.from([0, 0, 0, 255])]) {
      expect(base58Encode(buf)).toBe(bs58encode(buf));
    }
  });

  it("every generated key is a real, spendable Solana keypair (no silent corruption)", () => {
    for (let i = 0; i < 200; i++) {
      const g = generateKeypair();
      expect(Keypair.fromSecretKey(Uint8Array.from(g.secretKeyArray)).publicKey.toBase58()).toBe(g.pubkey);
    }
  });
});

describe("RED TEAM — spend-cap evasion", () => {
  let dir: string;
  let prev: Record<string, string | undefined> = {};
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "watk-"));
    prev = { s: process.env.BRAINBLAST_WALLET_SESSION_FILE, p: process.env.BRAINBLAST_WALLET_POLICY_FILE };
    process.env.BRAINBLAST_WALLET_SESSION_FILE = join(dir, "s.json");
    process.env.BRAINBLAST_WALLET_POLICY_FILE = join(dir, "p.json");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prev.s === undefined) delete process.env.BRAINBLAST_WALLET_SESSION_FILE;
    else process.env.BRAINBLAST_WALLET_SESSION_FILE = prev.s;
    if (prev.p === undefined) delete process.env.BRAINBLAST_WALLET_POLICY_FILE;
    else process.env.BRAINBLAST_WALLET_POLICY_FILE = prev.p;
  });

  it("negative / NaN / Infinity USD is refused (no underflow past the cap)", () => {
    for (const usd of [-1, -1e9, NaN, Infinity, -Infinity]) {
      expect(checkSpend({ purpose: "stake", recipient: PAYTO, usd }, policy()).ok).toBe(false);
    }
  });

  // THE HEADLINE VULN: the gate must bound what ACTUALLY LEAVES (brainAmount),
  // not just the caller-asserted USD. An agent that understates USD while
  // draining a huge token amount must be refused.
  it("a small stated USD with a huge $BRAIN amount is REFUSED (no decoupling)", () => {
    const d = checkSpend(
      { purpose: "stake", recipient: PAYTO, usd: 1, brainAmount: 999_999_999 },
      policy({ maxBrainPerTx: 5000 }),
    );
    expect(d.ok).toBe(false);
    expect(d.violations.join(" ")).toMatch(/BRAIN/i);
  });

  it("a token spend with NO $BRAIN cap configured is fail-closed (refused)", () => {
    const d = checkSpend({ purpose: "stake", recipient: PAYTO, usd: 1, brainAmount: 100 }, policy({ maxBrainPerTx: null }));
    expect(d.ok).toBe(false);
    expect(d.violations.join(" ")).toMatch(/cap/i);
  });

  it("the $BRAIN per-tx cap is enforced", () => {
    expect(checkSpend({ purpose: "stake", recipient: PAYTO, usd: 1, brainAmount: 5001 }, policy({ maxBrainPerTx: 5000 })).ok).toBe(false);
    expect(checkSpend({ purpose: "stake", recipient: PAYTO, usd: 1, brainAmount: 4999 }, policy({ maxBrainPerTx: 5000 })).ok).toBe(true);
  });

  it("the $BRAIN cumulative session cap is enforced across spends", () => {
    recordSessionBrain(4000);
    const d = checkSpend(
      { purpose: "stake", recipient: PAYTO, usd: 1, brainAmount: 2000 },
      policy({ maxBrainPerTx: 5000, maxBrainPerSession: 5000 }),
    );
    expect(d.ok).toBe(false);
  });

  it("negative / NaN $BRAIN amount is refused", () => {
    for (const brainAmount of [-1, NaN, Infinity]) {
      expect(checkSpend({ purpose: "stake", recipient: PAYTO, usd: 1, brainAmount }, policy({ maxBrainPerTx: 5000 })).ok).toBe(false);
    }
  });
});

describe("RED TEAM — sweep anti-drain", () => {
  it("cannot sweep to an attacker address even if caps would allow it", () => {
    expect(checkSpend({ purpose: "sweep", recipient: ATTACKER, usd: 0 }, policy({ ownerSweepAddresses: [OWNER] })).ok).toBe(false);
  });
  it("cannot sweep at all until an owner address is registered (fail-closed)", () => {
    expect(checkSpend({ purpose: "sweep", recipient: ATTACKER, usd: 0 }, policy({ ownerSweepAddresses: [] })).ok).toBe(false);
  });
});

describe("RED TEAM — signWithPolicy is the real chokepoint", () => {
  let dir: string;
  let prev: Record<string, string | undefined> = {};
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "watk2-"));
    prev = { s: process.env.BRAINBLAST_WALLET_SESSION_FILE };
    process.env.BRAINBLAST_WALLET_SESSION_FILE = join(dir, "s.json");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prev.s === undefined) delete process.env.BRAINBLAST_WALLET_SESSION_FILE;
    else process.env.BRAINBLAST_WALLET_SESSION_FILE = prev.s;
  });

  it("a refused spend NEVER calls the executor and NEVER debits any ledger", async () => {
    let called = false;
    const r = await signWithPolicy(
      { purpose: "stake", recipient: PAYTO, usd: 1, brainAmount: 1e12 },
      async () => {
        called = true;
        return "sig";
      },
      policy({ maxBrainPerTx: 5000 }),
    );
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
    expect(readSessionSpend()).toBe(0);
    expect(readSessionBrain()).toBe(0);
  });

  it("a thrown executor (failed broadcast) does NOT debit the ledger", async () => {
    await expect(
      signWithPolicy(
        { purpose: "stake", recipient: PAYTO, usd: 5, brainAmount: 100 },
        async () => {
          throw new Error("rpc down");
        },
        policy({ maxBrainPerTx: 5000 }),
      ),
    ).rejects.toThrow();
    expect(readSessionSpend()).toBe(0);
    expect(readSessionBrain()).toBe(0);
  });

  it("a successful stake debits BOTH the USD and the $BRAIN ledgers", async () => {
    const r = await signWithPolicy(
      { purpose: "stake", recipient: PAYTO, usd: 5, brainAmount: 100 },
      async () => "sig",
      policy({ maxBrainPerTx: 5000 }),
    );
    expect(r.ok).toBe(true);
    expect(readSessionSpend()).toBe(5);
    expect(readSessionBrain()).toBe(100);
  });
});
