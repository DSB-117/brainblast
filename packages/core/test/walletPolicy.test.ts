import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkSpend,
  signWithPolicy,
  readSessionSpend,
  recordSessionSpend,
  resetSessionSpend,
  addOwnerSweepAddress,
  loadWalletPolicy,
  saveWalletPolicy,
  DEFAULT_WALLET_POLICY,
  type WalletSpendPolicy,
} from "../src/wallet/policy.ts";

const OWNER = "9owNeRsweepAddrPLACEHOLДERxxxxxxxxxxxxxxxxxx";
const PAYTO = "5stakePayToAddrPLACEHOLDERxxxxxxxxxxxxxxxxxxx";

function policy(over: Partial<WalletSpendPolicy> = {}): WalletSpendPolicy {
  return { ...DEFAULT_WALLET_POLICY, ...over };
}

describe("Agent Wallet spend policy (the gate that bounds a compromised agent)", () => {
  let dir: string;
  let prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wpol-"));
    prev = {
      session: process.env.BRAINBLAST_WALLET_SESSION_FILE,
      pol: process.env.BRAINBLAST_WALLET_POLICY_FILE,
      tx: process.env.AGENT_STAKE_MAX_USD,
      sess: process.env.AGENT_STAKE_SESSION_CAP_USD,
    };
    process.env.BRAINBLAST_WALLET_SESSION_FILE = join(dir, "session.json");
    process.env.BRAINBLAST_WALLET_POLICY_FILE = join(dir, "policy.json");
    delete process.env.AGENT_STAKE_MAX_USD;
    delete process.env.AGENT_STAKE_SESSION_CAP_USD;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of [
      ["BRAINBLAST_WALLET_SESSION_FILE", prev.session],
      ["BRAINBLAST_WALLET_POLICY_FILE", prev.pol],
      ["AGENT_STAKE_MAX_USD", prev.tx],
      ["AGENT_STAKE_SESSION_CAP_USD", prev.sess],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("allows a stake within caps; recipient is protocol-resolved (no allowlist)", () => {
    const d = checkSpend({ purpose: "stake", recipient: PAYTO, usd: 10 }, policy());
    expect(d.ok).toBe(true);
  });

  it("refuses a stake over the per-tx cap", () => {
    const d = checkSpend({ purpose: "stake", recipient: PAYTO, usd: 999 }, policy({ maxUsdPerTx: 25 }));
    expect(d.ok).toBe(false);
    expect(d.violations.join(" ")).toContain("per-tx cap");
  });

  it("refuses when cumulative session spend would exceed the session cap", () => {
    recordSessionSpend(45);
    const d = checkSpend({ purpose: "stake", recipient: PAYTO, usd: 10 }, policy({ maxUsdPerSession: 50 }));
    expect(d.ok).toBe(false);
    expect(d.violations.join(" ")).toContain("session cap");
  });

  it("enforces the SOL per-tx cap", () => {
    const d = checkSpend({ purpose: "stake", recipient: PAYTO, usd: 5, sol: 3 }, policy({ maxSolPerTx: 1 }));
    expect(d.ok).toBe(false);
    expect(d.violations.join(" ")).toContain("SOL");
  });

  it("blocks an unknown program when blockUnknownPrograms is on", () => {
    const d = checkSpend(
      { purpose: "transfer", recipient: PAYTO, usd: 1, programIds: ["EVILprog1111111111111111111111111111111111"] },
      policy({ allowedRecipients: [PAYTO] }),
    );
    expect(d.ok).toBe(false);
    expect(d.violations.join(" ")).toContain("not allowlisted");
  });

  it("a generic transfer must go to an allowlisted recipient", () => {
    const blocked = checkSpend({ purpose: "transfer", recipient: "someoneElse", usd: 1 }, policy({ allowedRecipients: [PAYTO] }));
    expect(blocked.ok).toBe(false);
    const ok = checkSpend({ purpose: "transfer", recipient: PAYTO, usd: 1 }, policy({ allowedRecipients: [PAYTO] }));
    expect(ok.ok).toBe(true);
  });

  describe("sweep (the panic button)", () => {
    it("is refused fail-closed when no owner address is configured", () => {
      const d = checkSpend({ purpose: "sweep", recipient: OWNER, usd: 0 }, policy({ ownerSweepAddresses: [] }));
      expect(d.ok).toBe(false);
      expect(d.violations.join(" ")).toContain("no owner sweep address");
    });

    it("is refused when targeting a non-owner address (anti-drain)", () => {
      const d = checkSpend({ purpose: "sweep", recipient: "attacker", usd: 0 }, policy({ ownerSweepAddresses: [OWNER] }));
      expect(d.ok).toBe(false);
    });

    it("ignores spend caps when draining to a registered owner address", () => {
      recordSessionSpend(49);
      const d = checkSpend(
        { purpose: "sweep", recipient: OWNER, usd: 1_000_000 },
        policy({ ownerSweepAddresses: [OWNER], maxUsdPerSession: 50 }),
      );
      expect(d.ok).toBe(true);
    });
  });

  it("env caps (AGENT_STAKE_*) tighten the policy", () => {
    process.env.AGENT_STAKE_MAX_USD = "5";
    const d = checkSpend({ purpose: "stake", recipient: PAYTO, usd: 10 });
    expect(d.ok).toBe(false);
  });

  it("addOwnerSweepAddress persists and is idempotent", () => {
    addOwnerSweepAddress(OWNER);
    addOwnerSweepAddress(OWNER);
    const { policy: p } = loadWalletPolicy();
    expect(p.ownerSweepAddresses).toEqual([OWNER]);
  });

  describe("signWithPolicy orchestration", () => {
    it("refuses fail-closed: the executor is NEVER called when the gate blocks", async () => {
      let called = false;
      const r = await signWithPolicy(
        { purpose: "stake", recipient: PAYTO, usd: 999 },
        async () => {
          called = true;
          return "sig";
        },
        policy({ maxUsdPerTx: 25 }),
      );
      expect(r.ok).toBe(false);
      expect(called).toBe(false);
      expect(readSessionSpend()).toBe(0); // nothing debited on refusal
    });

    it("on a successful stake: sends once and debits the session ledger", async () => {
      const r = await signWithPolicy({ purpose: "stake", recipient: PAYTO, usd: 10 }, async () => "sig123", policy());
      expect(r.ok).toBe(true);
      expect(r.signature).toBe("sig123");
      expect(readSessionSpend()).toBe(10);
    });

    it("a sweep does NOT debit the session ledger (recovering your own funds)", async () => {
      recordSessionSpend(5);
      const r = await signWithPolicy(
        { purpose: "sweep", recipient: OWNER, usd: 0 },
        async () => "sweepSig",
        policy({ ownerSweepAddresses: [OWNER] }),
      );
      expect(r.ok).toBe(true);
      expect(readSessionSpend()).toBe(5); // unchanged
    });
  });

  it("resetSessionSpend zeroes the ledger", () => {
    recordSessionSpend(20);
    expect(readSessionSpend()).toBe(20);
    resetSessionSpend();
    expect(readSessionSpend()).toBe(0);
  });

  it("a saved policy round-trips and merges over secure defaults", () => {
    saveWalletPolicy(policy({ maxUsdPerTx: 7, ownerSweepAddresses: [OWNER] }));
    const { policy: p } = loadWalletPolicy();
    expect(p.maxUsdPerTx).toBe(7);
    expect(p.blockUnknownPrograms).toBe(true); // default preserved
    expect(p.ownerSweepAddresses).toEqual([OWNER]);
  });
});
