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
  ["anchor-signer-constraint-missing/vulnerable", "anchor-signer-constraint-missing", "fail"],
  ["anchor-signer-constraint-missing/fixed", "anchor-signer-constraint-missing", "pass"],
  ["anchor-unchecked-account-type/vulnerable", "anchor-unchecked-account-type", "fail"],
  ["anchor-unchecked-account-type/fixed", "anchor-unchecked-account-type", "pass"],
  ["anchor-pda-find-program-address/vulnerable", "anchor-pda-find-program-address", "fail"],
  ["anchor-pda-find-program-address/fixed", "anchor-pda-find-program-address", "pass"],
  ["cpi-target-program-unverified/vulnerable", "cpi-target-program-unverified", "fail"],
  ["cpi-target-program-unverified/fixed", "cpi-target-program-unverified", "pass"],
];

describe("audit (unified, all rules)", () => {
  for (const [dir, ruleId, result] of cases) {
    it(`${dir} -> ${result} from ${ruleId}`, () => {
      const { checks, report } = audit(fx(dir), rules);
      const target = checks.find((c) => c.ruleId === ruleId);
      expect(target).toBeDefined();
      expect(target!.result).toBe(result);

      // report internally consistent with its own checks
      const counted = { pass: 0, fail: 0, cant_tell: 0 };
      for (const c of report.checks) counted[c.result]++;
      expect(report.checkTotals).toEqual(counted);
    });
  }
});
