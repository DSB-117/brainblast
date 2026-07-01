import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { differentialBackend } from "../src/oracle/backends/differential.ts";
import type { Rule } from "../src/types.ts";

// Move 3 — the differential oracle proves footguns in languages beyond TS/Rust.
// These exercise the PYTHON runner end-to-end (light isolate, python3 on host).
const hasPython = spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0;

function pyRule(): Rule {
  return {
    id: "py-fee",
    title: "python fee truncation",
    severity: "high",
    component: { name: "python", type: "Language" },
    detect: { modules: [], nameRegex: "fee", triggerCalls: [] },
    check: {
      kind: "differential-io",
      params: {
        lang: "python",
        entryFile: "fee.py",
        export: "platform_fee",
        cases: [
          { input: [5000, 250], output: 125 },
          { input: [123, 500], output: 6 },
        ],
      },
    },
  } as unknown as Rule;
}

function dirWith(code: string): string {
  const d = mkdtempSync(join(tmpdir(), "bb-mllang-"));
  writeFileSync(join(d, "fee.py"), code);
  return d;
}

describe.skipIf(!hasPython)("differential oracle — Python (Move 3)", () => {
  it("RED: the vulnerable Python diverges from the golden I/O table", async () => {
    const dir = dirWith("def platform_fee(amount_cents, bps):\n    return amount_cents // 10000 * bps\n");
    const v = await differentialBackend.verify({ dir, rule: pyRule(), context: "local" });
    expect(v.color).toBe("RED");
  });

  it("GREEN: the fixed Python matches the golden I/O table", async () => {
    const dir = dirWith("def platform_fee(amount_cents, bps):\n    return amount_cents * bps // 10000\n");
    const v = await differentialBackend.verify({ dir, rule: pyRule(), context: "local" });
    expect(v.color).toBe("GREEN");
  });

  it("UNKNOWN (never a false RED): a harness error when the export is missing", async () => {
    const dir = dirWith("def something_else(a, b):\n    return 0\n");
    const v = await differentialBackend.verify({ dir, rule: pyRule(), context: "local" });
    expect(v.color).toBe("UNKNOWN");
  });
});
