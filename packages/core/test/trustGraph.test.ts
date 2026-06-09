import { describe, it, expect } from "vitest";
import {
  base58Encode,
  base58Decode,
  isValidSolanaAddress,
  buildTrustGraph,
  renderTrustGraphMd,
  loadDirectory,
  probeUpgradeAuthority,
  DEFAULT_RPC,
} from "../src/trustGraph/index.ts";
import {
  BPF_UPGRADEABLE_LOADER,
  BPF_LOADER_2,
} from "../src/trustGraph/rpc.ts";

const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM = "11111111111111111111111111111111";

describe("base58", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 0, 1, 2, 3, 255, 254, 200]);
    expect(Array.from(base58Decode(base58Encode(bytes)))).toEqual(Array.from(bytes));
  });

  it("encodes 32 zero bytes as 32 ones (System Program address)", () => {
    expect(base58Encode(new Uint8Array(32))).toBe(SYSTEM);
    expect(base58Decode(SYSTEM).length).toBe(32);
  });

  it("isValidSolanaAddress accepts known good and rejects junk", () => {
    expect(isValidSolanaAddress(SPL_TOKEN)).toBe(true);
    expect(isValidSolanaAddress(SYSTEM)).toBe(true);
    expect(isValidSolanaAddress("not-a-real-address")).toBe(false);
    expect(isValidSolanaAddress("")).toBe(false);
    expect(isValidSolanaAddress("0OIl")).toBe(false); // invalid base58 chars
  });
});

describe("loadDirectory", () => {
  it("contains the well-known programs the Solana research depends on", () => {
    const dir = loadDirectory();
    expect(dir.has(SPL_TOKEN)).toBe(true);
    expect(dir.has(TOKEN_2022)).toBe(true);
    expect(dir.has(SYSTEM)).toBe(true);
    expect(dir.has("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")).toBe(true);
    expect(dir.get(SPL_TOKEN)!.upgradeAuthority.kind).toBe("renounced");
    expect(dir.get(TOKEN_2022)!.upgradeAuthority.kind).toBe("multisig");
  });
});

describe("probeUpgradeAuthority", () => {
  function mockFetch(map: Record<string, any>) {
    return async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      const addr = body.params[0];
      const result = map[addr];
      if (result === undefined) {
        return {
          ok: true,
          json: async () => ({ jsonrpc: "2.0", id: 1, error: { message: "AccountNotFound" } }),
        } as any;
      }
      return {
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: { value: result } }),
      } as any;
    };
  }

  function programAccount(programDataAddr: string) {
    // tag(4, le)=2 + 32 bytes
    const tag = new Uint8Array([2, 0, 0, 0]);
    const pd = base58Decode(programDataAddr);
    const data = Buffer.concat([Buffer.from(tag), Buffer.from(pd)]);
    return {
      owner: BPF_UPGRADEABLE_LOADER,
      data: [data.toString("base64"), "base64"],
      executable: true,
      lamports: 100000,
    };
  }

  function programDataAccount(authority: string | null) {
    // tag(4)=3, slot(8), Option<Pubkey>(1+32)
    const tag = new Uint8Array([3, 0, 0, 0]);
    const slot = new Uint8Array(8);
    const opt = authority === null ? new Uint8Array([0]) : new Uint8Array([1]);
    const auth = authority === null ? new Uint8Array(32) : base58Decode(authority);
    const data = Buffer.concat([Buffer.from(tag), Buffer.from(slot), Buffer.from(opt), Buffer.from(auth)]);
    return {
      owner: BPF_UPGRADEABLE_LOADER,
      data: [data.toString("base64"), "base64"],
      executable: false,
      lamports: 500000,
    };
  }

  it("classifies a legacy-loader-owned program as renounced", async () => {
    const fetchImpl = mockFetch({
      [SPL_TOKEN]: {
        owner: BPF_LOADER_2,
        data: ["", "base64"],
        executable: true,
        lamports: 1,
      },
    });
    const auth = await probeUpgradeAuthority(SPL_TOKEN, { fetchImpl: fetchImpl as any });
    expect(auth.kind).toBe("renounced");
    expect(auth.address).toBeNull();
    expect(auth.source).toBe("rpc");
  });

  it("resolves the upgrade authority via the ProgramData account", async () => {
    const fakeProgram = "9xQeWvG816bUx9EPjHmaT23YvVM2ZWbrrpZb9PusVFin";
    const fakeProgramData = "GQTzxR4yvkbXJVnD9Vg82F7P5y4FvFK5cKjvgaSUzc24";
    const fakeAuthority = "9YBjtad6ZxR7hxNXyTjRRPnPipFbuAU6c2EVHTSVTQAW";
    const fetchImpl = mockFetch({
      [fakeProgram]: programAccount(fakeProgramData),
      [fakeProgramData]: programDataAccount(fakeAuthority),
    });
    const auth = await probeUpgradeAuthority(fakeProgram, { fetchImpl: fetchImpl as any });
    expect(auth.address).toBe(fakeAuthority);
    expect(auth.kind).toBe("unknown");
    expect(auth.source).toBe("rpc");
  });

  it("reports renounced when ProgramData's Option<Pubkey> is None", async () => {
    const fakeProgram = "9xQeWvG816bUx9EPjHmaT23YvVM2ZWbrrpZb9PusVFin";
    const fakeProgramData = "GQTzxR4yvkbXJVnD9Vg82F7P5y4FvFK5cKjvgaSUzc24";
    const fetchImpl = mockFetch({
      [fakeProgram]: programAccount(fakeProgramData),
      [fakeProgramData]: programDataAccount(null),
    });
    const auth = await probeUpgradeAuthority(fakeProgram, { fetchImpl: fetchImpl as any });
    expect(auth.kind).toBe("renounced");
    expect(auth.address).toBeNull();
  });

  it("uses DEFAULT_RPC when no url is given", () => {
    expect(DEFAULT_RPC).toMatch(/mainnet/);
  });
});

describe("buildTrustGraph", () => {
  it("resolves directory hits without touching the RPC", async () => {
    const calls: string[] = [];
    const fetchImpl = (async () => {
      calls.push("rpc");
      throw new Error("should not be called");
    }) as any;
    const g = await buildTrustGraph([SPL_TOKEN, TOKEN_2022, SYSTEM], { fetchImpl });
    expect(calls).toHaveLength(0);
    expect(g.programs.map((p) => p.name)).toEqual(["SPL Token", "SPL Token-2022", "System Program"]);
    expect(g.unresolved).toEqual([]);
  });

  it("deduplicates inputs while preserving order", async () => {
    const g = await buildTrustGraph([SYSTEM, SPL_TOKEN, SYSTEM], { probeRpc: false });
    expect(g.programs.map((p) => p.programId)).toEqual([SYSTEM, SPL_TOKEN]);
  });

  it("marks unknown programs as unresolved when RPC is disabled", async () => {
    const fake = "9xQeWvG816bUx9EPjHmaT23YvVM2ZWbrrpZb9PusVFin";
    const g = await buildTrustGraph([fake], { probeRpc: false });
    expect(g.programs).toEqual([]);
    expect(g.unresolved).toHaveLength(1);
    expect(g.unresolved[0].reason).toBe("not_in_directory_or_cache_and_rpc_disabled");
  });
});

describe("renderTrustGraphMd", () => {
  it("renders the well-known graph with authority + verified-build sections", async () => {
    const g = await buildTrustGraph([SPL_TOKEN, TOKEN_2022], { probeRpc: false });
    const md = renderTrustGraphMd(g);
    expect(md).toContain("# Trust Graph");
    expect(md).toContain("SPL Token");
    expect(md).toContain("SPL Token-2022");
    expect(md).toContain("Renounced");
    expect(md).toContain("Multisig");
    expect(md).toContain("Verified build");
    expect(md).toContain("OtterSec");
  });
});
