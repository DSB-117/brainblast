import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestSubmission, validateSubmission } from "../src/contrib/submit.ts";
import { JsonlVtiStore } from "../src/contrib/store.ts";
import { route } from "../scripts/registry-server.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
// A committed, static-provable candidate Finding (same shape as a submission).
const CANDIDATE = join(repoRoot, "fleet", "candidates", "jwt-verify-algorithm-none.json");

function finding(): any {
  return JSON.parse(readFileSync(CANDIDATE, "utf8"));
}

describe("validateSubmission (Gate 0 — shape)", () => {
  it("passes a well-formed candidate", () => {
    expect(validateSubmission(finding())).toEqual([]);
  });

  it("rejects a non-object", () => {
    expect(validateSubmission(null).length).toBeGreaterThan(0);
    expect(validateSubmission("nope").length).toBeGreaterThan(0);
  });

  it("rejects an unvetted check.kind before any proving", () => {
    const f = finding();
    f.binding.check.kind = "totally-made-up-checker";
    const reasons = validateSubmission(f);
    expect(reasons.join(" ")).toMatch(/not a vetted checker/);
  });

  it("rejects an unsafe id and missing fixtures", () => {
    const f = finding();
    f.id = "../../etc/passwd";
    delete f.fixtures;
    const reasons = validateSubmission(f);
    expect(reasons.join(" ")).toMatch(/not a safe path segment/);
    expect(reasons.join(" ")).toMatch(/fixtures/);
  });
});

describe("ingestSubmission (git-less intake gate)", () => {
  it("ACCEPTS a reproducing submission and mints a contributor-licensed VTI", async () => {
    const r = await ingestSubmission(finding(), { consentScope: "opt-in:train", now: "2026-07-03T00:00:00.000Z" });
    expect(r.accepted).toBe(true);
    expect(r.status).toBe("accepted");
    expect(r.proof).toEqual({ red: true, green: true });
    expect(r.vti?.license).toBe("contributor-grant-v1");
    expect(r.vti?.consentScope).toBe("opt-in:train");
    expect(r.vti?.trapId).toBe("jwt-verify-algorithm-none");
  });

  it("REJECTS a non-reproducing submission (fixed source on the vulnerable side)", async () => {
    const f = finding();
    f.fixtures.vulnerable = f.fixtures.fixed; // both sides now pass → no RED
    const r = await ingestSubmission(f, {});
    expect(r.accepted).toBe(false);
    expect(r.proof?.red).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/RED not reproduced|did not trip/i);
  });

  it("REJECTS a submission carrying a secret (Keyguard scan)", async () => {
    const f = finding();
    // A base58 ed25519 secret key (decodes to 64 bytes) planted as an env-style
    // assignment the Keyguard classifier flags — the gate runs before the proof.
    const b58 = "4XR92Zct9ZodXzisJ4kov3upmTvMotYVrg65MHP8aoCjSPJwUa7vjaXK5VhDF7ZiiF16v7cY5BPazCLnVqZ3yzb";
    f.fixtures.vulnerable = `SOLANA_PRIVATE_KEY=${b58}\n` + f.fixtures.vulnerable;
    const r = await ingestSubmission(f, {});
    expect(r.accepted).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/refusing to ingest|secret/i);
    expect((r.secretsFound ?? []).length).toBeGreaterThan(0);
  });

  it("does not throw on hostile input — returns a rejection", async () => {
    const r = await ingestSubmission({ id: 42, junk: true }, {});
    expect(r.accepted).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});

describe("JsonlVtiStore (the DB seam)", () => {
  it("inserts once, is idempotent, and is non-destructive", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "bb-store-")), "vti.jsonl");
    const store = new JsonlVtiStore(path);
    expect((await store.insert({ trapId: "a", title: "first" })).inserted).toBe(true);
    expect((await store.insert({ trapId: "a", title: "retry" })).inserted).toBe(false); // idempotent
    expect((await store.insert({ trapId: "b" })).inserted).toBe(true);
    expect((await store.list()).map((r) => r.trapId).sort()).toEqual(["a", "b"]);
    expect(((await store.list()).find((r) => r.trapId === "a") as any).title).toBe("first"); // non-destructive
    expect((await store.insert({} as any)).inserted).toBe(false); // no trapId
  });
});

describe("route (POST/GET /api/vti)", () => {
  function freshStore() {
    return new JsonlVtiStore(join(mkdtempSync(join(tmpdir(), "bb-route-")), "vti.jsonl"));
  }

  it("POST lands a reproducing finding (201), duplicate is idempotent (200)", async () => {
    const store = freshStore();
    const first = await route("POST", "/api/vti", { finding: finding() }, store);
    expect(first.status).toBe(201);
    expect(first.body.accepted).toBe(true);
    const again = await route("POST", "/api/vti", { finding: finding() }, store);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
  });

  it("POST rejects a non-reproducing finding with 422 + reasons", async () => {
    const store = freshStore();
    const f = finding();
    f.fixtures.vulnerable = f.fixtures.fixed;
    const res = await route("POST", "/api/vti", { finding: f }, store);
    expect(res.status).toBe(422);
    expect((res.body.reasons as string[]).length).toBeGreaterThan(0);
    expect(await store.list()).toHaveLength(0);
  });

  it("GET returns sample-tier teasers without fixtures", async () => {
    const store = freshStore();
    await route("POST", "/api/vti", { finding: finding() }, store);
    const res = await route("GET", "/api/vti", undefined, store);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    const rec = (res.body.records as any[])[0];
    expect(rec.trapId).toBe("jwt-verify-algorithm-none");
    expect(rec.redGreenProof).toBeTruthy();
    expect(rec.vulnerable).toBeUndefined(); // teaser never ships trainable fixtures
    expect(rec.fixed).toBeUndefined();
  });

  it("POST is blocked when the transport reports an invalid token", async () => {
    const store = freshStore();
    const res = await route("POST", "/api/vti", { finding: finding() }, store, { authorized: false });
    expect(res.status).toBe(401);
    expect(await store.list()).toHaveLength(0);
  });

  it("with provenance ON: lands a finding whose cited commit really contains the trap", async () => {
    const store = freshStore();
    const f = finding();
    // Cite an immutable commit; the vulnerable line is `algorithms: ['none']`.
    f.provenance = { sourceRef: "o/r@abc1234:auth.ts", evidence: "algorithms: ['none']" };
    const src = "export function verify(t){ return jwt.verify(t, k, { algorithms: ['none'] }); }";
    const fetchImpl = (async (u: any) =>
      String(u) === "https://raw.githubusercontent.com/o/r/abc1234/auth.ts"
        ? ({ ok: true, status: 200, text: async () => src } as Response)
        : ({ ok: false, status: 404, text: async () => "nf" } as Response)) as unknown as typeof fetch;
    const res = await route("POST", "/api/vti", { finding: f }, store, { verifyProvenance: true, fetchImpl });
    expect(res.status).toBe(201);
    expect(res.body.accepted).toBe(true);
    expect(await store.has("jwt-verify-algorithm-none")).toBe(true);
  });

  it("with provenance ON: rejects a fabricated finding (evidence absent from the cited commit)", async () => {
    const store = freshStore();
    const f = finding();
    f.provenance = { sourceRef: "o/r@abc1234:auth.ts", evidence: "algorithms: ['none']" };
    const realButSafe = "export function verify(t){ return jwt.verify(t, k, { algorithms: ['RS256'] }); }";
    const fetchImpl = (async () => ({ ok: true, status: 200, text: async () => realButSafe } as Response)) as unknown as typeof fetch;
    const res = await route("POST", "/api/vti", { finding: f }, store, { verifyProvenance: true, fetchImpl });
    expect(res.status).toBe(422);
    expect((res.body.reasons as string[]).join(" ")).toMatch(/fabrication|not found in the cited source/i);
    expect(await store.list()).toHaveLength(0);
  });
});
