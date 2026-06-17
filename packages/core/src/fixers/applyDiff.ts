import { readFileSync, writeFileSync } from "node:fs";

// Parses a unified-diff hunk produced by `buildDiff` (diffUtil.ts): a single
// hunk, single file, absolute paths via "+++ b<path>".
export interface ParsedDiff {
  filePath: string;
  oldStart: number;
  oldCount: number;
  newLines: string[];
}

export function parseDiff(diff: string): ParsedDiff {
  const lines = diff.split("\n");
  const fileLine = lines.find((l) => l.startsWith("+++ b"));
  if (!fileLine) throw new Error("parseDiff: no '+++ b<path>' line found");
  const filePath = fileLine.slice("+++ b".length);

  const hunkLine = lines.find((l) => l.startsWith("@@"));
  if (!hunkLine) throw new Error("parseDiff: no hunk header found");
  const m = hunkLine.match(/^@@ -(\d+),(\d+) \+\d+,\d+ @@/);
  if (!m) throw new Error(`parseDiff: unrecognized hunk header '${hunkLine}'`);
  const oldStart = Number(m[1]);
  const oldCount = Number(m[2]);

  const newLines = lines
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));

  return { filePath, oldStart, oldCount, newLines };
}

// Applies a single-hunk diff (as produced by buildDiff) to the file on disk.
// Returns false (no-op) if the file's current content at that range no longer
// matches what the diff expects to remove (stale diff — e.g. file already
// edited by another applied fix).
export function applyDiffToFile(diff: string): boolean {
  const { filePath, oldStart, oldCount, newLines } = parseDiff(diff);
  const content = readFileSync(filePath, "utf8");
  const fileLines = content.split("\n");

  const removedLines = diff
    .split("\n")
    .filter((l) => l.startsWith("-") && !l.startsWith("---"))
    .map((l) => l.slice(1));

  const actual = fileLines.slice(oldStart - 1, oldStart - 1 + oldCount);
  if (JSON.stringify(actual) !== JSON.stringify(removedLines)) return false;

  fileLines.splice(oldStart - 1, oldCount, ...newLines);
  writeFileSync(filePath, fileLines.join("\n"));
  return true;
}
