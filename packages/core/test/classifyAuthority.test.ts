import { describe, it, expect } from "vitest";
import {
  classifyUpgradeAuthority,
  enrichAuthorityClassification,
  SYSTEM_PROGRAM,
  KNOWN_AUTHORITY_OWNERS,
  buildTrustGraph,
  base58Decode,
  renderTrustGraphMd,
} from "../src/trustGraph/index.ts";
import { BPF_UPGRADEABLE_LOADER } from "../src/trustGraph/rpc.ts";
import type { UpgradeAuthority } from "../src/trustGraph/types.ts";

const SQUADS_V3 = Object.keys(KNOWN_AUTHORITY_OWNERS).find((k) => KNOWN_AUTHORITY_OWNERS[k].kind === "multisig")!;
const GOVERNANCE = Object.keys(KNOWN_AUTHORITY_OWNERS).find((k) => KNOWN_AUTHORITY_OWNERS[k].kind === "dao")!;

// Mock fetch: map address → account `value` (or null for not-found).
function mockFetch(map: Record<string, any>) {
  return (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    if (body.method === "getAccountInfo") {
      const addr = body.params[0];
      const value = map[addr] ?? null;
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: { value } }) } as any;
    }
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, error: { message: "unexpected method" } }) } as any;
  }) as any;
}

function acct(owner: string) {
  return { owner, data: ["", "base64"], executable: false, lamports: 1 };
}

const AUTH = "9YBjtad6ZxR7hxNXyTjRRPnPipFbuAU6c2EVHTSVTQAW";

describe("classifyUpgradeAuthority", () => {
  it("System-Program-owned authority → single-key", async () => {
    const c = await classifyUpgradeAuthority(AUTH, { fetchImpl: mockFetch({ [AUTH]: acct(SYSTEM_PROGRAM) }) });
    expect(c.kind).toBe("single-key");
    expect(c.ownerProgram).toBe(SYSTEM_PROGRAM);
  });

  it("Squads-owned authority → multisig", async () => {
    const c = await classifyUpgradeAuthority(AUTH, { fetchImpl: mockFetch({ [AUTH]: acct(SQUADS_V3) }) });
    expect(c.kind).toBe("multisig");
    expect(c.ownerProgram).toBe(SQUADS_V3);
    expect(c.ownerLabel).toMatch(/Squads/);
  });

  it("SPL-Governance-owned authority → dao", async () => {
    const c = await classifyUpgradeAuthority(AUTH, { fetchImpl: mockFetch({ [AUTH]: acct(GOVERNANCE) }) });
    expect(c.kind).toBe("dao");
    expect(c.ownerProgram).toBe(GOVERNANCE);
  });

  it("unknown owner program → unknown (records the owner, never a false single-key)", async () => {
    const weird = "9xQeWvG816bUx9EPjHmaT23YvVM2ZWbrrpZb9PusVFin";
    const c = await classifyUpgradeAuthority(AUTH, { fetchImpl: mockFetch({ [AUTH]: acct(weird) }) });
    expect(c.kind).toBe("unknown");
    expect(c.ownerProgram).toBe(weird);
  });

  it("no account at the authority address → unknown, no owner", async () => {
    const c = await classifyUpgradeAuthority(AUTH, { fetchImpl: mockFetch({}) });
    expect(c.kind).toBe("unknown");
    expect(c.ownerProgram).toBeUndefined();
  });
});

describe("enrichAuthorityClassification", () => {
  it("classifies an unknown+address authority", async () => {
    const base: UpgradeAuthority = { kind: "unknown", address: AUTH, source: "rpc" };
    const out = await enrichAuthorityClassification(base, { fetchImpl: mockFetch({ [AUTH]: acct(SYSTEM_PROGRAM) }) });
    expect(out.kind).toBe("single-key");
    expect(out.ownerProgram).toBe(SYSTEM_PROGRAM);
  });

  it("passes through a renounced authority without an RPC call", async () => {
    const base: UpgradeAuthority = { kind: "renounced", address: null, source: "rpc" };
    const fetchImpl = (async () => { throw new Error("should not fetch"); }) as any;
    const out = await enrichAuthorityClassification(base, { fetchImpl });
    expect(out.kind).toBe("renounced");
  });

  it("passes through an already-classified authority", async () => {
    const base: UpgradeAuthority = { kind: "multisig", address: AUTH, source: "directory" };
    const fetchImpl = (async () => { throw new Error("should not fetch"); }) as any;
    const out = await enrichAuthorityClassification(base, { fetchImpl });
    expect(out.kind).toBe("multisig");
  });
});

describe("buildTrustGraph — live authority classification", () => {
  // tag(4,le)=2 + 32-byte programdata pubkey
  function programAccount(programDataAddr: string) {
    const data = Buffer.concat([Buffer.from([2, 0, 0, 0]), Buffer.from(base58Decode(programDataAddr))]);
    return { owner: BPF_UPGRADEABLE_LOADER, data: [data.toString("base64"), "base64"], executable: true, lamports: 1 };
  }
  // tag(4)=3 + slot(8) + Option(1)=Some + 32-byte authority
  function programDataAccount(authority: string) {
    const data = Buffer.concat([
      Buffer.from([3, 0, 0, 0]),
      Buffer.from(new Uint8Array(8)),
      Buffer.from([1]),
      Buffer.from(base58Decode(authority)),
    ]);
    return { owner: BPF_UPGRADEABLE_LOADER, data: [data.toString("base64"), "base64"], executable: false, lamports: 1 };
  }

  const FAKE = "9xQeWvG816bUx9EPjHmaT23YvVM2ZWbrrpZb9PusVFin";
  const FAKE_PD = "GQTzxR4yvkbXJVnD9Vg82F7P5y4FvFK5cKjvgaSUzc24";

  it("probes, resolves the authority, then classifies it as multisig", async () => {
    const fetchImpl = mockFetch({
      [FAKE]: programAccount(FAKE_PD),
      [FAKE_PD]: programDataAccount(AUTH),
      [AUTH]: acct(SQUADS_V3),
    });
    const g = await buildTrustGraph([FAKE], { fetchImpl, cachePath: null });
    expect(g.programs).toHaveLength(1);
    const a = g.programs[0].upgradeAuthority;
    expect(a.address).toBe(AUTH);
    expect(a.kind).toBe("multisig");
    expect(a.ownerProgram).toBe(SQUADS_V3);

    // renderer surfaces the multisig verdict + trust summary line
    const md = renderTrustGraphMd(g);
    expect(md).toContain("Multisig");
    expect(md).toContain("**Trust:**");
  });

  it("classifyAuthority:false leaves the authority unclassified", async () => {
    const fetchImpl = mockFetch({
      [FAKE]: programAccount(FAKE_PD),
      [FAKE_PD]: programDataAccount(AUTH),
      [AUTH]: acct(SQUADS_V3),
    });
    const g = await buildTrustGraph([FAKE], { fetchImpl, cachePath: null, classifyAuthority: false });
    expect(g.programs[0].upgradeAuthority.kind).toBe("unknown");
  });
});
