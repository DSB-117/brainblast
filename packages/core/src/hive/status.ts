// HiveMind status — one glance at the brain: how much it knows, how fresh it
// is, which repos it's protecting, and where the knowledge came from.

import { existsSync, readFileSync } from "node:fs";
import { loadPacksFromDir } from "../packs.ts";
import { hivePaths, loadCursor, loadHiveLot, loadRepos, type HiveCursor } from "./store.ts";
import { loadIdentity } from "./identity.ts";
import { loadSharedExperience } from "./experience.ts";
import { loadSpaces } from "./spaces.ts";

export interface HiveStatus {
  root: string;
  exists: boolean;
  vtiCount: number;
  provenCount: number;
  withFixtures: number; // records holding the trainable payload (paid-tier sync)
  classes: Record<string, number>;
  severities: Record<string, number>;
  sdkCount: number;
  newestCapturedAt: string | null;
  packCount: number;
  ruleCount: number;
  packWarnings: string[];
  linkedRepos: { name: string; path: string; depCount: number }[];
  experienceCount: number; // this machine's own fix events
  sharedExperienceCount: number; // events federated in from spaces
  identity: string | null; // federated address (null until first use)
  spaces: { id: string; name?: string; cursor: number }[];
  cursor: HiveCursor;
}

export function hiveStatus(root: string): HiveStatus {
  const paths = hivePaths(root);
  const vtis = loadHiveLot(root);

  const classes: Record<string, number> = {};
  const severities: Record<string, number> = {};
  const sdks = new Set<string>();
  let newest: string | null = null;
  let provenCount = 0;
  let withFixtures = 0;
  for (const v of vtis) {
    classes[v.class] = (classes[v.class] ?? 0) + 1;
    severities[v.severity] = (severities[v.severity] ?? 0) + 1;
    if (v.sdk?.name) sdks.add(v.sdk.name);
    if (typeof v.capturedAt === "string" && (!newest || v.capturedAt > newest)) newest = v.capturedAt;
    if (v.redGreenProof?.red === true && v.redGreenProof?.green === true) provenCount++;
    if ((v as any).vulnerable?.snippet || (v as any).fixed?.snippet) withFixtures++;
  }

  let packCount = 0;
  let ruleCount = 0;
  const packWarnings: string[] = [];
  try {
    const packs = loadPacksFromDir(paths.packsDir);
    packCount = packs.length;
    ruleCount = packs.reduce((n, p) => n + p.rules.length, 0);
  } catch (e: any) {
    packWarnings.push(`pack mirror unreadable: ${e?.message ?? String(e)}`);
  }

  let experienceCount = 0;
  if (existsSync(paths.experienceLog)) {
    experienceCount = readFileSync(paths.experienceLog, "utf8")
      .split("\n")
      .filter((l) => l.trim()).length;
  }

  const repos = loadRepos(root);
  const identity = loadIdentity(root);
  const spaces = loadSpaces(root);
  return {
    root,
    exists: existsSync(root),
    vtiCount: vtis.length,
    provenCount,
    withFixtures,
    classes,
    severities,
    sdkCount: sdks.size,
    newestCapturedAt: newest,
    packCount,
    ruleCount,
    packWarnings,
    linkedRepos: repos.repos.map((r) => ({ name: r.name, path: r.path, depCount: Object.keys(r.deps).length })),
    experienceCount,
    sharedExperienceCount: loadSharedExperience(root).length,
    identity: identity?.address ?? null,
    spaces: spaces.spaces.map((s) => ({ id: s.id, ...(s.name ? { name: s.name } : {}), cursor: s.cursor })),
    cursor: loadCursor(root),
  };
}

function ago(iso: string | null, nowIso: string): string {
  if (!iso) return "never";
  const ms = Date.parse(nowIso) - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function renderHiveStatusText(s: HiveStatus, nowIso: string = new Date().toISOString()): string {
  const lines: string[] = [];
  lines.push(`HiveMind @ ${s.root}`);
  if (!s.exists) {
    lines.push("  (empty — run `brainblast hive sync` to grow a brain)");
    return lines.join("\n");
  }
  const sev = ["critical", "high", "medium", "low"]
    .filter((k) => s.severities[k])
    .map((k) => `${s.severities[k]} ${k}`)
    .join(", ");
  lines.push(`  knowledge   ${s.vtiCount} VTIs (${s.provenCount} proven, ${s.withFixtures} with fixtures) across ${s.sdkCount} SDKs${sev ? ` — ${sev}` : ""}`);
  const classes = Object.entries(s.classes)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  if (classes) lines.push(`  classes     ${classes}`);
  lines.push(`  enforcement ${s.packCount} packs / ${s.ruleCount} rules${s.cursor.packsSha ? ` @ ${s.cursor.packsSha.slice(0, 12)} (${ago(s.cursor.packsSyncedAt, nowIso)})` : " (not yet synced)"}`);
  lines.push(`  freshness   feed synced ${ago(s.cursor.lastSyncAt, nowIso)}${s.cursor.tier ? ` at tier ${s.cursor.tier}` : ""}${s.newestCapturedAt ? `, newest trap captured ${ago(s.newestCapturedAt, nowIso)}` : ""}`);
  lines.push(`  experience  ${s.experienceCount} local fix events + ${s.sharedExperienceCount} federated from the swarm`);
  if (s.spaces.length) {
    lines.push(`  federation  ${s.identity ? `identity ${s.identity.slice(0, 12)}…, ` : ""}${s.spaces.length} space${s.spaces.length === 1 ? "" : "s"}: ${s.spaces.map((sp) => sp.name ?? `${sp.id.slice(0, 12)}…`).join(", ")}`);
  } else {
    lines.push("  federation  no spaces — `brainblast hive space create` links your machines (or team)");
  }
  if (s.linkedRepos.length) {
    lines.push(`  protecting  ${s.linkedRepos.length} linked repo${s.linkedRepos.length === 1 ? "" : "s"}:`);
    for (const r of s.linkedRepos) lines.push(`    ${r.name}  (${r.depCount} deps)  ${r.path}`);
  } else {
    lines.push("  protecting  no linked repos — run `brainblast hive link` inside a repo");
  }
  for (const w of s.packWarnings) lines.push(`  ⚠ ${w}`);
  return lines.join("\n");
}
