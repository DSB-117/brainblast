import { describe, it, expect, afterEach } from "vitest";
import { Project } from "ts-morph";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixPositionalArgIdentity } from "../src/fixers/positionalArgIdentity.ts";
import { applyDiffToFile, parseDiff } from "../src/fixers/applyDiff.ts";
import type { Candidate } from "../src/types.ts";

const STRIPE = {
  call: "constructEvent",
  argIndex: 0,
  paramIndex: 0,
  absentDetail: "absent",
  parsedDetail: "parsed",
  passDetail: "verified {param}",
};

describe("applyDiffToFile", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("parses a buildDiff hunk and applies it to the file on disk", () => {
    dir = mkdtempSync(join(tmpdir(), "brainblast-applydiff-"));
    const filePath = join(dir, "webhook.ts");
    const source = [
      `import Stripe from "stripe";`,
      `const s = new Stripe("x");`,
      `export function h(rawBody: string, sig: string) {`,
      `  return s.webhooks.constructEvent(JSON.parse(rawBody), sig, "sec");`,
      `}`,
      "",
    ].join("\n");
    writeFileSync(filePath, source);

    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sf = project.addSourceFileAtPath(filePath);
    const fn = sf.getFunctionOrThrow("h");
    const c: Candidate = { filePath, fnName: "h", params: ["rawBody", "sig"], fn };

    const fix = fixPositionalArgIdentity(c, STRIPE, { result: "fail", detail: "parsed" });
    expect(fix?.diff).toBeTruthy();

    const parsed = parseDiff(fix!.diff!);
    expect(parsed.filePath).toBe(filePath);

    const ok = applyDiffToFile(fix!.diff!);
    expect(ok).toBe(true);

    const updated = readFileSync(filePath, "utf8");
    expect(updated).toContain('return s.webhooks.constructEvent(rawBody, sig, "sec");');
    expect(updated).not.toContain("JSON.parse(rawBody)");
  });

  it("returns false (no-op) when the file no longer matches the diff's expected lines", () => {
    dir = mkdtempSync(join(tmpdir(), "brainblast-applydiff-"));
    const filePath = join(dir, "webhook.ts");
    const source = [
      `import Stripe from "stripe";`,
      `const s = new Stripe("x");`,
      `export function h(rawBody: string, sig: string) {`,
      `  return s.webhooks.constructEvent(JSON.parse(rawBody), sig, "sec");`,
      `}`,
      "",
    ].join("\n");
    writeFileSync(filePath, source);

    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sf = project.addSourceFileAtPath(filePath);
    const fn = sf.getFunctionOrThrow("h");
    const c: Candidate = { filePath, fnName: "h", params: ["rawBody", "sig"], fn };
    const fix = fixPositionalArgIdentity(c, STRIPE, { result: "fail", detail: "parsed" });

    // Mutate the file out from under the diff before applying.
    writeFileSync(filePath, source.replace("JSON.parse(rawBody)", "somethingElse"));

    const ok = applyDiffToFile(fix!.diff!);
    expect(ok).toBe(false);
    expect(readFileSync(filePath, "utf8")).toContain("somethingElse");
  });
});
