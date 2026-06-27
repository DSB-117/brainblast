import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLots, recallFeed, resolveLotPaths } from "../src/feedLots.ts";

function lotLine(over: Record<string, unknown>): string {
  return JSON.stringify({
    trapId: "t",
    sdk: { name: "@solana/web3.js" },
    severity: "high",
    class: "silent-zero-revenue",
    corroborationCount: 0,
    redGreenProof: { red: true, green: true, method: "static-checker" },
    vulnerable: { snippet: "VULN" },
    fixed: { snippet: "FIXED" },
    provenance: { sourceUrls: ["https://x"] },
    license: "synthetic-owned",
    capturedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });
}

describe("feed lot loading + recall", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lots-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("readLots parses JSONL, skips blanks, and reports malformed lines + missing files", () => {
    const p = join(dir, "a.jsonl");
    writeFileSync(p, [lotLine({ trapId: "ok1" }), "", "  ", "{not json", lotLine({ trapId: "ok2" })].join("\n"));
    const { vtis, errors } = readLots([p, join(dir, "missing.jsonl")]);
    expect(vtis.map((v) => v.trapId)).toEqual(["ok1", "ok2"]);
    expect(errors.some((e) => e.includes("malformed"))).toBe(true);
    expect(errors.some((e) => e.includes("lot not found"))).toBe(true);
  });

  it("resolveLotPaths returns explicit paths when given", () => {
    expect(resolveLotPaths(["x.jsonl", "y.jsonl"])).toEqual(["x.jsonl", "y.jsonl"]);
  });

  it("recallFeed gives full local visibility (receipt + fixtures), filtered", () => {
    const p = join(dir, "lot.jsonl");
    writeFileSync(
      p,
      [
        lotLine({ trapId: "web3", sdk: { name: "@solana/web3.js" } }),
        lotLine({ trapId: "stripe", sdk: { name: "stripe" }, capturedAt: "2026-02-01T00:00:00.000Z" }),
      ].join("\n"),
    );
    const { result, lots } = recallFeed({ lots: [p], sdk: "stripe" });
    expect(lots).toEqual([p]);
    expect(result.records.map((r) => r.trapId)).toEqual(["stripe"]);
    // Recall = firehose entitlement: the trainable payload IS included (you hold the lot).
    expect(result.records[0].fixtures?.vulnerable?.snippet).toBe("VULN");
    expect(result.records[0].fixtures?.fixed?.snippet).toBe("FIXED");
    expect(result.records[0].receipt.green).toBe(true);
  });

  it("recallFeed respects the --since delta cursor", () => {
    const p = join(dir, "lot.jsonl");
    writeFileSync(
      p,
      [
        lotLine({ trapId: "old", capturedAt: "2026-01-01T00:00:00.000Z" }),
        lotLine({ trapId: "new", capturedAt: "2026-03-01T00:00:00.000Z" }),
      ].join("\n"),
    );
    const { result } = recallFeed({ lots: [p], since: "2026-02-01T00:00:00.000Z" });
    expect(result.records.map((r) => r.trapId)).toEqual(["new"]);
    expect(result.cursor).toBe("2026-03-01T00:00:00.000Z");
  });

  it("recallFeed surfaces only proven records", () => {
    const p = join(dir, "lot.jsonl");
    writeFileSync(
      p,
      [
        lotLine({ trapId: "proven" }),
        lotLine({ trapId: "unproven", redGreenProof: { red: true, green: false } }),
      ].join("\n"),
    );
    const { result } = recallFeed({ lots: [p] });
    expect(result.records.map((r) => r.trapId)).toEqual(["proven"]);
  });
});
