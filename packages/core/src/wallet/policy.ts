// The Agent Wallet's spend policy — the thing that actually bounds a compromised
// agent. The at-rest encryption protects the backup; THIS protects the funds.
//
// It is the Signguard philosophy (secure-by-default caps, recipient allowlist,
// unknown-program block) specialized for an autonomous spender, plus the
// cumulative session ledger the agent-stake script pioneered. Every outbound
// transaction passes checkSpend() BEFORE anything is signed; a violation is a
// hard, fail-closed refusal.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Programs the wallet builds with itself, plus the bare essentials. Anything
// outside this set trips blockUnknownPrograms (relevant for delegated/external
// transactions we didn't construct).
export const KNOWN_PROGRAMS = new Set<string>([
  "11111111111111111111111111111111", // System
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token Account
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", // Memo
]);

export type SpendPurpose = "sweep" | "stake" | "transfer";

export interface WalletSpendPolicy {
  version: string;
  // USD caps — the universal guard, independent of token/price.
  maxUsdPerTx: number;
  maxUsdPerSession: number;
  // SOL leaving the wallet in one tx (gas + transfers). null = no extra cap.
  maxSolPerTx: number | null;
  // Generic transfers must go to one of these (empty = any, still capped).
  allowedRecipients: string[];
  // Sweep (the panic button) may ONLY target an owner address. Set on init.
  ownerSweepAddresses: string[];
  // Any program outside KNOWN_PROGRAMS ∪ allowedPrograms is a hard block.
  blockUnknownPrograms: boolean;
  allowedPrograms: string[];
}

// Deliberately small caps: a drainer trips them; raise per-wallet for bigger
// legitimate ops. Mirrors agent-stake's $25/$50 precedent.
export const DEFAULT_WALLET_POLICY: WalletSpendPolicy = {
  version: "1",
  maxUsdPerTx: 25,
  maxUsdPerSession: 50,
  maxSolPerTx: 1,
  allowedRecipients: [],
  ownerSweepAddresses: [],
  blockUnknownPrograms: true,
  allowedPrograms: [],
};

export function walletPolicyPath(): string {
  return process.env.BRAINBLAST_WALLET_POLICY_FILE
    ? resolve(process.env.BRAINBLAST_WALLET_POLICY_FILE)
    : join(homedir(), ".brainblast", "wallet-policy.json");
}

function sessionPath(): string {
  return process.env.BRAINBLAST_WALLET_SESSION_FILE
    ? resolve(process.env.BRAINBLAST_WALLET_SESSION_FILE)
    : join(homedir(), ".brainblast", "wallet-session.json");
}

// Merge a partial (file) policy over the secure defaults so an incomplete file
// can never silently disable a protection. Env caps (shared with agent-stake)
// win when present, so an operator can tighten without editing a file.
export function normalizeWalletPolicy(partial: Partial<WalletSpendPolicy> | undefined): WalletSpendPolicy {
  const p = partial ?? {};
  const envTx = Number(process.env.AGENT_STAKE_MAX_USD);
  const envSession = Number(process.env.AGENT_STAKE_SESSION_CAP_USD);
  return {
    ...DEFAULT_WALLET_POLICY,
    ...p,
    maxUsdPerTx: Number.isFinite(envTx) ? envTx : p.maxUsdPerTx ?? DEFAULT_WALLET_POLICY.maxUsdPerTx,
    maxUsdPerSession: Number.isFinite(envSession)
      ? envSession
      : p.maxUsdPerSession ?? DEFAULT_WALLET_POLICY.maxUsdPerSession,
    allowedRecipients: p.allowedRecipients ?? DEFAULT_WALLET_POLICY.allowedRecipients,
    ownerSweepAddresses: p.ownerSweepAddresses ?? DEFAULT_WALLET_POLICY.ownerSweepAddresses,
    allowedPrograms: p.allowedPrograms ?? DEFAULT_WALLET_POLICY.allowedPrograms,
  };
}

export function loadWalletPolicy(): { policy: WalletSpendPolicy; source: string } {
  const p = walletPolicyPath();
  if (existsSync(p)) {
    try {
      return { policy: normalizeWalletPolicy(JSON.parse(readFileSync(p, "utf8"))), source: p };
    } catch (e: any) {
      throw new Error(`wallet: policy file ${p} is invalid JSON: ${e?.message ?? e}`);
    }
  }
  return { policy: normalizeWalletPolicy(undefined), source: "(secure defaults)" };
}

export function saveWalletPolicy(policy: WalletSpendPolicy): string {
  const p = walletPolicyPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(policy, null, 2) + "\n", { mode: 0o600 });
  return p;
}

// Register an owner address as a permitted sweep target (the panic-button
// destination). Idempotent. Returns the saved policy path.
export function addOwnerSweepAddress(addr: string): string {
  const { policy } = loadWalletPolicy();
  if (!policy.ownerSweepAddresses.includes(addr)) policy.ownerSweepAddresses.push(addr);
  return saveWalletPolicy(policy);
}

export function readSessionSpend(): number {
  const p = sessionPath();
  if (!existsSync(p)) return 0;
  try {
    return Number(JSON.parse(readFileSync(p, "utf8")).spentUsd ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function recordSessionSpend(usd: number): number {
  const total = readSessionSpend() + usd;
  const p = sessionPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ spentUsd: total, updatedAt: new Date().toISOString() }, null, 2), {
    mode: 0o600,
  });
  return total;
}

export function resetSessionSpend(): void {
  const p = sessionPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ spentUsd: 0, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
}

export interface SpendRequest {
  purpose: SpendPurpose;
  recipient: string;
  usd: number; // USD value of what's leaving (the cap currency)
  sol?: number; // SOL leaving, if any (for the SOL cap)
  programIds?: string[]; // programs the tx touches, for blockUnknownPrograms
}

export interface SpendDecision {
  ok: boolean;
  violations: string[];
  policySource: string;
  sessionSpentBefore: number;
}

// The gate. Pure: it reads the policy + session ledger and returns a verdict;
// it never moves funds. signWithPolicy() calls this and refuses on !ok.
export function checkSpend(req: SpendRequest, policy?: WalletSpendPolicy): SpendDecision {
  const loaded = policy ? { policy, source: "(provided)" } : loadWalletPolicy();
  const pol = loaded.policy;
  const sessionSpentBefore = readSessionSpend();
  const violations: string[] = [];

  if (req.purpose === "sweep") {
    // Sweep is recovery: it moves YOUR funds to YOUR address, so the spend caps
    // don't apply — but it must be fail-closed to a configured owner address, or
    // a compromised agent could "sweep" to an attacker.
    if (pol.ownerSweepAddresses.length === 0) {
      violations.push("no owner sweep address configured; run `brainblast wallet config --owner <addr>`");
    } else if (!pol.ownerSweepAddresses.includes(req.recipient)) {
      violations.push(`sweep target ${req.recipient} is not a registered owner sweep address`);
    }
  } else {
    // stake / transfer: the spend caps are the universal guard.
    if (!Number.isFinite(req.usd) || req.usd < 0) {
      violations.push(`invalid USD amount: ${req.usd}`);
    }
    if (req.usd > pol.maxUsdPerTx) {
      violations.push(`$${req.usd} exceeds per-tx cap $${pol.maxUsdPerTx}`);
    }
    if (sessionSpentBefore + req.usd > pol.maxUsdPerSession) {
      violations.push(
        `$${req.usd} would bring session spend to $${(sessionSpentBefore + req.usd).toFixed(2)}, ` +
          `over the session cap $${pol.maxUsdPerSession} (already $${sessionSpentBefore.toFixed(2)})`,
      );
    }
    if (req.sol != null && pol.maxSolPerTx != null && req.sol > pol.maxSolPerTx) {
      violations.push(`${req.sol} SOL exceeds per-tx SOL cap ${pol.maxSolPerTx}`);
    }
    // A generic transfer must go to an allowlisted recipient (if any are set).
    // "stake" goes to the registry's protocol-resolved pay_to — caps only.
    if (req.purpose === "transfer" && pol.allowedRecipients.length > 0 && !pol.allowedRecipients.includes(req.recipient)) {
      violations.push(`recipient ${req.recipient} is not in allowedRecipients`);
    }
  }

  if (pol.blockUnknownPrograms && req.programIds) {
    const allowed = new Set([...KNOWN_PROGRAMS, ...pol.allowedPrograms]);
    for (const pid of req.programIds) {
      if (!allowed.has(pid)) violations.push(`program ${pid} is not allowlisted (blockUnknownPrograms)`);
    }
  }

  return { ok: violations.length === 0, violations, policySource: loaded.source, sessionSpentBefore };
}

export interface SignResult {
  ok: boolean;
  signature?: string;
  decision: SpendDecision;
}

// The single chokepoint every outbound transaction passes through. It runs the
// gate FIRST and only invokes `executor` (which does the actual sign+send) if
// the spend is allowed — so a refusal never touches the chain. The session
// ledger is debited only on a successful non-sweep spend. `executor` is injected
// so this orchestration is testable without a network (the refusal path must
// never call it).
export async function signWithPolicy(
  request: SpendRequest,
  executor: () => Promise<string>,
  policy?: WalletSpendPolicy,
): Promise<SignResult> {
  const decision = checkSpend(request, policy);
  if (!decision.ok) return { ok: false, decision };
  const signature = await executor();
  if (request.purpose !== "sweep") recordSessionSpend(request.usd);
  return { ok: true, signature, decision };
}
