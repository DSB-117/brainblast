import { describe, it, expect } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestContribution } from "../src/contrib/ingest.ts";
import { loadPack, validatePackManifest } from "../src/packs.ts";
import type { Rule } from "../src/types.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const PACK = "metaplex-nft-royalty-zero";
const packDir = join(repoRoot, "packs", PACK);
const fixtures = join(packDir, "fixtures", PACK);

function rule(): Rule {
  const r = loadPack(packDir).rules.find((x) => x.id === PACK);
  if (!r) throw new Error("test fixture rule missing");
  return r;
}

describe("contributor ingest gate", () => {
  it("ACCEPTS a clean, reproducing submission and stamps a contributor-licensed VTI", async () => {
    const res = await ingestContribution(
      { submissionDir: fixtures, rule: rule(), consentScope: "opt-in:train+eval", now: "2026-06-23T00:00:00.000Z" },
    );
    expect(res.accepted).toBe(true);
    expect(res.proof).toEqual({ red: true, green: true });
    expect(res.secretsFound).toHaveLength(0);
    expect(res.vti?.license).toBe("contributor-grant-v1");
    expect(res.vti?.consentScope).toBe("opt-in:train+eval");
    expect((res.vti as any)?.provenance.generator).toBe("ingest-vti@0.2.0");
    // v0.9.2 — prover-backed intake records schema 1.1 and the TRUE proof method
    // (this metaplex trap is static-provable, so static-checker).
    expect(res.vti?.schemaVersion).toBe("1.1");
    expect((res.vti as any)?.redGreenProof.method).toBe("static-checker");
    expect(res.method).toBe("static-checker");
    // never mixed into the owned corpus
    expect(res.vti?.license).not.toBe("synthetic-owned");
  });

  it("REFUSES a submission that contains a Solana keypair (never ingest a secret)", async () => {
    const sub = mkdtempSync(join(tmpdir(), "bb-contrib-secret-"));
    cpSync(fixtures, sub, { recursive: true });
    // plant a keypair file in vulnerable/
    const keypair = JSON.stringify(Array.from({ length: 64 }, (_, i) => i % 256));
    writeFileSync(join(sub, "vulnerable", "id.json"), keypair);

    const res = await ingestContribution({ submissionDir: sub, rule: rule(), consentScope: "opt-in:train+eval" });
    expect(res.accepted).toBe(false);
    expect(res.secretsFound.length).toBeGreaterThan(0);
    expect(res.secretsFound[0].kind).toBe("solana-keypair-64");
    expect(res.vti).toBeUndefined();
    expect(res.reasons.join(" ")).toMatch(/refusing to ingest/i);
  });

  it("REJECTS a non-reproducing submission (fixed code placed as the vulnerable side)", async () => {
    const sub = mkdtempSync(join(tmpdir(), "bb-contrib-repro-"));
    mkdirSync(join(sub, "vulnerable"), { recursive: true });
    mkdirSync(join(sub, "fixed"), { recursive: true });
    const fixedSrc = readFileSync(join(fixtures, "fixed", "mint.ts"), "utf8");
    // both sides are the FIXED code → the trap is never tripped → RED not reproduced
    writeFileSync(join(sub, "vulnerable", "mint.ts"), fixedSrc);
    writeFileSync(join(sub, "fixed", "mint.ts"), fixedSrc);

    const res = await ingestContribution({ submissionDir: sub, rule: rule(), consentScope: "opt-in:train+eval" });
    expect(res.accepted).toBe(false);
    expect(res.proof.red).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/RED not reproduced/);
    expect(res.vti).toBeUndefined();
  });
});

describe("pack id hardening (CSO #A1 — path-traversal defense)", () => {
  it("rejects an id with path separators", () => {
    expect(() => validatePackManifest({ id: "../../etc/evil", name: "x", version: "1", author: "y" }, "m.yaml"))
      .toThrow(/unsafe id/);
  });
  it("accepts a normal kebab-case id", () => {
    expect(() => validatePackManifest({ id: "my-pack-1", name: "x", version: "1", author: "y" }, "m.yaml"))
      .not.toThrow();
  });
});
