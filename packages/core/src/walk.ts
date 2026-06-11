import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", ".gen", "dist", ".next", ".agent-research"]);

// Collect candidate .ts source files, skipping deps, vcs, and generated/test files.
export function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

// Collect every file regardless of extension, for config/env auditing
// (.env*, next.config.*, vercel.json, etc.). Same skip-list as walk().
export function walkAllFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walkAllFiles(p, out);
    else out.push(p);
  }
  return out;
}
