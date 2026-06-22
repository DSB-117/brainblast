import { describe, it, expect } from "vitest";
import { enrichSecretsOnchain, type OnchainDeps } from "../src/keys/onchain.ts";
import { finalizeReport } from "../src/keys/scan.ts";
import { BPF_UPGRADEABLE_LOADER } from "../src/trustGraph/rpc.ts";
import type { DetectedSecret } from "../src/keys/types.ts";

function secret(rel: string, pubkey: string): DetectedSecret {
  return {
    kind: "solana-keypair-64",
    confidence: "high",
    reason: "keypair",
    pubkey,
    path: `/abs/${rel}`,
    rel,
    tier: "funds",
    needsOnchainCheck: true,
  };
}

// PROG is a deployed program whose sole upgrade authority is AUTH. AUTH is a
// wallet holding SOL. EMPTY is an unused keypair with no on-chain footprint.
const fakeDeps: OnchainDeps = {
  probeUpgradeAuthority: async (programId: string) => {
    if (programId === "PROG") {
      return { kind: "unknown", address: "AUTH", source: "rpc", checkedAt: "now" } as any;
    }
    throw new Error("not a program");
  },
  getAccountInfo: async (address: string) => {
    if (address === "PROG") {
      return { owner: BPF_UPGRADEABLE_LOADER, data: new Uint8Array(), executable: true, lamports: 1_000_000_000 } as any;
    }
    if (address === "AUTH") {
      return { owner: "11111111111111111111111111111111", data: new Uint8Array(), executable: false, lamports: 500_000_000 } as any;
    }
    if (address === "EMPTY") {
      return { owner: "11111111111111111111111111111111", data: new Uint8Array(), executable: false, lamports: 0 } as any;
    }
    return null;
  },
};

describe("onchain enrichment", () => {
  it("promotes the sole upgrade authority to TERMINAL", async () => {
    const report = finalizeReport("/abs", [
      secret("target/deploy/prog-keypair.json", "PROG"),
      secret("deploy-authority.json", "AUTH"),
      secret("unused.json", "EMPTY"),
    ]);

    const out = await enrichSecretsOnchain(report, { deps: fakeDeps });
    const by = Object.fromEntries(out.secrets.map((s) => [s.pubkey, s]));

    expect(by["AUTH"].tier).toBe("terminal");
    expect(by["AUTH"].reason).toMatch(/SOLE UPGRADE AUTHORITY of PROG/);
    expect(by["AUTH"].onchain?.upgradeAuthorityOf).toEqual(["PROG"]);
  });

  it("marks a deployed program keypair as REBUILDABLE (post-deploy it only set the address)", async () => {
    const report = finalizeReport("/abs", [secret("target/deploy/prog-keypair.json", "PROG")]);
    const out = await enrichSecretsOnchain(report, { deps: fakeDeps });
    expect(out.secrets[0].tier).toBe("rebuildable");
    expect(out.secrets[0].onchain?.isDeployedProgram).toBe(true);
  });

  it("reports a funded wallet as FUNDS with the SOL amount", async () => {
    // AUTH would be terminal if PROG is a candidate; check it alone (no program
    // context) so the funds path is exercised.
    const report = finalizeReport("/abs", [secret("wallet.json", "AUTH")]);
    const out = await enrichSecretsOnchain(report, { deps: fakeDeps });
    expect(out.secrets[0].tier).toBe("funds");
    expect(out.secrets[0].reason).toMatch(/0\.5000 SOL/);
  });

  it("de-escalates an empty, non-authority key to UNKNOWN and clears the on-chain flag", async () => {
    const report = finalizeReport("/abs", [secret("unused.json", "EMPTY")]);
    const out = await enrichSecretsOnchain(report, { deps: fakeDeps });
    expect(out.secrets[0].tier).toBe("unknown");
    expect(out.secrets[0].needsOnchainCheck).toBe(false);
  });

  it("leaves a key untouched when its RPC call fails", async () => {
    const failing: OnchainDeps = {
      probeUpgradeAuthority: async () => { throw new Error("net"); },
      getAccountInfo: async () => { throw new Error("net"); },
    };
    const report = finalizeReport("/abs", [secret("wallet.json", "AUTH")]);
    const out = await enrichSecretsOnchain(report, { deps: failing });
    expect(out.secrets[0].tier).toBe("funds"); // unchanged offline best-guess
    expect(out.secrets[0].needsOnchainCheck).toBe(true);
  });
});
