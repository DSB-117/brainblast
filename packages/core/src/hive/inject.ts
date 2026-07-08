// HiveMind session injection — put the briefing where the NEXT agent session
// already looks: the repo's agent-instructions file (CLAUDE.md, or AGENTS.md
// for Codex-style agents). Same discipline as the research report's pointer:
// an idempotent, marker-delimited, reversible block — refreshing replaces it
// in place, removal restores the file, and hand-written content is never
// touched.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HIVE_BLOCK_BEGIN = "<!-- BRAINBLAST:HIVE:BEGIN — auto-generated; refresh with `brainblast hive brief --inject` -->";
export const HIVE_BLOCK_END = "<!-- BRAINBLAST:HIVE:END -->";

// Prefer whichever instruction file the repo already has; a repo with neither
// gets a CLAUDE.md (the most widely read of the conventions).
export function agentInstructionFile(repoDir: string): string {
  const claude = join(repoDir, "CLAUDE.md");
  const agents = join(repoDir, "AGENTS.md");
  if (existsSync(claude)) return claude;
  if (existsSync(agents)) return agents;
  return claude;
}

export type InjectAction = "created" | "updated" | "unchanged";

export function injectBlock(filePath: string, blockBody: string): InjectAction {
  const block = `${HIVE_BLOCK_BEGIN}\n${blockBody.trim()}\n${HIVE_BLOCK_END}`;
  if (!existsSync(filePath)) {
    writeFileSync(filePath, block + "\n");
    return "created";
  }
  const current = readFileSync(filePath, "utf8");
  const begin = current.indexOf(HIVE_BLOCK_BEGIN);
  const end = current.indexOf(HIVE_BLOCK_END);
  if (begin >= 0 && end > begin) {
    const next = current.slice(0, begin) + block + current.slice(end + HIVE_BLOCK_END.length);
    if (next === current) return "unchanged";
    writeFileSync(filePath, next);
    return "updated";
  }
  const sep = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(filePath, current + sep + block + "\n");
  return "updated";
}

export function removeBlock(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const current = readFileSync(filePath, "utf8");
  const begin = current.indexOf(HIVE_BLOCK_BEGIN);
  const end = current.indexOf(HIVE_BLOCK_END);
  if (begin < 0 || end <= begin) return false;
  let next = current.slice(0, begin) + current.slice(end + HIVE_BLOCK_END.length);
  next = next.replace(/\n{3,}/g, "\n\n");
  if (!next.trim()) {
    // The block was the whole file (we created it) — leave an empty file
    // rather than deleting something the user may have added to git.
    writeFileSync(filePath, "");
    return true;
  }
  writeFileSync(filePath, next);
  return true;
}
