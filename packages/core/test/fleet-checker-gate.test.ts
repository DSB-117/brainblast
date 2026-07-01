import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

// Move 2 — the checker meta-gate. It vets an agent-proposed AST checker before it
// can join the registry: purity → the checker proves its own trap RED→GREEN → no
// false positives on a large known-good corpus → determinism. Exit 0 = VETTED.

const here = dirname(fileURLToPath(import.meta.url));
const core = resolve(here, "..");
const GATE = join(core, "scripts", "fleet-checker-gate.ts");

function runGate(proposalDir: string, wire = false): { code: number; out: string } {
  try {
    const out = execFileSync("npx", ["tsx", GATE, "--proposal", proposalDir, ...(wire ? ["--wire"] : [])], {
      cwd: core,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e: any) {
    return { code: typeof e?.status === "number" ? e.status : -1, out: `${e?.stdout ?? ""}${e?.stderr ?? ""}` };
  }
}

describe("fleet checker meta-gate", () => {
  it("VETS a sound proposal (proves its trap + zero false positives across the corpus)", () => {
    // The committed worked example: array-valued forbidden literal (jwt alg:none).
    const proposal = resolve(core, "..", "..", "fleet", "checker-proposals", "array-property-contains-forbidden-literal");
    const r = runGate(proposal); // exercises purity + prove + FP-scan + determinism end-to-end
    expect(r.code, `gate did not VET — output:\n${r.out}`).toBe(0);
  }, 60_000);

  it("REJECTS an impure checker (side-effecting import) before it can run", () => {
    const dir = mkdtempSync(join(tmpdir(), "proposal-"));
    // A checker that reaches for the filesystem — must be refused at the purity gate.
    writeFileSync(join(dir, "checker.ts"), `import { readFileSync } from "node:fs";\nexport const checker = () => { readFileSync("/etc/passwd"); return { result: "pass" }; };\n`);
    writeFileSync(join(dir, "candidate.json"), JSON.stringify({ id: "x", binding: { check: { kind: basename(dir), params: {} }, test: { kind: "none" } } }));
    expect(runGate(dir).code).toBe(1);
  }, 30_000);
});
