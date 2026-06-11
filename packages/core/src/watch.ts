import { watch as fsWatch } from "node:fs";
import { audit } from "./audit.ts";
import { getWorkingTreeChanges } from "./gitDiff.ts";
import { resolveRules } from "./resolveRules.ts";
import { SKIP_DIRS } from "./walk.ts";
import type { Rule } from "./types.ts";

// Structured events emitted as NDJSON (one JSON object per line) on stdout.
// Daemon Terminal (or any consumer) tails this process's stdout — no bespoke
// protocol, no report.json polling.
export type WatchEvent =
  | { type: "watch_started"; targetDir: string }
  | { type: "scan_error"; message: string }
  | {
      type: "finding";
      ruleId: string;
      severity: string;
      result: "fail" | "cant_tell";
      file: string;
      line: number;
      detail: string;
      fix?: unknown;
    }
  | { type: "scan_complete"; filesChanged: number; findings: number; durationMs: number };

export interface WatchOptions {
  debounceMs?: number;
  emit?: (event: WatchEvent) => void;
}

// Run one incremental scan of the working tree (uncommitted changes vs HEAD,
// plus untracked files) and emit findings + a summary event. Exported
// separately from the file watcher so it can be tested/triggered directly.
export function runIncrementalScan(targetDir: string, rules: Rule[], emit: (e: WatchEvent) => void): void {
  const start = Date.now();
  let changedRanges;
  try {
    changedRanges = getWorkingTreeChanges(targetDir);
  } catch (e: any) {
    emit({ type: "scan_error", message: e?.message ?? String(e) });
    return;
  }
  if (changedRanges.size === 0) {
    emit({ type: "scan_complete", filesChanged: 0, findings: 0, durationMs: Date.now() - start });
    return;
  }

  const { checks } = audit(targetDir, rules, changedRanges);
  let findings = 0;
  for (const c of checks) {
    if (c.result === "pass") continue;
    findings++;
    emit({
      type: "finding",
      ruleId: c.ruleId,
      severity: c.severity,
      result: c.result,
      file: c.file,
      line: c.line,
      detail: c.detail,
      ...(c.fix ? { fix: c.fix } : {}),
    });
  }
  emit({ type: "scan_complete", filesChanged: changedRanges.size, findings, durationMs: Date.now() - start });
}

// Start the file-watch daemon. Debounces saves and re-runs an incremental
// scan (working tree vs HEAD) on the audited project. Returns a handle to
// stop watching.
export function startWatch(targetDir: string, opts: WatchOptions = {}): { close: () => void } {
  const debounceMs = opts.debounceMs ?? 300;
  const emit = opts.emit ?? ((e: WatchEvent) => process.stdout.write(JSON.stringify(e) + "\n"));
  const rules = resolveRules(targetDir);

  let timer: NodeJS.Timeout | undefined;
  const scheduleScan = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => runIncrementalScan(targetDir, rules, emit), debounceMs);
  };

  const watcher = fsWatch(targetDir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const parts = filename.split(/[\\/]/);
    if (parts.some((p) => SKIP_DIRS.has(p))) return;
    scheduleScan();
  });

  emit({ type: "watch_started", targetDir });

  return {
    close: () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}
