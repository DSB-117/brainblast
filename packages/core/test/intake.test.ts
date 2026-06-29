import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// intake — R1 of ROADMAP-TRAINING-DATA.md. The conveyor's HAPPY path regenerates
// committed datasets/ artifacts (and is covered by the underlying gen-vti /
// pack-dataset / corpus / catalog scripts + the SLA gate), so here we test only
// the genuinely new logic: the optional --pack VALIDATION GATE, which is
// fail-closed and exits BEFORE the conveyor — so these run with zero side effects.

const here = dirname(fileURLToPath(import.meta.url));
const INTAKE = resolve(here, "..", "scripts", "intake.ts");

function runIntake(args: string[]): number {
  try {
    execFileSync("npx", ["tsx", INTAKE, ...args], { stdio: "pipe", cwd: resolve(here, "..") });
    return 0;
  } catch (e: any) {
    return typeof e?.status === "number" ? e.status : -1;
  }
}

describe("intake — the --pack validation gate is fail-closed", () => {
  it("exits 1 when the pack dir does not exist", () => {
    expect(runIntake(["--pack", "packs/definitely-not-a-real-pack"])).toBe(1);
  });

  it("exits 1 when --pack points at something that isn't a pack", () => {
    const f = join(mkdtempSync(join(tmpdir(), "intake-")), "not-a-pack.txt");
    writeFileSync(f, "i am not a pack");
    expect(runIntake(["--pack", f])).toBe(1);
  });

  it("exits 2 when --pack is given without a directory argument", () => {
    expect(runIntake(["--pack"])).toBe(2);
  });
}, 30_000);
