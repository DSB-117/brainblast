import { execFileSync } from "node:child_process";
import { join } from "node:path";

// Diff-aware scanning support: maps each changed file (absolute path) to the
// line ranges (1-based, inclusive) that are new/modified relative to `ref`.
export type ChangedRanges = Map<string, Array<[number, number]>>;

// Run `git diff --unified=0 <ref>` from `targetDir` and parse the unified-diff
// hunk headers into per-file changed line ranges (in the *new* file).
// Pure deletions (a hunk that adds zero lines) are skipped — there's no new
// code to audit. Throws if `ref` doesn't resolve or `targetDir` isn't inside
// a git work tree.
export function getChangedRanges(targetDir: string, ref: string): ChangedRanges {
  let out: string;
  try {
    out = execFileSync(
      "git",
      ["diff", "--unified=0", "--no-color", "--no-renames", "--diff-filter=ACMR", "--relative", ref, "--"],
      { cwd: targetDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e: any) {
    const stderr = e?.stderr?.toString?.() ?? e?.message ?? String(e);
    throw new Error(`brainblast: 'git diff ${ref}' failed: ${stderr.trim()}`);
  }

  const ranges: ChangedRanges = new Map();
  let currentFile: string | null = null;

  for (const line of out.split("\n")) {
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).trim();
      if (raw === "/dev/null") {
        currentFile = null;
        continue;
      }
      const rel = raw.startsWith("b/") ? raw.slice(2) : raw;
      currentFile = join(targetDir, rel);
      continue;
    }
    if (line.startsWith("@@") && currentFile) {
      const m = line.match(/\+(\d+)(?:,(\d+))?/);
      if (!m) continue;
      const start = parseInt(m[1]!, 10);
      const count = m[2] !== undefined ? parseInt(m[2], 10) : 1;
      if (count === 0) continue; // pure deletion — nothing new to audit
      const end = start + count - 1;
      const arr = ranges.get(currentFile) ?? [];
      arr.push([start, end]);
      ranges.set(currentFile, arr);
    }
  }
  return ranges;
}

// True if `file` was touched at all (added/modified) relative to the diff base.
export function fileChanged(ranges: ChangedRanges, file: string): boolean {
  return ranges.has(file);
}

// True if [startLine, endLine] (1-based, inclusive) overlaps any changed
// range recorded for `file`.
export function rangeChanged(ranges: ChangedRanges, file: string, startLine: number, endLine: number): boolean {
  const fileRanges = ranges.get(file);
  if (!fileRanges) return false;
  return fileRanges.some(([s, e]) => startLine <= e && endLine >= s);
}
