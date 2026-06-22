import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditReport, finalizeReport } from "../src/keys/scan.ts";
import { rescue } from "../src/keys/rescue.ts";
import { backupFile } from "../src/keys/vault.ts";
import type { DetectedSecret } from "../src/keys/types.ts";

const KEYPAIR = JSON.stringify(Array.from({ length: 64 }, (_, i) => i));

function sec(rel: string, over: Partial<DetectedSecret> = {}): DetectedSecret {
  return {
    kind: "solana-keypair-64",
    confidence: "high",
    reason: "keypair",
    path: `/abs/${rel}`,
    rel,
    tier: "funds",
    needsOnchainCheck: false,
    inGitRepo: true,
    external: false,
    ...over,
  };
}

describe("audit (Capability 4)", () => {
  it("FAILS when a high-tier secret is unbacked", () => {
    const r = finalizeReport("/abs", [sec("id.json", { gitIgnored: true, vaulted: false })]);
    const a = auditReport(r);
    expect(a.pass).toBe(false);
    expect(a.checks.find((c) => c.id === "backed-up")!.status).toBe("fail");
  });

  it("FAILS when a secret is committed to git", () => {
    const r = finalizeReport("/abs", [sec("id.json", { gitTracked: true })]);
    const a = auditReport(r);
    expect(a.checks.find((c) => c.id === "not-committed")!.status).toBe("fail");
    expect(a.pass).toBe(false);
  });

  it("PASSES when every high-tier secret is vaulted and gitignored", () => {
    const r = finalizeReport("/abs", [sec("id.json", { vaulted: true, gitIgnored: true, gitTracked: false })]);
    expect(auditReport(r).pass).toBe(true);
  });

  it("advises a multisig when a terminal upgrade-authority key is on disk", () => {
    const r = finalizeReport("/abs", [
      sec("authority.json", { tier: "terminal", vaulted: true, gitIgnored: true, onchain: { upgradeAuthorityOf: ["PROG"] } }),
    ]);
    const a = auditReport(r);
    expect(a.checks.find((c) => c.id === "authority-multisig")!.status).toBe("warn");
  });
});

describe("rescue (Capability 5)", () => {
  let work: string;
  let vdir: string;
  let prevDir: string | undefined;
  let prevPass: string | undefined;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "rescue-work-"));
    vdir = mkdtempSync(join(tmpdir(), "rescue-store-"));
    prevDir = process.env.BRAINBLAST_VAULT_DIR;
    prevPass = process.env.BRAINBLAST_VAULT_PASSPHRASE;
    process.env.BRAINBLAST_VAULT_DIR = vdir;
    process.env.BRAINBLAST_VAULT_PASSPHRASE = "test";
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
    rmSync(vdir, { recursive: true, force: true });
    if (prevDir === undefined) delete process.env.BRAINBLAST_VAULT_DIR;
    else process.env.BRAINBLAST_VAULT_DIR = prevDir;
    if (prevPass === undefined) delete process.env.BRAINBLAST_VAULT_PASSPHRASE;
    else process.env.BRAINBLAST_VAULT_PASSPHRASE = prevPass;
  });

  it("reports a backed-up-but-deleted secret as recoverable", () => {
    const f = join(work, "id.json");
    writeFileSync(f, KEYPAIR);
    backupFile(f, { pubkey: "ABC" });
    rmSync(f);
    const r = rescue(work, { includeHistory: false });
    const item = r.items.find((i) => i.path === f)!;
    expect(item.state).toBe("recoverable-missing");
    expect(r.recoverableMissing).toBe(1);
  });

  it("flags a present high-tier secret that is not backed up as at-risk", () => {
    writeFileSync(join(work, "id.json"), KEYPAIR);
    const r = rescue(work, { includeHistory: false });
    expect(r.unbackedAtRisk).toBe(1);
    expect(r.items.some((i) => i.state === "at-risk-unbacked")).toBe(true);
  });

  it("marks a present, backed-up, unchanged secret as safe", () => {
    const f = join(work, "id.json");
    writeFileSync(f, KEYPAIR);
    backupFile(f);
    const r = rescue(work, { includeHistory: false });
    expect(r.items.find((i) => i.path === f)!.state).toBe("safe");
    expect(r.unbackedAtRisk).toBe(0);
  });
});
