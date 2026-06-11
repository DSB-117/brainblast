import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getChangedRanges, getWorkingTreeChanges, fileChanged, rangeChanged } from "../src/gitDiff.ts";

function git(dir: string, args: string[]) {
  execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

describe("gitDiff", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "brainblast-gitdiff-"));
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);

    writeFileSync(join(dir, "a.ts"), "export function a() {\n  return 1;\n}\n");
    writeFileSync(join(dir, "b.ts"), "export function b() {\n  return 2;\n}\nexport function c() {\n  return 3;\n}\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-m", "initial"]);

    // Modify a.ts (change line 2), add new file new.ts, leave b.ts untouched.
    writeFileSync(join(dir, "a.ts"), "export function a() {\n  return 100;\n}\n");
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "sub", "new.ts"), "export function n() {\n  return 4;\n}\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-m", "second"]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses changed ranges for modified and new files relative to HEAD~1", () => {
    const ranges = getChangedRanges(dir, "HEAD~1");
    expect(fileChanged(ranges, join(dir, "a.ts"))).toBe(true);
    expect(fileChanged(ranges, join(dir, "sub", "new.ts"))).toBe(true);
    expect(fileChanged(ranges, join(dir, "b.ts"))).toBe(false);
  });

  it("rangeChanged is true when a range overlaps the changed lines", () => {
    const ranges = getChangedRanges(dir, "HEAD~1");
    // a.ts line 2 changed (1->100)
    expect(rangeChanged(ranges, join(dir, "a.ts"), 1, 3)).toBe(true);
    expect(rangeChanged(ranges, join(dir, "a.ts"), 2, 2)).toBe(true);
  });

  it("rangeChanged is false for a file that did not change", () => {
    const ranges = getChangedRanges(dir, "HEAD~1");
    expect(rangeChanged(ranges, join(dir, "b.ts"), 1, 3)).toBe(false);
    expect(rangeChanged(ranges, join(dir, "b.ts"), 4, 6)).toBe(false);
  });

  it("a brand-new file's full range is reported as changed", () => {
    const ranges = getChangedRanges(dir, "HEAD~1");
    expect(rangeChanged(ranges, join(dir, "sub", "new.ts"), 1, 2)).toBe(true);
  });

  it("throws a friendly error when ref does not resolve", () => {
    expect(() => getChangedRanges(dir, "not-a-real-ref")).toThrow(/git diff/);
  });

  it("returns empty ranges when nothing changed (diff against HEAD)", () => {
    const ranges = getChangedRanges(dir, "HEAD");
    expect(ranges.size).toBe(0);
  });
});

describe("getWorkingTreeChanges", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "brainblast-worktree-"));
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);

    writeFileSync(join(dir, "a.ts"), "export function a() {\n  return 1;\n}\n");
    writeFileSync(join(dir, "b.ts"), "export function b() {\n  return 2;\n}\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-m", "initial"]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns no changes when the working tree is clean", () => {
    const ranges = getWorkingTreeChanges(dir);
    expect(ranges.size).toBe(0);
  });

  it("picks up an uncommitted edit to a tracked file", () => {
    writeFileSync(join(dir, "a.ts"), "export function a() {\n  return 999;\n}\n");
    const ranges = getWorkingTreeChanges(dir);
    expect(fileChanged(ranges, join(dir, "a.ts"))).toBe(true);
    expect(fileChanged(ranges, join(dir, "b.ts"))).toBe(false);
    expect(rangeChanged(ranges, join(dir, "a.ts"), 2, 2)).toBe(true);
    // revert for the next test
    writeFileSync(join(dir, "a.ts"), "export function a() {\n  return 1;\n}\n");
  });

  it("treats a brand-new untracked file as fully changed", () => {
    writeFileSync(join(dir, "c.ts"), "export function c() {\n  return 3;\n}\n");
    const ranges = getWorkingTreeChanges(dir);
    expect(fileChanged(ranges, join(dir, "c.ts"))).toBe(true);
    expect(rangeChanged(ranges, join(dir, "c.ts"), 1, 3)).toBe(true);
    rmSync(join(dir, "c.ts"));
  });
});
