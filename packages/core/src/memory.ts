import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult, CheckResultKind, Precedent } from "./types.ts";

// Living memory: a per-repo record of what brainblast has found and fixed
// before, stored at <target>/.agent-research/memory.json. Two jobs:
//
// 1. Detect fail -> (pass | cant_tell) transitions between runs and record
//    them as fix events ("you fixed this exact webhook issue 2 weeks ago").
// 2. For *current* fails, surface a precedent when the same ruleId was
//    previously fixed in a different file — "this new file has the same gap
//    you already closed elsewhere."
//
// Pure-data, additive, no LLM: just a snapshot diff + lookup table.

interface MemorySnapshotEntry {
  ruleId: string;
  file: string;
  exportName: string;
  result: CheckResultKind;
  detail: string;
}

interface FixEvent {
  ruleId: string;
  file: string;
  exportName: string;
  fixedAt: string;
  detail: string;
}

export interface Memory {
  schemaVersion: string;
  lastRun: MemorySnapshotEntry[];
  fixHistory: FixEvent[];
}

const EMPTY_MEMORY: Memory = { schemaVersion: "1.0", lastRun: [], fixHistory: [] };

export function memoryPath(targetDir: string): string {
  return join(targetDir, ".agent-research", "memory.json");
}

export function loadMemory(targetDir: string): Memory {
  const p = memoryPath(targetDir);
  if (!existsSync(p)) return { ...EMPTY_MEMORY, lastRun: [], fixHistory: [] };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return {
      schemaVersion: parsed.schemaVersion ?? "1.0",
      lastRun: Array.isArray(parsed.lastRun) ? parsed.lastRun : [],
      fixHistory: Array.isArray(parsed.fixHistory) ? parsed.fixHistory : [],
    };
  } catch {
    return { ...EMPTY_MEMORY, lastRun: [], fixHistory: [] };
  }
}

export function saveMemory(targetDir: string, memory: Memory): void {
  mkdirSync(join(targetDir, ".agent-research"), { recursive: true });
  writeFileSync(memoryPath(targetDir), JSON.stringify(memory, null, 2));
}

const snapshotKey = (e: { ruleId: string; file: string; exportName: string }) =>
  `${e.ruleId}::${e.file}::${e.exportName}`;

// Lookup key for matching a *current* check against fix history precedents.
// Deliberately file-grained (not export-grained): "this file has the same
// gap a sibling file already closed" is the useful signal, regardless of
// which exported function it lives on.
export function precedentKey(c: { ruleId: string; file: string }): string {
  return `${c.ruleId}::${c.file}`;
}

export function updateMemory(
  memory: Memory,
  checks: CheckResult[],
  now: Date = new Date(),
): { memory: Memory; precedents: Map<string, Precedent> } {
  const prevByKey = new Map(memory.lastRun.map((e) => [snapshotKey(e), e]));
  const fixedAt = now.toISOString().slice(0, 10);

  const newFixEvents: FixEvent[] = [];
  for (const c of checks) {
    const prev = prevByKey.get(snapshotKey(c));
    if (prev?.result === "fail" && c.result !== "fail") {
      newFixEvents.push({
        ruleId: c.ruleId,
        file: c.file,
        exportName: c.exportName,
        fixedAt,
        detail: prev.detail,
      });
    }
  }

  const fixHistory = [...memory.fixHistory, ...newFixEvents];

  // For each current fail, find the most recent prior fix of the same rule
  // in a different file.
  const precedents = new Map<string, Precedent>();
  for (const c of checks) {
    if (c.result !== "fail") continue;
    const pk = precedentKey(c);
    if (precedents.has(pk)) continue;
    const matches = fixHistory
      .filter((e) => e.ruleId === c.ruleId && e.file !== c.file)
      .sort((a, b) => (a.fixedAt < b.fixedAt ? 1 : a.fixedAt > b.fixedAt ? -1 : 0));
    if (matches[0]) {
      precedents.set(pk, {
        file: matches[0].file,
        exportName: matches[0].exportName,
        fixedAt: matches[0].fixedAt,
        detail: matches[0].detail,
      });
    }
  }

  const lastRun: MemorySnapshotEntry[] = checks.map((c) => ({
    ruleId: c.ruleId,
    file: c.file,
    exportName: c.exportName,
    result: c.result,
    detail: c.detail,
  }));

  return { memory: { schemaVersion: "1.0", lastRun, fixHistory }, precedents };
}
