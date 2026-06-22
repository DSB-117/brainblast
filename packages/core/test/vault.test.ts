import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backupFile,
  isBackedUp,
  restore,
  trash,
  statusForPath,
  listLatestByPath,
  verifyVault,
  vaultDir,
} from "../src/keys/vault.ts";

const SECRET = JSON.stringify(Array.from({ length: 64 }, (_, i) => i));

describe("Vault", () => {
  let work: string;
  let vdir: string;
  let prevDir: string | undefined;
  let prevPass: string | undefined;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "vault-work-"));
    vdir = mkdtempSync(join(tmpdir(), "vault-store-"));
    prevDir = process.env.BRAINBLAST_VAULT_DIR;
    prevPass = process.env.BRAINBLAST_VAULT_PASSPHRASE;
    process.env.BRAINBLAST_VAULT_DIR = vdir;
    process.env.BRAINBLAST_VAULT_PASSPHRASE = "test-passphrase";
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
    rmSync(vdir, { recursive: true, force: true });
    if (prevDir === undefined) delete process.env.BRAINBLAST_VAULT_DIR;
    else process.env.BRAINBLAST_VAULT_DIR = prevDir;
    if (prevPass === undefined) delete process.env.BRAINBLAST_VAULT_PASSPHRASE;
    else process.env.BRAINBLAST_VAULT_PASSPHRASE = prevPass;
  });

  it("backs up a secret, deduplicates identical content, and reports it backed up", () => {
    const f = join(work, "id.json");
    writeFileSync(f, SECRET);
    const first = backupFile(f, { pubkey: "ABC" });
    expect(first.deduped).toBe(false);
    const second = backupFile(f);
    expect(second.deduped).toBe(true); // identical content stored once
    expect(isBackedUp(f)).toBe(true);
  });

  it("stores the secret ENCRYPTED, never in plaintext", () => {
    const f = join(work, "id.json");
    writeFileSync(f, SECRET);
    backupFile(f);
    const objDir = join(vaultDir(), "objects");
    const blobs = readdirSync(objDir).map((n) => readFileSync(join(objDir, n)));
    for (const b of blobs) {
      expect(b.toString("utf8")).not.toContain(SECRET);
      expect(b.subarray(0, 4).toString()).toBe("BBV1");
    }
  });

  it("restores a deleted secret byte-for-byte", () => {
    const f = join(work, "id.json");
    writeFileSync(f, SECRET);
    backupFile(f);
    rmSync(f);
    expect(existsSync(f)).toBe(false);
    const r = restore(f);
    expect(r.restoredTo).toBe(f);
    expect(readFileSync(f, "utf8")).toBe(SECRET);
  });

  it("refuses to overwrite an existing file unless --force", () => {
    const f = join(work, "id.json");
    writeFileSync(f, SECRET);
    backupFile(f);
    writeFileSync(f, "DIFFERENT");
    expect(() => restore(f)).toThrow(/already exists/);
    restore(f, { force: true });
    expect(readFileSync(f, "utf8")).toBe(SECRET);
  });

  it("knows when the CURRENT content is not yet backed up", () => {
    const f = join(work, "id.json");
    writeFileSync(f, SECRET);
    backupFile(f);
    writeFileSync(f, JSON.stringify(Array.from({ length: 64 }, () => 9)));
    expect(isBackedUp(f)).toBe(false); // current content differs from any snapshot
    const st = statusForPath(f);
    expect(st.backedUp).toBe(true);
    expect(st.currentMatches).toBe(false);
  });

  it("restores by pubkey", () => {
    const f = join(work, "wallet.json");
    writeFileSync(f, SECRET);
    backupFile(f, { pubkey: "PUBKEY123" });
    rmSync(f);
    const r = restore("PUBKEY123", { byPubkey: true });
    expect(readFileSync(r.restoredTo, "utf8")).toBe(SECRET);
  });

  it("trash backs up then deletes (safe soft-delete)", () => {
    const f = join(work, "id.json");
    writeFileSync(f, SECRET);
    trash(f);
    expect(existsSync(f)).toBe(false);
    restore(f);
    expect(readFileSync(f, "utf8")).toBe(SECRET);
  });

  it("lists snapshots and verifies integrity", () => {
    const f = join(work, "id.json");
    writeFileSync(f, SECRET);
    backupFile(f);
    expect(listLatestByPath().some((e) => e.path === f)).toBe(true);
    expect(verifyVault().ok).toBe(true);
  });
});
