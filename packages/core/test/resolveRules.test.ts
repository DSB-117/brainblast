import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRules } from "../src/resolveRules.ts";
import { rules as bundled } from "../rules/index.ts";

function projectWithRule(yaml: string): string {
  const d = mkdtempSync(join(tmpdir(), "bb-proj-"));
  const rdir = join(d, ".agent-research", "rules");
  mkdirSync(rdir, { recursive: true });
  writeFileSync(join(rdir, "extra.yaml"), yaml);
  return d;
}

const EXTRA = `id: custom-trap
severity: high
title: custom
component: { name: Custom, type: SDK }
detect: { modules: [custompkg], nameRegex: custom, triggerCalls: [doThing] }
check: { kind: positional-arg-identity, params: { call: doThing, argIndex: 0, paramIndex: 0, absentDetail: a, parsedDetail: p, passDetail: ok } }
test: { kind: stripe-webhook-signature }`;

describe("resolveRules", () => {
  it("returns just the bundled rules when no project rules exist", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-empty-"));
    expect(resolveRules(d).length).toBe(bundled.length);
  });

  it("merges a valid project-local rule on top of bundled (completeness grows in)", () => {
    const rules = resolveRules(projectWithRule(EXTRA));
    expect(rules.length).toBe(bundled.length + 1);
    expect(rules.some((r) => r.id === "custom-trap")).toBe(true);
  });

  it("does not let a project rule shadow a bundled rule id", () => {
    const shadow = EXTRA.replace("id: custom-trap", "id: stripe-webhook-raw-body-verification");
    expect(resolveRules(projectWithRule(shadow)).length).toBe(bundled.length);
  });

  it("applies loader validation to project rules (rejects invalid)", () => {
    const bad =
      "id: bad\nseverity: nope\ntitle: x\ncomponent: {name: X, type: API}\n" +
      "detect: {modules: [x], nameRegex: x, triggerCalls: [y]}\n" +
      "check: {kind: positional-arg-identity, params: {}}\ntest: {kind: stripe-webhook-signature}";
    expect(() => resolveRules(projectWithRule(bad))).toThrow(/severity/);
  });
});
