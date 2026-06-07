import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync } from "node:fs";
import { audit } from "../src/audit.ts";
import { generateTestForResult } from "../src/generate.ts";
import { rules } from "../rules/index.ts";

// Proves the EXTRACTION holds: the two traps, now pure-data rules over one
// engine, still produce RED-on-vulnerable / GREEN-on-fixed — AND the unified
// audit raises exactly one (correct) check per fixture (no cross-contamination).
const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const genDir = join(root, ".gen");
rmSync(genDir, { recursive: true, force: true });
mkdirSync(genDir, { recursive: true });

function runVitest(file: string): number {
  try {
    // Use the gen-only config so the test/** include in vitest.config.ts does
    // not exclude the generated contract test under .gen/.
    execFileSync("npx", ["vitest", "run", "--config", "vitest.gen.config.ts", file], {
      cwd: root,
      stdio: "inherit",
    });
    return 0;
  } catch (e: any) {
    return typeof e?.status === "number" ? e.status : 1;
  }
}

const cases = [
  { dir: "fixtures/stripe/vulnerable", ruleId: "stripe-webhook-raw-body-verification", expect: "fail" },
  { dir: "fixtures/stripe/fixed", ruleId: "stripe-webhook-raw-body-verification", expect: "pass" },
  { dir: "fixtures/jwt/vulnerable", ruleId: "privy-jwt-verification", expect: "fail" },
  { dir: "fixtures/jwt/fixed", ruleId: "privy-jwt-verification", expect: "pass" },
] as const;

let ok = true;

for (const tc of cases) {
  console.log(`\n========== ${tc.dir} ==========`);
  const { checks } = audit(join(root, tc.dir), rules);

  // exactly one check, from the expected rule (proves no cross-contamination)
  const clean = checks.length === 1 && checks[0].ruleId === tc.ruleId && checks[0].result === tc.expect;
  console.log(`audit: ${checks.length} check(s); ${checks[0]?.ruleId ?? "none"} -> ${checks[0]?.result ?? "none"}`);
  if (!clean) { console.log(">>> UNEXPECTED audit result <<<"); ok = false; continue; }

  const rule = rules.find((r) => r.id === checks[0].ruleId)!;
  const testFile = join(genDir, `${tc.dir.replace(/\//g, "_")}.contract.test.ts`);
  generateTestForResult(checks[0], rule, testFile);
  const exit = runVitest(testFile);
  console.log(`vitest exit: ${exit}`);

  const good = tc.expect === "fail" ? exit !== 0 : exit === 0;
  console.log(good ? `EXPECTED: ${tc.expect.toUpperCase()} -> ${tc.expect === "fail" ? "RED" : "GREEN"}` : ">>> UNEXPECTED test color <<<");
  ok = ok && good;
}

console.log(`\nPROOF: ${ok ? "all 4 cases correct through @brainblast/core — VERIFIED ✅" : "FAILED ❌"}`);
process.exit(ok ? 0 : 1);
