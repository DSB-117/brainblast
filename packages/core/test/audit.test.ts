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
