import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRules } from "../src/resolveRules.ts";
import { PACK_MANIFEST_FILE } from "../src/packs.ts";
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

const PACK_MANIFEST = `id: acme-pack
name: Acme Security Pack
version: 1.0.0
author: Acme Corp`;

const PACK_RULE = EXTRA;

function projectWithPack(): string {
  const d = mkdtempSync(join(tmpdir(), "bb-proj-"));
  const packDir = join(d, ".agent-research", "packs", "acme-pack");
  const rulesDir = join(packDir, "rules");
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(packDir, PACK_MANIFEST_FILE), PACK_MANIFEST);
  writeFileSync(join(rulesDir, "extra.yaml"), PACK_RULE);
  return d;
}

function externalPack(): string {
  const d = mkdtempSync(join(tmpdir(), "bb-extpack-"));
  const rulesDir = join(d, "rules");
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(d, PACK_MANIFEST_FILE), PACK_MANIFEST.replace("acme-pack", "acme-external"));
  writeFileSync(join(rulesDir, "extra.yaml"), EXTRA.replace("custom-trap", "external-trap"));
  return d;
}

describe("resolveRules - packs", () => {
  it("auto-discovers packs under .agent-research/packs/", () => {
    const rules = resolveRules(projectWithPack());
    expect(rules.length).toBe(bundled.length + 1);
    const r = rules.find((r) => r.id === "custom-trap")!;
    expect(r.pack).toEqual({ id: "acme-pack", version: "1.0.0", author: "Acme Corp" });
  });

  it("loads extra packs from explicit directories", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-empty-"));
    const rules = resolveRules(d, [externalPack()]);
    expect(rules.length).toBe(bundled.length + 1);
    const r = rules.find((r) => r.id === "external-trap")!;
    expect(r.pack?.id).toBe("acme-external");
  });

  it("does not let a pack rule shadow a bundled rule id", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-empty-"));
    const shadow = EXTRA.replace("id: custom-trap", "id: stripe-webhook-raw-body-verification");
    const packDir = mkdtempSync(join(tmpdir(), "bb-extpack-"));
    const rulesDir = join(packDir, "rules");
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(packDir, PACK_MANIFEST_FILE), PACK_MANIFEST.replace("acme-pack", "acme-shadow"));
    writeFileSync(join(rulesDir, "extra.yaml"), shadow);

    expect(resolveRules(d, [packDir]).length).toBe(bundled.length);
  });

  it("project rules and pack rules don't shadow each other across sources", () => {
    const d = projectWithPack();
    // also add a project rule with a different id
    const projRulesDir = join(d, ".agent-research", "rules");
    mkdirSync(projRulesDir, { recursive: true });
    writeFileSync(join(projRulesDir, "extra.yaml"), EXTRA.replace("custom-trap", "project-trap"));

    const rules = resolveRules(d);
    expect(rules.some((r) => r.id === "custom-trap")).toBe(true);
    expect(rules.some((r) => r.id === "project-trap")).toBe(true);
    expect(rules.length).toBe(bundled.length + 2);
  });
});
