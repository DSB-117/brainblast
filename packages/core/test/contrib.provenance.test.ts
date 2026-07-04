import { describe, it, expect } from "vitest";
import { resolveSourceRef, verifyProvenance } from "../src/contrib/provenance.ts";
import type { Finding } from "../src/synth/types.ts";

// Minimal finding whose trap targets the `skipPreflight` property, with a
// provenance citation. Only the fields verifyProvenance reads need to be real.
function finding(sourceRef: string, evidence: string): Finding {
  return {
    id: "solana-x-skippreflight",
    severity: "high",
    title: "skipPreflight disables simulation",
    component: { name: "@solana/web3.js", type: "Blockchain" },
    detect: { modules: ["@solana/web3.js"], nameRegex: "send", triggerCalls: ["sendRawTransaction"] },
    binding: {
      check: { kind: "object-arg-property-forbidden-literal", params: { call: "sendRawTransaction", argIndex: 1, propName: "skipPreflight", forbiddenValue: true } },
      test: { kind: "none" },
    },
    fixtures: { filename: "x.ts", vulnerable: "", fixed: "" },
    provenance: { sourceRef, evidence },
  } as Finding;
}

// A fetch stub that serves a fixed body for one URL and 404s everything else.
function fetchServing(url: string, body: string): typeof fetch {
  return (async (input: any) => {
    const u = String(input);
    if (u === url) return { ok: true, status: 200, text: async () => body } as Response;
    return { ok: false, status: 404, text: async () => "not found" } as Response;
  }) as unknown as typeof fetch;
}

describe("resolveSourceRef — must be commit-pinned", () => {
  it("accepts owner/repo@sha:path shorthand", () => {
    const r = resolveSourceRef("ask-the-hive/the-hive@d35c326d1520ce88d6879a22e9c9aef3366375c9:hooks/x.ts");
    expect(r.ref?.rawUrl).toBe("https://raw.githubusercontent.com/ask-the-hive/the-hive/d35c326d1520ce88d6879a22e9c9aef3366375c9/hooks/x.ts");
  });

  it("accepts a github blob URL pinned to a SHA", () => {
    const r = resolveSourceRef("https://github.com/o/r/blob/abc1234def/src/a.ts");
    expect(r.ref?.rawUrl).toBe("https://raw.githubusercontent.com/o/r/abc1234def/src/a.ts");
  });

  it("REJECTS a mutable branch ref (can be rewritten later)", () => {
    expect(resolveSourceRef("https://github.com/o/r/blob/main/src/a.ts").ref).toBeUndefined();
    expect(resolveSourceRef("o/r@main:src/a.ts").ref).toBeUndefined();
  });

  it("REJECTS a non-GitHub or empty ref", () => {
    expect(resolveSourceRef("https://example.com/a.ts").ref).toBeUndefined();
    expect(resolveSourceRef("").reason).toBeTruthy();
  });
});

describe("verifyProvenance — the anti-fabrication gate", () => {
  const RAW = "https://raw.githubusercontent.com/o/r/abc1234/src/send.ts";
  const REF = "o/r@abc1234:src/send.ts";

  it("ACCEPTS when the cited commit really contains the vulnerable line", async () => {
    const source = "export function send(c){ return c.sendRawTransaction(tx, { skipPreflight: true }); }";
    const r = await verifyProvenance(finding(REF, "skipPreflight: true"), { fetchImpl: fetchServing(RAW, source) });
    expect(r.ok).toBe(true);
    expect(r.resolvedUrl).toBe(RAW);
  });

  it("REJECTS a fabricated finding — evidence absent from the cited source", async () => {
    const realButDifferent = "export function send(c){ return c.sendRawTransaction(tx, { skipPreflight: false }); }";
    const r = await verifyProvenance(finding(REF, "skipPreflight: true"), { fetchImpl: fetchServing(RAW, realButDifferent) });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/fabrication check failed|not found in the cited source/i);
  });

  it("REJECTS when the evidence doesn't mention the trap's own property", async () => {
    const source = "const unrelated = 1;";
    const r = await verifyProvenance(finding(REF, "const unrelated = 1"), { fetchImpl: fetchServing(RAW, source) });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/must contain the trap's target/i);
  });

  it("REJECTS when the cited commit 404s", async () => {
    const r = await verifyProvenance(finding(REF, "skipPreflight: true"), { fetchImpl: fetchServing("https://other", "x") });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/not found/i);
  });

  it("REJECTS when evidence is missing entirely", async () => {
    const r = await verifyProvenance(finding(REF, ""), { fetchImpl: fetchServing(RAW, "whatever") });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/evidence is required/i);
  });

  it("tolerates whitespace/indent differences between evidence and source", async () => {
    const source = "  return c.sendRawTransaction(tx, {\n    skipPreflight:   true,\n  });";
    const r = await verifyProvenance(finding(REF, "skipPreflight: true"), { fetchImpl: fetchServing(RAW, source) });
    expect(r.ok).toBe(true);
  });
});
