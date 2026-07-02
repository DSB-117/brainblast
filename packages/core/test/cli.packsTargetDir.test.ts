import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Regression: the top-level targetDir resolver (src/cli.ts) excluded the value
// following `--since`/`--oracle` from candidate target dirs, but NOT the value
// following `--packs`. `brainblast --packs jupiter <dir>` (or the README's
// documented `--packs jupiter,pyth .`) therefore picked the pack-list VALUE
// itself ("jupiter") as the scan target instead of the real directory —
// silently scanning a nonexistent/empty path and reporting a false "ready"
// verdict (and even creating a stray `jupiter/.agent-research/` dir on disk).
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const cliSrc = resolve(here, "..", "src", "cli.ts");
const vulnFixture = join(
  repoRoot,
  "packs",
  "jupiter-quote-zero-slippage",
  "fixtures",
  "jupiter-quote-zero-slippage",
  "vulnerable",
  "arb.ts",
);

describe("CLI --packs does not steal the target-dir argument", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("`--packs <name> <dir>` scans <dir>, not the pack-list value", () => {
    dir = mkdtempSync(join(tmpdir(), "bb-packs-targetdir-"));
    mkdirSync(dir, { recursive: true });
    copyFileSync(vulnFixture, join(dir, "arb.ts"));

    let stdout = "";
    let status = 0;
    try {
      stdout = execFileSync("npx", ["tsx", cliSrc, "--packs", "jupiter", dir, "--ci"], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (e: any) {
      stdout = (e.stdout ?? "") + (e.stderr ?? "");
      status = e.status ?? 1;
    }

    expect(stdout).toContain(`scanned ${dir}`);
    expect(stdout).toContain("jupiter-quote-zero-slippage");
    expect(stdout).toContain("blocked");
    // --ci gates the exit code on the fail — proves the pack rule actually ran
    // against the real target, not the bogus "jupiter" path.
    expect(status).toBe(1);
  });
});
