// HiveMind dashboard — a read-only view over a space's shared experience.
//
// The federation layer moves fix events between machines; this turns the pile
// into a picture a team lead actually reads: who is fixing what, which traps
// recur across the org, which SDKs and repos generate the most rework, and how
// that's trending. Pure aggregation (events in, stats out) so it renders the
// same from a local shared log or a server-side pull — and, crucially, the
// space id (a secret) never has to leave the machine to produce it.

import type { ExperienceEvent } from "./experience.ts";

export interface RankedCount {
  key: string;
  count: number;
}

export interface DashboardStats {
  totalEvents: number;
  contributors: number; // distinct hive addresses (authors) — "local" for un-authored local events
  repos: number;
  rules: number;
  sdksTouched: number;
  byRule: RankedCount[]; // most-recurring traps first — the org's real weak spots
  byClass: RankedCount[];
  byRepo: RankedCount[];
  byContributor: RankedCount[];
  byDay: RankedCount[]; // fix events per day (YYYY-MM-DD), chronological
  firstAt: string | null;
  lastAt: string | null;
}

// A rule id like "parabol-algorithm-none" is a per-source-repo INSTANCE of a
// pattern; group by the trailing pattern token so the dashboard counts
// "algorithm-none" once, not once per repo the fleet found it in. Falls back to
// the whole id when there's no recognizable pattern suffix.
function patternOf(ruleId: string): string {
  const known = [
    "algorithm-none",
    "decode-missing-verify",
    "ignoreexpiration-true",
    "reject-unauthorized-false",
    "cookie-secure-false",
    "cookie-samesite-none",
    "saveuninitialized-true",
  ];
  const lower = ruleId.toLowerCase();
  for (const p of known) if (lower.endsWith(p)) return p;
  return ruleId;
}

function rank(map: Map<string, number>, limit = 20): RankedCount[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export function buildDashboard(events: ExperienceEvent[]): DashboardStats {
  const byRule = new Map<string, number>();
  const byClassInfer = new Map<string, number>();
  const byRepo = new Map<string, number>();
  const byContributor = new Map<string, number>();
  const byDay = new Map<string, number>();
  const authors = new Set<string>();
  const repos = new Set<string>();
  const rules = new Set<string>();
  const sdks = new Set<string>();
  let firstAt: string | null = null;
  let lastAt: string | null = null;

  for (const e of events) {
    const pattern = patternOf(e.ruleId);
    byRule.set(pattern, (byRule.get(pattern) ?? 0) + 1);
    rules.add(e.ruleId);
    byRepo.set(e.repoName, (byRepo.get(e.repoName) ?? 0) + 1);
    repos.add(e.repoName);
    const who = e.author ?? "local";
    byContributor.set(who, (byContributor.get(who) ?? 0) + 1);
    authors.add(who);
    const day = (e.fixedAt || "").slice(0, 10);
    if (day) byDay.set(day, (byDay.get(day) ?? 0) + 1);
    // The rule id's leading token is usually the SDK/source; classify loosely.
    const sdkGuess = e.ruleId.split("-")[0];
    if (sdkGuess) sdks.add(sdkGuess);
    byClassInfer.set(pattern, (byClassInfer.get(pattern) ?? 0) + 1);
    if (day) {
      if (!firstAt || day < firstAt) firstAt = day;
      if (!lastAt || day > lastAt) lastAt = day;
    }
  }

  return {
    totalEvents: events.length,
    contributors: authors.size,
    repos: repos.size,
    rules: rules.size,
    sdksTouched: sdks.size,
    byRule: rank(byRule),
    byClass: rank(byClassInfer),
    byRepo: rank(byRepo),
    byContributor: rank(byContributor),
    byDay: [...byDay.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key)),
    firstAt,
    lastAt,
  };
}

function bar(count: number, max: number, width = 24): string {
  if (max <= 0) return "";
  return "█".repeat(Math.max(1, Math.round((count / max) * width)));
}

export function renderDashboardText(d: DashboardStats, label = "HiveMind"): string {
  const lines: string[] = [];
  lines.push(`${label} dashboard — ${d.totalEvents} fix event${d.totalEvents === 1 ? "" : "s"} from ${d.contributors} contributor${d.contributors === 1 ? "" : "s"} across ${d.repos} repo${d.repos === 1 ? "" : "s"}`);
  if (d.firstAt) lines.push(`  span: ${d.firstAt} → ${d.lastAt}   ·   ${d.rules} distinct rules, ${d.sdksTouched} SDKs`);
  if (d.totalEvents === 0) {
    lines.push("  (no shared experience yet — join a space and `brainblast hive sync`)");
    return lines.join("\n");
  }
  const section = (title: string, rows: RankedCount[]) => {
    if (!rows.length) return;
    lines.push("");
    lines.push(`  ${title}`);
    const max = rows[0].count;
    for (const r of rows.slice(0, 10)) lines.push(`    ${String(r.count).padStart(4)}  ${bar(r.count, max)} ${r.key}`);
  };
  section("Most-recurring traps (the org's real weak spots)", d.byRule);
  section("By repo", d.byRepo);
  section("By contributor", d.byContributor);
  if (d.byDay.length > 1) {
    lines.push("");
    lines.push("  Activity by day");
    const max = Math.max(...d.byDay.map((x) => x.count));
    for (const r of d.byDay.slice(-14)) lines.push(`    ${r.key}  ${bar(r.count, max, 30)} ${r.count}`);
  }
  return lines.join("\n");
}

// A self-contained HTML page (no external assets) for `--html` export — the
// "team dashboard" as a shareable artifact.
export function renderDashboardHtml(d: DashboardStats, label = "HiveMind"): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const rowsHtml = (rows: RankedCount[]) => {
    const max = rows[0]?.count ?? 1;
    return rows
      .slice(0, 15)
      .map(
        (r) =>
          `<tr><td class="c">${r.count}</td><td class="b"><span style="width:${Math.round((r.count / max) * 100)}%"></span></td><td>${esc(r.key)}</td></tr>`,
      )
      .join("");
  };
  const card = (title: string, rows: RankedCount[]) =>
    rows.length ? `<section><h2>${esc(title)}</h2><table>${rowsHtml(rows)}</table></section>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(label)} dashboard</title>
<style>
:root{--fg:#e6e6e6;--dim:#9aa;--acc:#5b8cff;--bg:#0d1117;--card:#161b22}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:32px}
h1{font-size:20px;margin:0 0 4px}.sub{color:var(--dim);margin-bottom:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px}
section{background:var(--card);border:1px solid #23282f;border-radius:10px;padding:16px}
h2{font-size:13px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em;margin:0 0 12px}
table{width:100%;border-collapse:collapse}td{padding:3px 6px;vertical-align:middle}
td.c{color:var(--acc);text-align:right;width:44px}td.b{width:38%}
td.b span{display:block;height:8px;background:var(--acc);border-radius:4px;min-width:3px;opacity:.7}
.stats{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:24px}.stat b{font-size:22px;color:var(--acc)}.stat span{color:var(--dim)}
</style></head><body>
<h1>${esc(label)} — shared experience dashboard</h1>
<div class="sub">${d.firstAt ? `${esc(d.firstAt)} → ${esc(d.lastAt ?? "")}` : "no activity yet"}</div>
<div class="stats">
  <div class="stat"><b>${d.totalEvents}</b> <span>fix events</span></div>
  <div class="stat"><b>${d.contributors}</b> <span>contributors</span></div>
  <div class="stat"><b>${d.repos}</b> <span>repos</span></div>
  <div class="stat"><b>${d.rules}</b> <span>distinct rules</span></div>
</div>
<div class="grid">
  ${card("Most-recurring traps", d.byRule)}
  ${card("By repo", d.byRepo)}
  ${card("By contributor", d.byContributor)}
  ${card("Activity by day", d.byDay.slice(-21))}
</div>
<div class="sub" style="margin-top:24px">Advisory context — every event is a RED→GREEN-proven fix. Generated by brainblast hive dashboard.</div>
</body></html>`;
}
