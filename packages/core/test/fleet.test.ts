import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proveFinding } from "../src/synth/index.ts";
import type { Finding } from "../src/synth/index.ts";

// The fleet's gate is `proveFinding` (shared with synth-prove). These cover the
// gate's verdicts AND the boolean-literal support added to
// object-arg-property-forbidden-literal (the shape behind insecure-default flags).

function booleanFlagFinding(over: Partial<Finding> = {}): Finding {
  return {
    id: "test-reject-unauthorized",
    severity: "critical",
    title: "request with rejectUnauthorized: false — TLS validation disabled",
    component: { name: "node:https", type: "Networking", version: ">=18", sourceUrl: "https://x" },
    detect: { modules: ["https"], nameRegex: "request|client", triggerCalls: ["request"] },
    binding: {
      check: {
        kind: "object-arg-property-forbidden-literal",
        params: { call: "request", argIndex: 0, propName: "rejectUnauthorized", forbiddenValue: false },
      },
      test: { kind: "none" },
    },
    fixtures: {
      filename: "client.ts",
      vulnerable: "import https from \"node:https\";\nexport function f(h: string) {\n  return https.request({ hostname: h, rejectUnauthorized: false });\n}\n",
      fixed: "import https from \"node:https\";\nexport function f(h: string) {\n  return https.request({ hostname: h, rejectUnauthorized: true });\n}\n",
    },
    provenance: { sourceUrl: "https://x", note: "n" },
    ...over,
  } as Finding;
}

async function withStage(fn: (stageRoot: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "fleet-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("fleet gate — proveFinding", () => {
  it("PROVEN on a boolean insecure-flag trap (exercises boolean-literal support), via the static backend", async () => {
    await withStage(async (stage) => {
      const out = await proveFinding(booleanFlagFinding(), stage);
      expect(out.verdict).toBe("PROVEN");
      expect(out.redOk).toBe(true);
      expect(out.greenOk).toBe(true);
      expect(out.method).toBe("static-checker"); // shape check → proven by static, no code run
      expect(out.staged?.ruleFile).toBeDefined();
    });
  });

  it("DRAFTs (never proves) when check.kind is not a vetted checker", async () => {
    await withStage(async (stage) => {
      const f = booleanFlagFinding({
        binding: { check: { kind: "totally-made-up-checker", params: {} }, test: { kind: "none" } },
      } as any);
      const out = await proveFinding(f, stage);
      expect(out.verdict).toBe("DRAFT");
      expect(out.reason).toMatch(/not a vetted checker/);
    });
  });

  it("DRAFTs when the fixed fixture still trips the rule (wrong colors)", async () => {
    await withStage(async (stage) => {
      // Fixed fixture ALSO sets the forbidden value → GREEN gate fails.
      const f = booleanFlagFinding({
        fixtures: {
          filename: "client.ts",
          vulnerable: "import https from \"node:https\";\nexport function f(h: string) {\n  return https.request({ hostname: h, rejectUnauthorized: false });\n}\n",
          fixed: "import https from \"node:https\";\nexport function f(h: string) {\n  return https.request({ hostname: h, rejectUnauthorized: false });\n}\n",
        },
      });
      const out = await proveFinding(f, stage);
      expect(out.verdict).toBe("DRAFT");
      expect(out.greenOk).toBe(false);
    });
  });
});
