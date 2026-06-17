import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyTokenIdentity } from "../src/tokenRegistry.ts";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const FAKE_MINT = "Fake1111111111111111111111111111111111111111";
const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    })
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyTokenIdentity", () => {
  it("returns verified-canonical for canonical mints (no network)", async () => {
    const id = await verifyTokenIdentity(USDC_MINT, { offline: true });
    expect(id.status).toBe("verified-canonical");
    expect(id.symbol).toBe("USDC");
    expect(id.source).toBe("bundled");
    expect(id.impersonation).toBe(false);
  });

  it("sets expectMismatch when --expect symbol doesn't match canonical", async () => {
    const id = await verifyTokenIdentity(USDC_MINT, { expectSymbol: "USDT", offline: true });
    expect(id.status).toBe("verified-canonical");
    expect(id.expectMismatch).toBe(true);
  });

  it("detects impersonation via claimedSymbol on unknown mint (offline)", async () => {
    const id = await verifyTokenIdentity(FAKE_MINT, { claimedSymbol: "USDC", offline: true });
    expect(id.impersonation).toBe(true);
    expect(id.canonicalMint).toBe(USDC_MINT);
  });

  it("does NOT flag impersonation from --expect alone", async () => {
    const id = await verifyTokenIdentity(FAKE_MINT, { expectSymbol: "USDC", offline: true });
    expect(id.impersonation).toBe(false);
  });

  it("uses Jupiter for non-canonical mints", async () => {
    mockFetch(200, { symbol: "PEPE", name: "Pepe Coin", address: FAKE_MINT });
    const id = await verifyTokenIdentity(FAKE_MINT);
    expect(id.status).toBe("verified");
    expect(id.source).toBe("jupiter");
    expect(id.symbol).toBe("PEPE");
  });

  it("returns unverified when Jupiter symbol is a known canonical impersonator", async () => {
    mockFetch(200, { symbol: "USDC", name: "Fake USDC", address: FAKE_MINT });
    const id = await verifyTokenIdentity(FAKE_MINT);
    expect(id.impersonation).toBe(true);
    expect(id.canonicalMint).toBe(USDC_MINT);
  });

  it("returns unknown on 404 from Jupiter", async () => {
    mockFetch(404, {});
    const id = await verifyTokenIdentity(FAKE_MINT);
    expect(id.status).toBe("unknown");
    expect(id.impersonation).toBe(false);
  });

  it("returns unknown on network error from Jupiter", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const id = await verifyTokenIdentity(FAKE_MINT);
    expect(id.status).toBe("unknown");
  });

  it("USDT canonical mint is recognized without network", async () => {
    const id = await verifyTokenIdentity(USDT_MINT, { offline: true });
    expect(id.status).toBe("verified-canonical");
    expect(id.symbol).toBe("USDT");
  });

  it("JUP canonical mint is recognized without network", async () => {
    const id = await verifyTokenIdentity(JUP_MINT, { offline: true });
    expect(id.status).toBe("verified-canonical");
    expect(id.symbol).toBe("JUP");
  });
});
