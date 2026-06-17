import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseMintAccount, pumpPreflight } from "../src/pumpCheck.ts";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Build an 82-byte SPL mint account buffer.
function mintBuffer(o: { mintRevoked: boolean; freezeRevoked: boolean; decimals?: number }): Uint8Array {
  const d = new Uint8Array(82);
  if (!o.mintRevoked) {
    d[0] = 1; // mintAuthorityOption = present
    d.fill(0x11, 4, 36);
  }
  // supply (u64 LE) = 1_000_000
  let supply = 1_000_000n;
  for (let i = 36; i < 44; i++) {
    d[i] = Number(supply & 0xffn);
    supply >>= 8n;
  }
  d[44] = o.decimals ?? 6;
  d[45] = 1; // isInitialized
  if (!o.freezeRevoked) {
    d[46] = 1; // freezeAuthorityOption = present
    d.fill(0x22, 50, 82);
  }
  return d;
}

function accountInfoFetch(buf: Uint8Array) {
  const b64 = Buffer.from(buf).toString("base64");
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        jsonrpc: "2.0",
        id: 1,
        result: { value: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: [b64, "base64"], executable: false, lamports: 1000 } },
      }),
  }) as unknown as typeof fetch;
}

describe("parseMintAccount", () => {
  it("parses a fully-revoked mint", () => {
    const info = parseMintAccount(mintBuffer({ mintRevoked: true, freezeRevoked: true }));
    expect(info.mintAuthorityRevoked).toBe(true);
    expect(info.freezeAuthorityRevoked).toBe(true);
    expect(info.mintAuthority).toBeNull();
    expect(info.decimals).toBe(6);
    expect(info.supply).toBe("1000000");
  });

  it("parses a mint with a live mint authority", () => {
    const info = parseMintAccount(mintBuffer({ mintRevoked: false, freezeRevoked: true }));
    expect(info.mintAuthorityRevoked).toBe(false);
    expect(info.mintAuthority).not.toBeNull();
  });

  it("throws on a too-short buffer", () => {
    expect(() => parseMintAccount(new Uint8Array(10))).toThrow(/mint account/);
  });
});

describe("pumpPreflight (offline on-chain checks)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns GO for a revoked mint with clean identity", async () => {
    const fetchImpl = accountInfoFetch(mintBuffer({ mintRevoked: true, freezeRevoked: true }));
    const report = await pumpPreflight(MINT, { offline: true, fetchImpl });
    expect(report.mintInfo?.mintAuthorityRevoked).toBe(true);
    const mintCheck = report.checks.find((c) => c.id === "mint-authority-revoked");
    expect(mintCheck?.status).toBe("pass");
    expect(report.verdict).toBe("GO");
  });

  it("returns NO-GO when the mint authority is live", async () => {
    const fetchImpl = accountInfoFetch(mintBuffer({ mintRevoked: false, freezeRevoked: true }));
    const report = await pumpPreflight(MINT, { offline: true, fetchImpl });
    const mintCheck = report.checks.find((c) => c.id === "mint-authority-revoked");
    expect(mintCheck?.status).toBe("fail");
    expect(report.verdict).toBe("NO-GO");
  });

  it("returns CAUTION when only the freeze authority is live", async () => {
    const fetchImpl = accountInfoFetch(mintBuffer({ mintRevoked: true, freezeRevoked: false }));
    const report = await pumpPreflight(MINT, { offline: true, fetchImpl });
    const freeze = report.checks.find((c) => c.id === "freeze-authority-revoked");
    expect(freeze?.status).toBe("warn");
    expect(report.verdict).toBe("CAUTION");
  });
});

describe("pumpPreflight (with Rico forensics)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("folds in a high Rico risk score as NO-GO", async () => {
    const buf = mintBuffer({ mintRevoked: true, freezeRevoked: true });
    const b64 = Buffer.from(buf).toString("base64");
    const fetchImpl = vi.fn().mockImplementation((url: string, init?: any) => {
      const body = init?.body ?? "";
      if (typeof body === "string" && body.includes("getAccountInfo")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ result: { value: { owner: "Tok", data: [b64, "base64"], executable: false, lamports: 1 } } }),
        });
      }
      // Rico analyze
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            summary: { totalHolders: 500, cabalCount: 3, riskScore: 88, snipersDetected: true, bundleClustersDetected: true, sniperCount: 50 },
            tokenSecurity: { hasMintAuthority: false, hasFreezeAuthority: false, isMutable: false },
            tokenMetadata: { symbol: "TEST", name: "Test" },
          }),
      });
    });
    vi.stubGlobal("fetch", fetchImpl);

    const report = await pumpPreflight(MINT, { ricoBaseUrl: "http://rico.test", jupBaseUrl: "http://jup.test", offline: false });
    const risk = report.checks.find((c) => c.id === "risk-score");
    expect(risk?.status).toBe("fail");
    expect(report.verdict).toBe("NO-GO");
    expect(report.quality?.riskScore).toBe(88);
  });

  it("marks Rico skipped on auth failure without failing the run", async () => {
    const buf = mintBuffer({ mintRevoked: true, freezeRevoked: true });
    const b64 = Buffer.from(buf).toString("base64");
    const fetchImpl = vi.fn().mockImplementation((url: string, init?: any) => {
      const body = init?.body ?? "";
      if (typeof body === "string" && body.includes("getAccountInfo")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ result: { value: { owner: "Tok", data: [b64, "base64"], executable: false, lamports: 1 } } }) });
      }
      if (url.includes("jup")) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}), text: () => Promise.resolve("unauthorized") });
    });
    vi.stubGlobal("fetch", fetchImpl);

    const report = await pumpPreflight(MINT, { ricoBaseUrl: "http://rico.test", jupBaseUrl: "http://jup.test" });
    const rico = report.checks.find((c) => c.id === "rico-scan");
    expect(rico?.status).toBe("skip");
    // Revoked mint + skipped rico → GO (skip is not a warn/fail)
    expect(report.verdict).toBe("GO");
  });
});
