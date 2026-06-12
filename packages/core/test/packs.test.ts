import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPack, loadPacksFromDir, validatePackManifest, PACK_MANIFEST_FILE } from "../src/packs.ts";

const MANIFEST = `id: acme-pack
name: Acme Security Pack
version: 1.0.0
author: Acme Corp
description: A sample third-party rule pack.`;

const RULE = `id: acme-custom-trap
severity: high
title: custom acme trap
component: { name: Acme, type: SDK }
detect: { modules: [acmesdk], nameRegex: acme, triggerCalls: [doAcmeThing] }
check: { kind: positional-arg-identity, params: { call: doAcmeThing, argIndex: 0, paramIndex: 0, absentDetail: a, parsedDetail: p, passDetail: ok } }
test: { kind: stripe-webhook-signature }`;

function makePack(manifest: string, rule?: string): string {
  const d = mkdtempSync(join(tmpdir(), "bb-pack-"));
  writeFileSync(join(d, PACK_MANIFEST_FILE), manifest);
  if (rule) {
    const rulesDir = join(d, "rules");
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, "extra.yaml"), rule);
  }
  return d;
}

describe("validatePackManifest", () => {
  it("accepts a valid manifest", () => {
    expect(() => validatePackManifest({ id: "x", name: "X", version: "1.0.0", author: "Y" }, "f")).not.toThrow();
  });

  it("rejects a manifest missing required fields", () => {
    expect(() => validatePackManifest({ id: "x" }, "f")).toThrow(/missing name/);
    expect(() => validatePackManifest({ id: "x" }, "f")).toThrow(/missing version/);
    expect(() => validatePackManifest({ id: "x" }, "f")).toThrow(/missing author/);
  });

  it("rejects a non-mapping manifest", () => {
    expect(() => validatePackManifest(null, "f")).toThrow(/not a mapping/);
    expect(() => validatePackManifest("oops", "f")).toThrow(/not a mapping/);
  });
});

describe("loadPack", () => {
  it("loads a manifest and stamps its rules with pack provenance", () => {
    const dir = makePack(MANIFEST, RULE);
    const { manifest, rules } = loadPack(dir);
    expect(manifest).toEqual({
      id: "acme-pack",
      name: "Acme Security Pack",
      version: "1.0.0",
      author: "Acme Corp",
      description: "A sample third-party rule pack.",
    });
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("acme-custom-trap");
    expect(rules[0].pack).toEqual({ id: "acme-pack", version: "1.0.0", author: "Acme Corp" });
  });

  it("returns no rules when the pack has no rules/ directory", () => {
    const dir = makePack(MANIFEST);
    const { rules } = loadPack(dir);
    expect(rules).toEqual([]);
  });

  it("throws on an invalid manifest", () => {
    const dir = makePack("id: bad\nname: Bad");
    expect(() => loadPack(dir)).toThrow(/invalid pack manifest/);
  });

  it("applies loader validation to pack rules (rejects invalid)", () => {
    const bad =
      "id: bad\nseverity: nope\ntitle: x\ncomponent: {name: X, type: API}\n" +
      "detect: {modules: [x], nameRegex: x, triggerCalls: [y]}\n" +
      "check: {kind: positional-arg-identity, params: {}}\ntest: {kind: stripe-webhook-signature}";
    const dir = makePack(MANIFEST, bad);
    expect(() => loadPack(dir)).toThrow(/severity/);
  });
});

describe("loadPacksFromDir", () => {
  it("returns an empty array when the directory doesn't exist", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-nopacks-"));
    expect(loadPacksFromDir(join(d, "packs"))).toEqual([]);
  });

  it("discovers every subdirectory containing a manifest", () => {
    const packsDir = mkdtempSync(join(tmpdir(), "bb-packs-"));
    const pack1 = join(packsDir, "pack-a");
    mkdirSync(pack1, { recursive: true });
    writeFileSync(join(pack1, PACK_MANIFEST_FILE), MANIFEST);
    const rulesDir = join(pack1, "rules");
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, "extra.yaml"), RULE);

    // A subdirectory with no manifest is skipped.
    mkdirSync(join(packsDir, "not-a-pack"), { recursive: true });

    const packs = loadPacksFromDir(packsDir);
    expect(packs).toHaveLength(1);
    expect(packs[0].manifest.id).toBe("acme-pack");
    expect(packs[0].rules).toHaveLength(1);
  });
});
