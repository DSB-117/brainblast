import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync } from "node:fs";
import { audit } from "../src/audit.ts";
import { generateBehavioralTest } from "../src/generateTest.ts";

// E2E proof of T2: the generated behavioral test must be RED on the vulnerable
// fixture (decode-without-verify) and GREEN on the fixed one (verify + aud + iss).
const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const genDir = join(root, ".gen");
rmSync(genDir, { recursive: true, force: true });
mkdirSync(genDir, { recursive: true });

function runVitest(file: string): number {
  try {
    execFileSync("npx", ["vitest", "run", file], { cwd: root, stdio: "inherit" });
    return 0;
  } catch (e: any) {
    return typeof e?.status === "number" ? e.status : 1;
  }
}

let ok = true;

for (const variant of ["vulnerable", "fixed"] as const) {
  console.log(`\n========== ${variant} ==========`);
  const targetDir = join(root, "fixtures", variant);
  const { checks } = audit(targetDir);
  const result = checks[0]?.result ?? "cant_tell";
  console.log(`audit: ${result} — ${checks[0]?.detail ?? "no verifier found"}`);

  const testFile = join(genDir, `${variant}.contract.test.ts`);
  generateBehavioralTest({
    handlerImportPath: join(targetDir, "auth.ts"),
    handlerExport: "verifyPrivyToken",
    outPath: testFile,
  });

  const exit = runVitest(testFile);
  console.log(`vitest exit: ${exit}`);

  if (variant === "vulnerable") {
    const good = result === "fail" && exit !== 0;
    console.log(good ? "EXPECTED: audit FAIL + behavioral test RED" : ">>> UNEXPECTED <<<");
    ok = ok && good;
  } else {
    const good = result === "pass" && exit === 0;
    console.log(good ? "EXPECTED: audit PASS + behavioral test GREEN" : ">>> UNEXPECTED <<<");
    ok = ok && good;
  }
}

console.log(`\nPROOF: ${ok ? "RED on vulnerable, GREEN on fixed — VERIFIED ✅" : "FAILED ❌"}`);
process.exit(ok ? 0 : 1);
