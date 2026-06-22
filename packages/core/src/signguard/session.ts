// Signguard — the session spend ledger.
//
// A cumulative cap is only meaningful with memory: a drainer that stays under
// the per-tx limit but fires twenty times still empties the wallet. The ledger
// tracks SOL spent this session at ~/.brainblast/signguard/session.json
// (override with BRAINBLAST_SIGNGUARD_DIR), reset with `signguard reset`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface SessionLedger {
  startedAt: string;
  solOut: number;
  txCount: number;
}

function sgDir(): string {
  return process.env.BRAINBLAST_SIGNGUARD_DIR
    ? resolve(process.env.BRAINBLAST_SIGNGUARD_DIR)
    : join(homedir(), ".brainblast", "signguard");
}
function ledgerPath(): string {
  return join(sgDir(), "session.json");
}

export function loadSession(): SessionLedger {
  const p = ledgerPath();
  if (!existsSync(p)) return { startedAt: new Date().toISOString(), solOut: 0, txCount: 0 };
  try {
    const l = JSON.parse(readFileSync(p, "utf8")) as Partial<SessionLedger>;
    return { startedAt: l.startedAt ?? new Date().toISOString(), solOut: l.solOut ?? 0, txCount: l.txCount ?? 0 };
  } catch {
    return { startedAt: new Date().toISOString(), solOut: 0, txCount: 0 };
  }
}

export function recordSpend(sol: number): SessionLedger {
  const cur = loadSession();
  const next: SessionLedger = { startedAt: cur.startedAt, solOut: cur.solOut + sol, txCount: cur.txCount + 1 };
  mkdirSync(sgDir(), { recursive: true });
  writeFileSync(ledgerPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export function resetSession(): void {
  const fresh: SessionLedger = { startedAt: new Date().toISOString(), solOut: 0, txCount: 0 };
  mkdirSync(sgDir(), { recursive: true });
  writeFileSync(ledgerPath(), JSON.stringify(fresh, null, 2), { mode: 0o600 });
}
