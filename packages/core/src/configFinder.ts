import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { walkAllFiles } from "./walk.ts";
import type { ConfigCandidate, Rule } from "./types.ts";

// Whether `file` (absolute path, under `targetDir`) is git-ignored. Used as a
// proxy for "not committed to source control" — the safe state for files like
// `.env` that hold real secrets. If `targetDir` isn't a git work tree (or git
// isn't available), we can't confirm it's protected, so we conservatively
// treat the file as tracked/committed.
function isGitIgnored(targetDir: string, rel: string): boolean {
  try {
    // Exit code 0 = ignored, 1 = not ignored. `execFileSync` throws on
    // non-zero exit, so distinguish "not ignored" from "git unavailable".
    execFileSync("git", ["check-ignore", "-q", "--", rel], { cwd: targetDir, stdio: "ignore" });
    return true;
  } catch (e: any) {
    if (typeof e?.status === "number") return false; // git ran, file not ignored
    return false; // git unavailable / not a repo — conservatively "not protected"
  }
}

// Generic candidate detection for whole-file config/env audits, driven by
// `rule.detect.filePatterns` (regexes matched against the path relative to
// `targetDir`, with POSIX separators).
export function findConfigCandidates(targetDir: string, rule: Rule): ConfigCandidate[] {
  const patterns = (rule.detect.filePatterns ?? []).map((p) => new RegExp(p));
  if (patterns.length === 0) return [];

  const files = walkAllFiles(targetDir);
  const out: ConfigCandidate[] = [];

  for (const file of files) {
    const rel = relative(targetDir, file).split(sep).join("/");
    if (!patterns.some((re) => re.test(rel))) continue;

    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue; // unreadable (binary, permissions, etc.)
    }

    out.push({
      filePath: file,
      content,
      tracked: !isGitIgnored(targetDir, rel),
    });
  }
  return out;
}
