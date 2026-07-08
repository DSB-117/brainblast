// HiveMind experience — what makes the hive a hive, not a mirror.
//
// Every repo already keeps a living memory of its own fixes
// (.agent-research/memory.json). This module promotes those fix events into
// the machine-global experience log, so knowledge crosses repo boundaries:
// when a rule fails in repo B that an agent already fixed in repo A, the
// audit (and the write-time hook, and the brief) can say "you fixed this
// exact trap in repo A on <date>" — regardless of which agent did the fixing.
//
// Append-only JSONL, idempotent by event key, fail-open everywhere: a broken
// experience log must never break an audit.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, relative } from "node:path";
import type { Precedent } from "../types.ts";
import { hivePaths } from "./store.ts";

export interface ExperienceEvent {
  ruleId: string;
  repoPath: string;
  repoName: string;
  file: string; // repo-relative where possible
  exportName: string;
  fixedAt: string;
  detail: string;
}

const eventKey = (e: ExperienceEvent) => `${e.ruleId}::${e.repoPath}::${e.file}::${e.exportName}::${e.fixedAt}`;

export function loadExperience(root: string): ExperienceEvent[] {
  const p = hivePaths(root).experienceLog;
  if (!existsSync(p)) return [];
  const out: ExperienceEvent[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed.ruleId === "string" && typeof parsed.repoPath === "string") out.push(parsed);
    } catch {
      // tolerated — a bad line never breaks recall
    }
  }
  return out;
}

export interface RecordResult {
  added: number;
  total: number;
}

// Promote a repo's new fix events into the global log. Called by the audit
// after each full run with whatever fixHistory grew by — dedup by key, so
// re-promotion (or two agents auditing the same repo) is harmless.
export function recordFixEvents(
  root: string,
  repo: { path: string; name?: string },
  events: { ruleId: string; file: string; exportName: string; fixedAt: string; detail: string }[],
): RecordResult {
  const existing = loadExperience(root);
  if (events.length === 0) return { added: 0, total: existing.length };
  const seen = new Set(existing.map(eventKey));
  const repoName = repo.name || basename(repo.path);

  const fresh: ExperienceEvent[] = [];
  for (const e of events) {
    const file = isAbsolute(e.file) && e.file.startsWith(repo.path) ? relative(repo.path, e.file) : e.file;
    const event: ExperienceEvent = {
      ruleId: e.ruleId,
      repoPath: repo.path,
      repoName,
      file,
      exportName: e.exportName,
      fixedAt: e.fixedAt,
      detail: e.detail,
    };
    if (seen.has(eventKey(event))) continue;
    seen.add(eventKey(event));
    fresh.push(event);
  }
  if (fresh.length) {
    const paths = hivePaths(root);
    mkdirSync(root, { recursive: true });
    appendFileSync(paths.experienceLog, fresh.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  return { added: fresh.length, total: existing.length + fresh.length };
}

// For a failing rule in the CURRENT repo, the most recent fix of the same rule
// in a DIFFERENT repo. Local (same-repo) precedents are the caller's job and
// always win — this only answers when the knowledge lives elsewhere.
export function crossRepoPrecedent(
  experience: ExperienceEvent[],
  ruleId: string,
  currentRepoPath: string,
): Precedent | undefined {
  const matches = experience
    .filter((e) => e.ruleId === ruleId && e.repoPath !== currentRepoPath)
    .sort((a, b) => (a.fixedAt < b.fixedAt ? 1 : a.fixedAt > b.fixedAt ? -1 : 0));
  const hit = matches[0];
  if (!hit) return undefined;
  return {
    // Precedent.file renders in reports — carry the repo so "elsewhere" is
    // unambiguous when the file lives in another repo.
    file: `${hit.repoName}: ${hit.file}`,
    exportName: hit.exportName,
    fixedAt: hit.fixedAt,
    detail: hit.detail,
  };
}

// The set of rule ids this machine's agents have personally fixed somewhere —
// the brief uses it to rank "you have shipped this exact mistake before"
// above everything else.
export function personallyFixedRules(experience: ExperienceEvent[]): Map<string, ExperienceEvent> {
  const byRule = new Map<string, ExperienceEvent>();
  for (const e of experience) {
    const held = byRule.get(e.ruleId);
    if (!held || e.fixedAt > held.fixedAt) byRule.set(e.ruleId, e);
  }
  return byRule;
}
