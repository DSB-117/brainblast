// HiveMind outbreak alerts — the hive acting proactively.
//
// Every sync knows exactly which VTIs are NEW to this machine; every linked
// repo carries its dependency index. Cross the two and the hive can say, the
// moment a trap lands: "this newly-proven CRITICAL in `cookie-session` affects
// repos X and Y" — before any agent opens either repo. Pure: records + repos
// in, outbreaks out.

import type { CorpusVti } from "../corpus.ts";
import { matchDep } from "./brief.ts";
import type { HiveRepo } from "./store.ts";

export interface OutbreakHit {
  name: string;
  path: string;
  dep: string; // the dependency in that repo the trap binds to
}

export interface Outbreak {
  trapId: string;
  title?: string;
  severity: string;
  class: string;
  sdkName: string;
  capturedAt?: string;
  affected: OutbreakHit[];
}

const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export interface OutbreakOptions {
  // Alert threshold: this severity and above. Default high — an outbreak
  // interrupt should mean something.
  minSeverity?: "critical" | "high" | "medium" | "low";
}

export function detectOutbreaks(newVtis: CorpusVti[], repos: HiveRepo[], opts: OutbreakOptions = {}): Outbreak[] {
  const minSev = SEVERITY_ORDER[opts.minSeverity ?? "high"];
  const out: Outbreak[] = [];
  for (const v of newVtis) {
    if (!(v.redGreenProof?.red === true && v.redGreenProof?.green === true)) continue;
    if ((SEVERITY_ORDER[v.severity] ?? 0) < minSev) continue;
    const affected: OutbreakHit[] = [];
    for (const repo of repos) {
      const dep = matchDep(repo.deps, v.sdk?.name ?? "");
      if (dep) affected.push({ name: repo.name, path: repo.path, dep });
    }
    if (affected.length === 0) continue;
    out.push({
      trapId: v.trapId,
      title: typeof (v as any).title === "string" ? (v as any).title : undefined,
      severity: v.severity,
      class: v.class,
      sdkName: v.sdk?.name ?? "unknown",
      capturedAt: typeof v.capturedAt === "string" ? v.capturedAt : undefined,
      affected,
    });
  }
  // Worst first.
  out.sort((a, b) => (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0) || b.affected.length - a.affected.length);
  return out;
}

export function renderOutbreakText(o: Outbreak): string {
  const repos = o.affected.map((a) => `${a.name} (${a.dep})`).join(", ");
  return `⚠ OUTBREAK [${o.severity.toUpperCase()}] ${o.trapId} in ${o.sdkName} — affects linked repo${o.affected.length === 1 ? "" : "s"}: ${repos}. Run \`brainblast hive brief --sdk ${o.sdkName}\` there, then \`npx brainblast .\` to check for it.`;
}
