import { describe, it, expect } from "vitest";
import { toCleanroom, validateCleanroom, parseSourceRef, sha256 } from "../src/marketplace/cleanroom.ts";
import { bucketOf, commercialSafe } from "../src/marketplace/upstreamLicense.ts";

const SHA = "a".repeat(40);

const OWNED = {
  schemaVersion: "1.1", trapId: "amqplib-x", title: "amqplib reject false",
  sdk: { name: "amqplib", version: ">=0.8.0", type: "Networking" }, severity: "high", class: "missing-verification",
  vulnerable: { lang: "typescript", snippet: "amqp.connect(url, { rejectUnauthorized: false })", detail: "MITM" },
  fixed: { lang: "typescript", snippet: "amqp.connect(url, { rejectUnauthorized: true })", detail: "ok" },
  generatedTest: null,
  redGreenProof: { red: true, green: true, method: "static-checker", checkKind: "object-arg-property-forbidden-literal" },
  provenance: { sourceUrls: ["https://amqp-node.github.io/"] },
  corroborationCount: 0, license: "synthetic-owned", consentScope: "owned",
};

const WILD = {
  trapId: "rhchain-x", title: "amountOutMinimum zero",
  sdk: { name: "viem", type: "EVM" }, severity: "high", class: "missing-slippage-guard",
  vulnerable: { lang: "typescript", snippet: "router.exactInputSingle({ amountOutMinimum: 0 })" },
  fixed: { lang: "typescript", snippet: "router.exactInputSingle({ amountOutMinimum: 1 })" },
  redGreenProof: { red: true, green: true, method: "static-checker", checkKind: "object-arg-property-forbidden-literal" },
  provenance: { sourceRef: `owner/repo@${SHA}:src/x.ts#L42`, evidence: "  amountOutMinimum: 0, // accept any", sourceUrl: `https://github.com/owner/repo/blob/${SHA}/src/x.ts#L42` },
  corroborationCount: 2, consentScope: "opt-in:train+eval",
};

describe("toCleanroom", () => {
  it("owned record → synthetic-owned, keeps doc urls, no evidence", () => {
    const { record } = toCleanroom(OWNED);
    expect(record!.provenance.class).toBe("synthetic-owned");
    expect(record!.provenance.docUrls).toEqual(["https://amqp-node.github.io/"]);
    expect((record!.provenance as any).evidence).toBeUndefined();
    expect(record!.vulnerable.code).toContain("rejectUnauthorized: false");
    expect(record!.rights.artifactLicense).toBe("brainblast-training-1.0");
  });

  it("wild record → provenance by reference (pointer + hash), NO verbatim evidence", () => {
    const { record } = toCleanroom(WILD);
    expect(record!.provenance.class).toBe("wild");
    expect((record!.provenance as any).evidence).toBeUndefined();
    expect(record!.provenance.evidenceSha256).toBe(sha256("  amountOutMinimum: 0, // accept any"));
    expect(record!.provenance.evidenceLen).toBe("  amountOutMinimum: 0, // accept any".length);
    expect(record!.provenance.sourceRef).toContain(`@${SHA}:src/x.ts#L42`);
    // the sold JSON never contains an `evidence` field
    expect(JSON.stringify(record)).not.toContain('"evidence"');
  });

  it("rejects a wild record whose sourceRef is not commit-pinned", () => {
    const bad = { ...WILD, provenance: { sourceRef: "owner/repo@main:src/x.ts", evidence: "x" } };
    expect(toCleanroom(bad).error).toMatch(/pin a 40-hex commit SHA/);
  });
});

describe("parseSourceRef", () => {
  it("parses owner/repo@sha:path#L", () => {
    const p = parseSourceRef(`o/r@${SHA}:a/b.ts#L9`);
    expect("sha" in p && p.sha).toBe(SHA);
    expect("rawUrl" in p && p.rawUrl).toContain(`raw.githubusercontent.com/o/r/${SHA}/a/b.ts`);
  });
  it("rejects a branch ref", () => {
    expect("error" in parseSourceRef("o/r@main:a.ts")).toBe(true);
  });
});

describe("validateCleanroom", () => {
  it("passes a clean wild record", () => {
    const { record, strippedEvidence } = toCleanroom(WILD);
    expect(validateCleanroom(record!, strippedEvidence)).toEqual([]);
  });
  it("flags an unproven record", () => {
    const { record } = toCleanroom({ ...WILD, redGreenProof: { red: false, green: true } });
    expect(validateCleanroom(record!).some((i) => i.code === "not-proven")).toBe(true);
  });
  it("flags a leaked evidence field", () => {
    const { record } = toCleanroom(WILD);
    (record as any).provenance.evidence = "  amountOutMinimum: 0, // accept any";
    expect(validateCleanroom(record!).some((i) => i.code === "evidence-leak")).toBe(true);
  });
  it("flags a dead/forged pointer when the fetched line's hash mismatches", () => {
    const { record } = toCleanroom(WILD);
    const issues = validateCleanroom(record!, undefined, { fetchedLine: "  amountOutMinimum: 5, // different" });
    expect(issues.some((i) => i.code === "dead-pointer")).toBe(true);
  });
  it("flags a fixture that embeds a long verbatim span of the upstream line", () => {
    const longLine = "  const x = someVeryLongUpstreamExpressionThatExceedsFortyChars(a, b, c);";
    const rec = { ...WILD, fixed: { lang: "typescript", snippet: `function f(){ ${longLine} }` },
      provenance: { sourceRef: `o/r@${SHA}:a.ts#L1`, evidence: longLine } };
    const { record, strippedEvidence } = toCleanroom(rec);
    expect(validateCleanroom(record!, strippedEvidence).some((i) => i.code === "verbatim-span")).toBe(true);
  });
});

describe("upstream license buckets", () => {
  it("classifies + gates commercial", () => {
    expect(bucketOf("MIT")).toBe("permissive");
    expect(bucketOf("GPL-3.0")).toBe("strong-copyleft");
    expect(bucketOf("AGPL-3.0")).toBe("strong-copyleft");
    expect(commercialSafe(bucketOf("MIT"))).toBe(true);
    expect(commercialSafe(bucketOf("GPL-3.0"))).toBe(false);
    expect(commercialSafe(bucketOf("NOASSERTION"))).toBe(false);
  });
});
