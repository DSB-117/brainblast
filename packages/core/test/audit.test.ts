import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "../src/audit.ts";
import { rules } from "../rules/index.ts";
import type { CheckResultKind } from "../src/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (p: string) => resolve(here, "..", "fixtures", p);

const cases: [string, string, CheckResultKind][] = [
  ["stripe/vulnerable", "stripe-webhook-raw-body-verification", "fail"],
  ["stripe/fixed", "stripe-webhook-raw-body-verification", "pass"],
  ["jwt/vulnerable", "privy-jwt-verification", "fail"],
  ["jwt/fixed", "privy-jwt-verification", "pass"],
  ["jwt/cant_tell", "privy-jwt-verification", "cant_tell"],
  ["metaplex/vulnerable", "metaplex-metadata-immutable", "fail"],
  ["metaplex/fixed", "metaplex-metadata-immutable", "pass"],
  ["anchor/init-if-needed/vulnerable", "anchor-init-if-needed-guarded", "fail"],
  ["anchor/init-if-needed/fixed", "anchor-init-if-needed-guarded", "pass"],
  ["env/vulnerable", "env-secrets-committed", "fail"],
  ["env/fixed", "env-secrets-committed", "pass"],
  ["taint/vulnerable", "env-secret-leaked-to-sink", "fail"],
  ["taint/fixed", "env-secret-leaked-to-sink", "pass"],
  ["cmdinject/vulnerable", "request-input-command-injection", "fail"],
  ["cmdinject/fixed", "request-input-command-injection", "pass"],
  ["taint-crossfile/vulnerable", "env-secret-leaked-to-sink", "fail"],
  ["taint-crossfile/fixed", "env-secret-leaked-to-sink", "pass"],
  ["mintidentity/vulnerable", "solana-token-impersonation", "fail"],
  ["mintidentity/fixed", "solana-token-impersonation", "pass"],
];

describe("audit (unified, all rules)", () => {
  for (const [dir, ruleId, result] of cases) {
    it(`${dir} -> exactly one ${result} from ${ruleId} (no cross-contamination)`, () => {
      const { checks, report } = audit(fx(dir), rules);
      expect(checks.length).toBe(1);
      expect(checks[0].ruleId).toBe(ruleId);
      expect(checks[0].result).toBe(result);

      // report internally consistent with its own checks
      const counted = { pass: 0, fail: 0, cant_tell: 0 };
      for (const c of report.checks) counted[c.result]++;
      expect(report.checkTotals).toEqual(counted);
    });
  }
});
