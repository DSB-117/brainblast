import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateCommand, evaluateOverwrite } from "../src/keys/guard.ts";

const KEYPAIR = JSON.stringify(Array.from({ length: 64 }, (_, i) => i));

describe("Guard — blast-set expansion + verdict", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "guard-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("BLOCKS `rm -rf target/` when a keypair lives under it", () => {
    mkdirSync(join(dir, "target", "deploy"), { recursive: true });
    writeFileSync(join(dir, "target", "deploy", "authority.json"), KEYPAIR);
    const v = evaluateCommand("rm -rf target/", { cwd: dir });
    expect(v.decision).toBe("block");
    expect(v.findings.some((f) => f.rel.includes("authority.json"))).toBe(true);
    expect(v.safeAlternative).toMatch(/vault backup/);
  });

  it("BLOCKS `rm id.json` for a top-level keypair", () => {
    writeFileSync(join(dir, "id.json"), KEYPAIR);
    expect(evaluateCommand("rm id.json", { cwd: dir }).decision).toBe("block");
  });

  it("BLOCKS an output redirect that would truncate a secret", () => {
    writeFileSync(join(dir, "id.json"), KEYPAIR);
    expect(evaluateCommand("echo x > id.json", { cwd: dir }).decision).toBe("block");
  });

  it("ALLOWS deleting an ordinary build artifact", () => {
    mkdirSync(join(dir, "target", "release"), { recursive: true });
    writeFileSync(join(dir, "target", "release", "app.bin"), "not a secret");
    expect(evaluateCommand("rm -rf target/release", { cwd: dir }).decision).toBe("allow");
  });

  it("BLOCKS `git clean -fdx` via dry-run when it would remove a gitignored keypair", () => {
    execFileSync("git", ["-C", dir, "init", "-q"]);
    writeFileSync(join(dir, ".gitignore"), "id.json\n");
    writeFileSync(join(dir, "id.json"), KEYPAIR);
    const v = evaluateCommand("git clean -fdx", { cwd: dir });
    expect(v.decision).toBe("block");
    expect(v.safeAlternative).toMatch(/--exclude/);
  });

  it("WARNS instead of blocking when the secret is backed up in the Vault", () => {
    writeFileSync(join(dir, "id.json"), KEYPAIR);
    const v = evaluateCommand("rm id.json", { cwd: dir, vaultLookup: () => true });
    expect(v.decision).toBe("warn");
  });

  it("expands compound commands and tracks cd", () => {
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "id.json"), KEYPAIR);
    const v = evaluateCommand("cd sub && rm -rf .", { cwd: dir });
    expect(v.decision).toBe("block");
  });

  it("evaluateOverwrite blocks clobbering an existing secret (Write/Edit path)", () => {
    writeFileSync(join(dir, "id.json"), KEYPAIR);
    expect(evaluateOverwrite("id.json", { cwd: dir }).decision).toBe("block");
    expect(evaluateOverwrite("brand-new.json", { cwd: dir }).decision).toBe("allow");
  });

  it("falls back to a dir scan and BLOCKS on an imprecise glob rm near a secret", () => {
    writeFileSync(join(dir, "id.json"), KEYPAIR);
    const v = evaluateCommand("rm -rf *", { cwd: dir });
    expect(v.imprecise).toBe(true);
    expect(v.decision).toBe("block");
  });
});
