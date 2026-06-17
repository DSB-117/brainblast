import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyTokenIdentity } from "../src/tokenRegistry.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const FAKE = "5tMiJDhWrZ9eUcLagXWctTHk88BUiVQpsbZb6Yr8spUp";

function mockJup(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response);
}

describe("verifyTokenIdentity", () => {
  afterEach(() => vi.restoreAllMocks());

  it("recognises a canonical mint offline, no network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await verifyTokenIdentity(USDC, { offline: true });
    expect(r.status).toBe("verified-canonical");
    expect(r.symbol).toBe("USDC");
    expect(r.impersonation).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("flags expectMismatch when a canonical mint is not the expected symbol", async () => {
    const r = await verifyTokenIdentity(USDT, { expectSymbol: "USDC", offline: true });
    expect(r.status).toBe("verified-canonical");
    expect(r.symbol).toBe("USDT");
    expect(r.expectMismatch).toBe(true);
    expect(r.impersonation).toBe(false);
  });

  it("detects impersonation when on-chain claimed symbol collides at the wrong mint", async () => {
    const r = await verifyTokenIdentity(FAKE, { claimedSymbol: "USDC", offline: true });
    expect(r.impersonation).toBe(true);
    expect(r.canonicalMint).toBe(USDC);
  });

  it("does NOT call --expect an impersonation (expectation is not a claim)", async () => {
    const r = await verifyTokenIdentity(FAKE, { expectSymbol: "USDC", offline: true });
    expect(r.impersonation).toBe(false);
    expect(r.status).toBe("unknown");
    expect(r.expectMismatch).toBe(true);
  });

  it("returns verified when Jupiter lists the mint with the verified tag", async () => {
    mockJup({ address: FAKE, symbol: "FOO", name: "Foo", tags: ["verified"] });
    const r = await verifyTokenIdentity(FAKE);
    expect(r.status).toBe("verified");
    expect(r.source).toBe("jupiter");
    expect(r.symbol).toBe("FOO");
    expect(r.impersonation).toBe(false);
  });

  it("returns unverified when Jupiter knows the mint but it is not verified", async () => {
    mockJup({ address: FAKE, symbol: "FOO", tags: [] });
    const r = await verifyTokenIdentity(FAKE);
    expect(r.status).toBe("unverified");
  });

  it("flags impersonation when Jupiter reports a blue-chip symbol at the wrong mint", async () => {
    mockJup({ address: FAKE, symbol: "USDC", tags: [] });
    const r = await verifyTokenIdentity(FAKE);
    expect(r.impersonation).toBe(true);
    expect(r.canonicalMint).toBe(USDC);
  });

  it("returns unknown on a 404 and never throws", async () => {
    mockJup(null, 404);
    const r = await verifyTokenIdentity(FAKE);
    expect(r.status).toBe("unknown");
    expect(r.source).toBe("none");
  });

  it("degrades to unknown when the network throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const r = await verifyTokenIdentity(FAKE);
    expect(r.status).toBe("unknown");
  });
});
