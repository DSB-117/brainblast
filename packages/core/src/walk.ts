import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const SKIP_DIRS = new Set(["node_modules", ".git", ".gen", "dist", ".next", ".agent-research"]);

// A directory a normal scan has no business entering, and that macOS/Linux
// commonly refuse read access to even for the owning user (e.g. a sandboxed
// process) — walking into one throws EPERM/EACCES uncaught otherwise.
const SYSTEM_SKIP_DIRS = new Set([".Trash", ".Trashes", ".Spotlight-V100", ".fseventsd", ".DocumentRevisions-V100", ".TemporaryItems"]);

// Collect candidate .ts source files, skipping deps, vcs, and generated/test files.
export function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || SYSTEM_SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

// Collect every file regardless of extension, for config/env auditing
// (.env*, next.config.*, vercel.json, etc.). Same skip-list as walk().
export function walkAllFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || SYSTEM_SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkAllFiles(p, out);
    else out.push(p);
  }
  return out;
}
