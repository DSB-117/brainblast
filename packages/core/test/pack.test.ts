import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initPack, validatePack } from "../src/pack.ts";
import { PACK_MANIFEST_FILE } from "../src/packs.ts";

describe("initPack", () => {
  it("scaffolds a manifest, rules/, and fixtures/", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "bb-init-")), "my-pack");
    const manifestFile = initPack(dir, { id: "my-pack", author: "Me" });

    const manifest = readFileSync(manifestFile, "utf8");
    expect(manifest).toContain("id: my-pack");
    expect(manifest).toContain("author: Me");
    expect(manifest).toContain("version: 0.1.0");

    const result = validatePack(dir);
    expect(result.ok).toBe(true);
    expect(result.manifest.id).toBe("my-pack");
    expect(result.rules).toEqual([]);
  });

  it("throws if a manifest already exists", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "bb-init-")), "dup-pack");
    initPack(dir, { id: "dup-pack", author: "Me" });
    expect(() => initPack(dir, { id: "dup-pack", author: "Me" })).toThrow(/already contains/);
  });
});

const RULE_TEMPLATE = (id: string) => `id: ${id}
severity: high
title: hardcoded acme secret
component: { name: Acme, type: SDK }
detect: { modules: [acmesdk], nameRegex: handler, triggerCalls: [doAcmeThing] }
check: { kind: positional-arg-identity, params: { call: doAcmeThing, argIndex: 0, paramIndex: 0, absentDetail: "missing", parsedDetail: "wrong", passDetail: "ok" } }
test: { kind: stripe-webhook-signature }`;

function packWithRule(ruleYaml: string, ruleId: string): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-pack-"));
  writeFileSync(
    join(dir, PACK_MANIFEST_FILE),
    "id: acme-pack\nname: Acme Pack\nversion: 1.0.0\nauthor: Acme",
  );
  const rulesDir = join(dir, "rules");
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(rulesDir, "rule.yaml"), ruleYaml);
  return dir;
}

describe("validatePack", () => {
  it("reports missing-fixtures for a rule with no fixtures directory", () => {
    const dir = packWithRule(RULE_TEMPLATE("acme-no-fixtures"), "acme-no-fixtures");
    const result = validatePack(dir);
    expect(result.ok).toBe(true);
    expect(result.ruleResults).toEqual([
      {
        ruleId: "acme-no-fixtures",
        status: "missing-fixtures",
        detail: expect.stringContaining("no fixtures/"),
      },
    ]);
  });

  it("throws if the manifest is invalid", () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-pack-"));
    writeFileSync(join(dir, PACK_MANIFEST_FILE), "id: bad");
    expect(() => validatePack(dir)).toThrow(/invalid pack manifest/);
  });

  it("passes the prove gate when vulnerable fails and fixed doesn't", () => {
    const ruleId = "acme-positional-arg";
    const dir = packWithRule(RULE_TEMPLATE(ruleId), ruleId);

    const vulnDir = join(dir, "fixtures", ruleId, "vulnerable");
    const fixedDir = join(dir, "fixtures", ruleId, "fixed");
    mkdirSync(vulnDir, { recursive: true });
    mkdirSync(fixedDir, { recursive: true });

    // Vulnerable: doAcmeThing is called with a parsed (derived) value instead
    // of the raw input.
    writeFileSync(
      join(vulnDir, "handler.ts"),
      `export function handler(rawBody: string, parsed: any) {\n  acmesdk.doAcmeThing(JSON.parse(rawBody));\n}\n`,
    );
    // Fixed: doAcmeThing is called with the raw input directly.
    writeFileSync(
      join(fixedDir, "handler.ts"),
      `export function handler(rawBody: string, parsed: any) {\n  acmesdk.doAcmeThing(rawBody);\n}\n`,
    );

    const result = validatePack(dir);
    expect(result.ruleResults).toEqual([
      { ruleId, status: "ok", detail: "RED -> GREEN proven" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("reports red-failed when the vulnerable fixture doesn't trip the rule", () => {
    const ruleId = "acme-no-trip";
    const dir = packWithRule(RULE_TEMPLATE(ruleId), ruleId);

    const vulnDir = join(dir, "fixtures", ruleId, "vulnerable");
    const fixedDir = join(dir, "fixtures", ruleId, "fixed");
    mkdirSync(vulnDir, { recursive: true });
    mkdirSync(fixedDir, { recursive: true });

    // Neither fixture contains a candidate matching the rule's detection.
    writeFileSync(join(vulnDir, "handler.ts"), `export function other() {}\n`);
    writeFileSync(join(fixedDir, "handler.ts"), `export function other() {}\n`);

    const result = validatePack(dir);
    expect(result.ok).toBe(false);
    expect(result.ruleResults[0].status).toBe("red-failed");
  });
});
