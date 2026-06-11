import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules } from "../src/loadRules.ts";

const here = dirname(fileURLToPath(import.meta.url));
const rulesDir = resolve(here, "..", "rules");

describe("loadRules", () => {
  it("loads the bundled yaml rule pack", () => {
    const rules = loadRules(rulesDir);
    const ids = rules.map((r) => r.id).sort();
    expect(ids).toEqual([
      "anchor-init-if-needed-guarded",
      "bags-fee-share-creator-included",
      "env-secret-leaked-to-sink",
      "env-secrets-committed",
      "metaplex-metadata-immutable",
      "privy-jwt-verification",
      "request-input-command-injection",
      "stripe-webhook-raw-body-verification",
      "token-2022-program-id-pinned",
    ]);
    const stripe = rules.find((r) => r.id === "stripe-webhook-raw-body-verification")!;
    expect(stripe.check.kind).toBe("positional-arg-identity");
    expect(stripe.detect.modules).toContain("stripe");
    // requiredProps came through as an array of synonym groups
    const privy = rules.find((r) => r.id === "privy-jwt-verification")!;
    expect(privy.check.params.requiredProps).toEqual([["audience", "aud"], ["issuer", "iss"]]);
  });

  it("rejects a rule that binds to an unknown check.kind (T9 safety net)", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-rules-"));
    writeFileSync(
      join(d, "bad.yaml"),
      [
        "id: bad-rule",
        "severity: critical",
        "title: bad",
        "component: { name: X, type: API }",
        "detect: { modules: [x], nameRegex: x, triggerCalls: [y] }",
        "check: { kind: no-such-checker, params: {} }",
        "test: { kind: stripe-webhook-signature }",
      ].join("\n"),
    );
    expect(() => loadRules(d)).toThrow(/check\.kind/);
  });

  it("rejects a rule with an invalid nameRegex", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-rules-"));
    writeFileSync(
      join(d, "bad.yaml"),
      [
        "id: bad-regex",
        "severity: critical",
        "title: bad",
        "component: { name: X, type: API }",
        "detect: { modules: [x], nameRegex: '([', triggerCalls: [y] }",
        "check: { kind: positional-arg-identity, params: {} }",
        "test: { kind: stripe-webhook-signature }",
      ].join("\n"),
    );
    expect(() => loadRules(d)).toThrow(/nameRegex/);
  });

  // Each malformed rule drops/breaks exactly one required piece — the loader
  // (the T9 safety net) must reject every one.
  const VALID = {
    id: "ok",
    severity: "critical",
    title: "t",
    component: "{ name: X, type: API }",
    detect: "{ modules: [x], nameRegex: x, triggerCalls: [y] }",
    check: "{ kind: positional-arg-identity, params: {} }",
    test: "{ kind: stripe-webhook-signature }",
  };
  const malformed: [string, Record<string, string>, RegExp][] = [
    ["missing id", { id: "" }, /missing id/],
    ["bad severity", { severity: "fatal" }, /severity/],
    ["missing title", { title: "" }, /title/],
    ["missing component", { component: "{ type: API }" }, /component/],
    ["broken detect", { detect: "{ modules: x }" }, /detect/],
    ["unknown test.kind", { test: "{ kind: no-such-template }" }, /test\.kind/],
  ];

  for (const [name, override, re] of malformed) {
    it(`rejects: ${name}`, () => {
      const d = mkdtempSync(join(tmpdir(), "bb-rules-"));
      const merged = { ...VALID, ...override };
      const lines = Object.entries(merged)
        .filter(([, v]) => v !== "")
        .map(([k, v]) => `${k}: ${v}`);
      writeFileSync(join(d, "bad.yaml"), lines.join("\n"));
      expect(() => loadRules(d)).toThrow(re);
    });
  }
});
