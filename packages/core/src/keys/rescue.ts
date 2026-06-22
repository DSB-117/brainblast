// Keyguard — Capability 5: rescue. Honest, Solana-aware incident response for
// the moment a dev realizes something might be gone.
//
// Most tools pretend everything is recoverable. Brainblast's whole brand is
// telling you the irreversible truth early — `rescue` does it at the worst
// moment: what's gone, what the Vault can bring back, what's lost forever, and
// (best-effort) which command did it.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { listLatestByPath, statusForPath } from "./vault.ts";
import { scanSecrets } from "./scan.ts";

export type RescueState =
  | "recoverable-missing" // gone from disk, but the Vault has it
  | "modified" // present, but differs from the last snapshot (older version in Vault)
  | "safe" // present and backed up
  | "at-risk-unbacked"; // present, high-tier, and NOT backed up

export interface RescueItem {
  path: string;
  state: RescueState;
  pubkey?: string;
  detail: string;
}

export interface RescueReport {
  items: RescueItem[];
  recoverableMissing: number;
  unbackedAtRisk: number;
  culprits: string[]; // recent destructive commands from shell history
}

function sha256File(p: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(p)).digest("hex");
  } catch {
    return null;
  }
}

// Best-effort: surface recent destructive commands from shell history so the dev
// can see what likely did it. Read-only, never executed.
function findCulprits(): string[] {
  const files = [join(homedir(), ".zsh_history"), join(homedir(), ".bash_history")];
  const re = /\b(rm\s+-[a-z]*[rf]|git\s+clean|shred\b|truncate\b|find\b.*-delete)/;
  const hits: string[] = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    let text: string;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      // zsh extended history: ": 1700000000:0;the command"
      const line = raw.replace(/^: \d+:\d+;/, "").trim();
      if (line && re.test(line) && !hits.includes(line)) hits.push(line);
    }
  }
  return hits.slice(-8);
}

export function rescue(dir = ".", opts: { includeHistory?: boolean } = {}): RescueReport {
  const items: RescueItem[] = [];

  // 1. What the Vault knows about — is each backed-up secret still on disk?
  for (const e of listLatestByPath()) {
    if (!existsSync(e.path)) {
      items.push({
        path: e.path,
        pubkey: e.pubkey,
        state: "recoverable-missing",
        detail: `Gone from disk but backed up (snapshot ${e.ts}). Restore: brainblast vault restore ${e.path}`,
      });
      continue;
    }
    const cur = sha256File(e.path);
    const st = statusForPath(e.path);
    if (cur && !st.currentMatches) {
      items.push({
        path: e.path,
        pubkey: e.pubkey,
        state: "modified",
        detail: `On disk but changed since the last snapshot — the Vault holds an earlier version (${e.ts}).`,
      });
    } else {
      items.push({ path: e.path, pubkey: e.pubkey, state: "safe", detail: "Present and backed up." });
    }
  }

  // 2. High-tier secrets present in the project that are NOT backed up.
  const knownPaths = new Set(items.map((i) => i.path));
  try {
    const report = scanSecrets(dir, {});
    for (const s of report.secrets) {
      if ((s.tier === "terminal" || s.tier === "funds") && !knownPaths.has(s.path) && !s.gitTracked) {
        items.push({
          path: s.path,
          pubkey: s.pubkey,
          state: "at-risk-unbacked",
          detail: "Present but NOT backed up — if it's deleted there is no recovery. Run: brainblast vault backup",
        });
      }
    }
  } catch {
    /* scan failure shouldn't sink the rescue */
  }

  const culprits = opts.includeHistory === false ? [] : findCulprits();
  return {
    items,
    recoverableMissing: items.filter((i) => i.state === "recoverable-missing").length,
    unbackedAtRisk: items.filter((i) => i.state === "at-risk-unbacked").length,
    culprits,
  };
}

const STATE_ICON: Record<RescueState, string> = {
  "recoverable-missing": "♻",
  modified: "≠",
  safe: "✓",
  "at-risk-unbacked": "⚠",
};

export function renderRescueText(r: RescueReport): string {
  const lines: string[] = [];
  lines.push(`Keyguard rescue`);
  lines.push(
    `  ${r.recoverableMissing} recoverable from the Vault  ·  ${r.unbackedAtRisk} at risk (not backed up)`,
  );
  lines.push("");
  if (r.items.length === 0) {
    lines.push("  Nothing to report — no vaulted or high-tier secrets found.");
  }
  for (const i of r.items) {
    lines.push(`  ${STATE_ICON[i.state]} ${i.path}`);
    lines.push(`      ${i.detail}`);
  }
  if (r.culprits.length) {
    lines.push("");
    lines.push("  Recent destructive commands in your shell history (possible cause):");
    for (const c of r.culprits) lines.push(`      $ ${c}`);
  }
  return lines.join("\n");
}
