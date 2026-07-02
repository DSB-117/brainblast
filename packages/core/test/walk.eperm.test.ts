import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit } from "../src/audit.ts";
import { findRustCandidates } from "../src/rustFinder.ts";
import { rules } from "../rules/index.ts";

// Regression: walk()/walkAllFiles() (src/walk.ts) and walkRust() (src/rustFinder.ts)
// used to call readdirSync/statSync with no error handling, so scanning a tree
// containing a permission-denied directory (e.g. macOS ~/.Trash under a sandboxed
// process, or any dir the OS refuses to list) crashed the whole audit with an
// uncaught EPERM/EACCES instead of just skipping it. root bypasses Unix
// permission bits, so this only proves anything as a non-root user.
const isRoot = process.getuid?.() === 0;

describe.skipIf(isRoot)("walkers tolerate a permission-denied directory", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      // Restore permissions before cleanup or rmSync itself EPERMs.
      chmodSync(join(dir, "locked"), 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("audit() does not throw on a directory tree with an unreadable subdir", () => {
    dir = mkdtempSync(join(tmpdir(), "bb-eperm-"));
    writeFileSync(join(dir, "a.ts"), "const x = 1;\n");
    mkdirSync(join(dir, "locked"));
    writeFileSync(join(dir, "locked", "b.ts"), "const y = 2;\n");
    chmodSync(join(dir, "locked"), 0o000);

    expect(() => audit(dir, rules)).not.toThrow();
  });

  it("findRustCandidates() does not throw on a directory tree with an unreadable subdir", () => {
    dir = mkdtempSync(join(tmpdir(), "bb-eperm-rust-"));
    mkdirSync(join(dir, "locked"));
    writeFileSync(join(dir, "locked", "lib.rs"), "fn main() {}\n");
    chmodSync(join(dir, "locked"), 0o000);

    const rule = rules.find((r) => r.detect.lang === "rust");
    expect(rule).toBeDefined();
    expect(() => findRustCandidates(dir, rule!)).not.toThrow();
  });
});
