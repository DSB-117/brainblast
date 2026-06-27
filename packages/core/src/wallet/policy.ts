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
  // USD caps — a convenience bound on the caller-asserted value of a spend.
  maxUsdPerTx: number;
  maxUsdPerSession: number;
  // $BRAIN caps — the ENFORCEABLE bound on what actually leaves the wallet in a
  // stake (the USD figure is caller-asserted and can be understated; the token
  // amount is what's really transferred). null = NOT configured, which makes a
  // $BRAIN spend fail-closed (refused) until a cap is set.
  maxBrainPerTx: number | null;
  maxBrainPerSession: number | null;
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
  // null by default → autonomous $BRAIN spend is fail-closed until the operator
  // sets a token cap they understand against the current price.
  maxBrainPerTx: null,
  maxBrainPerSession: null,
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

interface SessionLedger {
  spentUsd: number;
  spentBrain: number;
}

function readSession(): SessionLedger {
  const p = sessionPath();
  if (!existsSync(p)) return { spentUsd: 0, spentBrain: 0 };
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return { spentUsd: Number(j.spentUsd) || 0, spentBrain: Number(j.spentBrain) || 0 };
  } catch {
    return { spentUsd: 0, spentBrain: 0 };
  }
}

// Read-modify-write the whole ledger so debiting one currency never clobbers the
// other's running total.
function writeSession(s: SessionLedger): void {
  const p = sessionPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(
    p,
    JSON.stringify({ spentUsd: s.spentUsd, spentBrain: s.spentBrain, updatedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
}

export function readSessionSpend(): number {
  return readSession().spentUsd;
}
export function readSessionBrain(): number {
  return readSession().spentBrain;
}

export function recordSessionSpend(usd: number): number {
  const s = readSession();
  s.spentUsd += usd;
  writeSession(s);
  return s.spentUsd;
}
export function recordSessionBrain(brain: number): number {
  const s = readSession();
  s.spentBrain += brain;
  writeSession(s);
  return s.spentBrain;
}

export function resetSessionSpend(): void {
  writeSession({ spentUsd: 0, spentBrain: 0 });
}

export interface SpendRequest {
  purpose: SpendPurpose;
  recipient: string;
  usd: number; // caller-asserted USD value of the spend (a convenience bound)
  brainAmount?: number; // $BRAIN actually leaving — the ENFORCEABLE bound
  sol?: number; // SOL leaving, if any (for the SOL cap)
  programIds?: string[]; // programs the tx touches, for blockUnknownPrograms
}

export interface SpendDecision {
  ok: boolean;
  violations: string[];
  policySource: string;
  sessionSpentBefore: number; // USD spent this session before this request
  sessionBrainBefore: number; // $BRAIN spent this session before this request
}

// The gate. Pure: it reads the policy + session ledger and returns a verdict;
// it never moves funds. signWithPolicy() calls this and refuses on !ok.
export function checkSpend(req: SpendRequest, policy?: WalletSpendPolicy): SpendDecision {
  const loaded = policy ? { policy, source: "(provided)" } : loadWalletPolicy();
  const pol = loaded.policy;
  const session = readSession();
  const sessionSpentBefore = session.spentUsd;
  const sessionBrainBefore = session.spentBrain;
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
    // The $BRAIN amount is what ACTUALLY leaves — bound it directly, not via the
    // caller-asserted USD. Validity is checked first (negative/NaN/Infinity are
    // rejected outright), then the caps. Fail-closed: a $BRAIN spend with no token
    // cap set is refused — the USD cap alone is not a real bound on the transfer.
    if (req.brainAmount != null) {
      if (!Number.isFinite(req.brainAmount) || req.brainAmount < 0) {
        violations.push(`invalid $BRAIN amount: ${req.brainAmount}`);
      } else if (req.brainAmount > 0) {
        if (pol.maxBrainPerTx == null) {
          violations.push(
            "no $BRAIN per-tx cap configured; autonomous $BRAIN spend is disabled until you run " +
              "`brainblast wallet config --max-brain-per-tx <amount>`",
          );
        } else {
          if (req.brainAmount > pol.maxBrainPerTx) {
            violations.push(`${req.brainAmount} $BRAIN exceeds per-tx cap ${pol.maxBrainPerTx}`);
          }
          if (pol.maxBrainPerSession != null && sessionBrainBefore + req.brainAmount > pol.maxBrainPerSession) {
            violations.push(
              `${req.brainAmount} $BRAIN would bring session spend to ${sessionBrainBefore + req.brainAmount}, ` +
                `over the $BRAIN session cap ${pol.maxBrainPerSession} (already ${sessionBrainBefore})`,
            );
          }
        }
      }
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

  return { ok: violations.length === 0, violations, policySource: loaded.source, sessionSpentBefore, sessionBrainBefore };
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
  // executor() does the real broadcast; if it throws (failed send) we propagate
  // and DO NOT debit — the ledger only ever reflects funds that actually moved.
  const signature = await executor();
  if (request.purpose !== "sweep") {
    recordSessionSpend(request.usd);
    if (request.brainAmount && request.brainAmount > 0) recordSessionBrain(request.brainAmount);
  }
  return { ok: true, signature, decision };
}
