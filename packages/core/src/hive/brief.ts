// HiveMind briefing — the "more capable" half of the hive.
//
// Given a repo's dependency index and the hive's knowledge, assemble the
// pre-immunization an agent should carry BEFORE it writes integration code:
// the proven traps for exactly the SDKs this repo uses, ranked by how much
// they matter, budgeted to fit a context window rather than flood it.
//
// Pure: deps + VTIs in, brief out. Callers (CLI, MCP tool, CLAUDE.md
// injection) do the reading; renderers below produce the three surfaces.

import { scoreVti, type CorpusVti } from "../corpus.ts";
import { personallyFixedRules, type ExperienceEvent } from "./experience.ts";

export interface BriefEntry {
  trapId: string;
  title?: string;
  matchedDep: string; // the repo dependency this trap binds to
  sdkName: string;
  sdkVersion?: string | null;
  severity: string;
  class: string;
  score: number;
  corroborationCount: number;
  proofMethod?: string;
  capturedAt?: string;
  sourceUrls: string[];
  // The teach-the-agent payload (present when the hive holds fixtures —
  // i.e. synced at a paid tier or generated locally).
  avoid?: string; // vulnerable snippet, trimmed
  instead?: string; // fixed snippet, trimmed
  // Set when an agent on this machine already fixed this exact trap somewhere:
  // the strongest possible signal that it WILL be shipped here without a brief.
  personallyFixed?: { repoName: string; fixedAt: string };
}

export interface HiveBrief {
  depCount: number;
  matchedDeps: string[]; // deps with at least one verified trap on file
  entries: BriefEntry[];
  totalMatched: number; // before the budget cap
  truncated: number; // entries dropped by the cap
  // Honesty invariant, rendered on every surface: deps without a match have
  // no verified trap ON FILE — that is not a safety claim.
  unmatchedDepCount: number;
}

export interface BriefOptions {
  deps: Record<string, string>;
  vtis: CorpusVti[];
  sdk?: string; // focus the brief on one dependency
  maxRecords?: number; // default 12
  maxSnippetChars?: number; // default 400 per snippet
  minSeverity?: "critical" | "high" | "medium" | "low";
  // The machine's cross-repo fix history (hive experience log): traps an agent
  // here already shipped-and-fixed rank above everything else.
  experience?: ExperienceEvent[];
}

const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function trimSnippet(snippet: unknown, maxChars: number): string | undefined {
  if (typeof snippet !== "string" || !snippet.trim()) return undefined;
  const t = snippet.trim();
  return t.length <= maxChars ? t : t.slice(0, maxChars) + "\n… (trimmed)";
}

// A trap binds to a dependency when the VTI's SDK name IS that package
// (case-insensitive). Deliberately exact, not substring: a brief that
// pattern-matches "jose" into "objection" teaches the agent wrong things.
export function matchDep(deps: Record<string, string>, sdkName: string): string | undefined {
  const wanted = sdkName.toLowerCase();
  for (const dep of Object.keys(deps)) {
    if (dep.toLowerCase() === wanted) return dep;
  }
  return undefined;
}

export function assembleBrief(opts: BriefOptions): HiveBrief {
  const maxRecords = opts.maxRecords ?? 12;
  const maxSnippetChars = opts.maxSnippetChars ?? 400;
  const minSev = opts.minSeverity ? SEVERITY_ORDER[opts.minSeverity] : 1;

  const deps = opts.sdk
    ? Object.fromEntries(Object.entries(opts.deps).filter(([k]) => k.toLowerCase() === opts.sdk!.toLowerCase()))
    : opts.deps;

  const fixedByMe = personallyFixedRules(opts.experience ?? []);
  const matched: BriefEntry[] = [];
  const matchedDeps = new Set<string>();
  for (const v of opts.vtis) {
    // Only proven knowledge enters a brief — same bar as the feed.
    if (!(v.redGreenProof?.red === true && v.redGreenProof?.green === true)) continue;
    if ((SEVERITY_ORDER[v.severity] ?? 0) < minSev) continue;
    const dep = matchDep(deps, v.sdk?.name ?? "");
    if (!dep) continue;
    matchedDeps.add(dep);
    const personal = fixedByMe.get(v.trapId);
    matched.push({
      ...(personal ? { personallyFixed: { repoName: personal.repoName, fixedAt: personal.fixedAt } } : {}),
      trapId: v.trapId,
      title: typeof (v as any).title === "string" ? (v as any).title : undefined,
      matchedDep: dep,
      sdkName: v.sdk?.name ?? "unknown",
      sdkVersion: v.sdk?.version ?? null,
      severity: v.severity,
      class: v.class,
      score: scoreVti(v),
      corroborationCount: Math.max(0, v.corroborationCount ?? 0),
      proofMethod: (v.redGreenProof as any)?.method,
      capturedAt: typeof v.capturedAt === "string" ? v.capturedAt : undefined,
      sourceUrls: Array.isArray((v as any).sourceUrls) ? (v as any).sourceUrls.filter((u: unknown) => typeof u === "string") : [],
      avoid: trimSnippet((v as any).vulnerable?.snippet, maxSnippetChars),
      instead: trimSnippet((v as any).fixed?.snippet, maxSnippetChars),
    });
  }

  // Rank: personally-shipped mistakes first (an agent here has already proven
  // it makes this one), then score (severity × proof × corroboration), then
  // severity, then freshest capture.
  matched.sort(
    (a, b) =>
      Number(Boolean(b.personallyFixed)) - Number(Boolean(a.personallyFixed)) ||
      b.score - a.score ||
      (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0) ||
      String(b.capturedAt ?? "").localeCompare(String(a.capturedAt ?? "")),
  );

  const entries = matched.slice(0, maxRecords);
  return {
    depCount: Object.keys(deps).length,
    matchedDeps: [...matchedDeps].sort(),
    entries,
    totalMatched: matched.length,
    truncated: matched.length - entries.length,
    unmatchedDepCount: Object.keys(deps).length - matchedDeps.size,
  };
}

const HONESTY_LINE =
  "No verified trap on file for the remaining dependencies — that means the hive has nothing proven for them, NOT that they are safe.";

function entryHeadline(e: BriefEntry): string {
  const corr = e.corroborationCount > 0 ? `, corroborated in ${e.corroborationCount} repo${e.corroborationCount === 1 ? "" : "s"}` : "";
  const proof = e.proofMethod ? ` (proof: ${e.proofMethod}${corr})` : corr ? ` (${corr.slice(2)})` : "";
  const personal = e.personallyFixed ? ` ⚑ already fixed once in ${e.personallyFixed.repoName} on ${e.personallyFixed.fixedAt} — do not ship it again` : "";
  return `[${e.severity.toUpperCase()}] ${e.trapId} — ${e.title ?? e.class}${proof}${personal}`;
}

export function renderBriefText(b: HiveBrief): string {
  const lines: string[] = [];
  if (b.entries.length === 0) {
    lines.push(`hive brief: no verified traps on file for any of this repo's ${b.depCount} dependencies.`);
    lines.push(HONESTY_LINE);
    return lines.join("\n");
  }
  lines.push(
    `hive brief: ${b.totalMatched} verified trap${b.totalMatched === 1 ? "" : "s"} match ${b.matchedDeps.length} of ${b.depCount} dependencies (${b.matchedDeps.join(", ")})`,
  );
  let lastDep = "";
  for (const e of b.entries) {
    if (e.matchedDep !== lastDep) {
      lines.push("");
      lines.push(`── ${e.matchedDep} ──`);
      lastDep = e.matchedDep;
    }
    lines.push(`  ${entryHeadline(e)}`);
    if (e.avoid) lines.push(`    avoid:   ${e.avoid.split("\n").join("\n             ")}`);
    if (e.instead) lines.push(`    instead: ${e.instead.split("\n").join("\n             ")}`);
    if (e.sourceUrls[0]) lines.push(`    source:  ${e.sourceUrls[0]}`);
  }
  if (b.truncated > 0) lines.push(`\n(${b.truncated} lower-ranked matches not shown — \`brainblast hive brief --limit ${b.totalMatched}\` for all)`);
  lines.push("");
  lines.push(HONESTY_LINE);
  return lines.join("\n");
}

// The markdown surface — what gets injected into CLAUDE.md / AGENTS.md so the
// NEXT agent session starts pre-immunized without asking.
export function renderBriefMarkdown(b: HiveBrief, meta: { syncedAt?: string | null; tier?: string | null } = {}): string {
  const lines: string[] = [];
  lines.push("## HiveMind briefing — verified traps for this repo's stack");
  lines.push("");
  const fresh = meta.syncedAt ? ` Hive last synced ${meta.syncedAt}${meta.tier ? ` (tier ${meta.tier})` : ""}.` : "";
  if (b.entries.length === 0) {
    lines.push(`No verified traps on file for this repo's ${b.depCount} dependencies.${fresh}`);
    lines.push("");
    lines.push(`> ${HONESTY_LINE}`);
    return lines.join("\n");
  }
  lines.push(
    `${b.totalMatched} RED→GREEN-proven trap${b.totalMatched === 1 ? "" : "s"} match this repo's dependencies.${fresh} Before writing integration code against a listed package, read its traps — each one is a mistake a real agent shipped or would ship.`,
  );
  let lastDep = "";
  for (const e of b.entries) {
    if (e.matchedDep !== lastDep) {
      lines.push("");
      lines.push(`### \`${e.matchedDep}\``);
      lastDep = e.matchedDep;
    }
    lines.push(`- **${entryHeadline(e)}**`);
    if (e.avoid) {
      lines.push(`  - avoid: \`${e.avoid.replace(/\s+/g, " ").slice(0, 200)}\``);
    }
    if (e.instead) {
      lines.push(`  - instead: \`${e.instead.replace(/\s+/g, " ").slice(0, 200)}\``);
    }
    if (e.sourceUrls[0]) lines.push(`  - source: ${e.sourceUrls[0]}`);
  }
  if (b.truncated > 0) lines.push(`\n_${b.truncated} lower-ranked matches held back for context budget — \`brainblast hive brief\` shows them._`);
  lines.push("");
  lines.push(`> ${HONESTY_LINE}`);
  return lines.join("\n");
}
