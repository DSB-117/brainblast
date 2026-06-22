// Signguard — the policy engine.
//
// Takes a decoded transaction + the firewall's pattern findings + your policy
// (+ the session ledger) and returns a single allow/warn/block verdict with the
// numbers that justify it. This is where "is this safe to sign?" becomes "does
// this obey the rules you set?".

import type { DecodedTx, FirewallFinding } from "../firewall.ts";
import type { ActionPolicy, SigningPolicy } from "./policy.ts";
import { lamportsToSol, summarizeTransfers, type TransferSummary } from "./transfers.ts";

export type SignguardSeverity = "info" | "warn" | "critical";
export type SignguardDecision = "allow" | "warn" | "block";

export interface SignguardFinding {
  severity: SignguardSeverity;
  kind: string;
  detail: string;
}

export interface SignguardVerdict {
  decision: SignguardDecision;
  solOut: number;
  sessionSolOut: number | null; // projected cumulative incl. this tx, if a cap applies
  recipients: string[];
  imprecise: boolean;
  transfers: TransferSummary;
  findings: SignguardFinding[];
  message: string;
}

// firewall finding kind → the policy action that governs it.
const ACTION_OF: Record<string, keyof SigningPolicy["actions"]> = {
  "token-set-authority": "setAuthority",
  "program-set-authority": "setAuthority",
  "token-delegate-approval": "delegateApproval",
  "program-upgrade": "programUpgrade",
  "token-close-account": "closeAccount",
};

function sevOf(a: ActionPolicy): SignguardSeverity | null {
  return a === "block" ? "critical" : a === "warn" ? "warn" : null; // allow → drop
}

function worst(findings: SignguardFinding[]): SignguardDecision {
  if (findings.some((f) => f.severity === "critical")) return "block";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "allow";
}

export interface EvaluateCtx {
  sessionSolOut?: number; // SOL already spent this session (for the cumulative cap)
}

export function evaluateSigning(
  decoded: DecodedTx,
  firewallFindings: FirewallFinding[],
  policy: SigningPolicy,
  ctx: EvaluateCtx = {},
): SignguardVerdict {
  const transfers = summarizeTransfers(decoded);
  const solOut = lamportsToSol(transfers.solOutLamports);
  const findings: SignguardFinding[] = [];

  // 1. Per-transaction spend cap.
  if (policy.maxSolPerTx != null && solOut > policy.maxSolPerTx) {
    findings.push({
      severity: "critical",
      kind: "spend-cap-tx",
      detail: `Moves ${solOut.toFixed(4)} SOL out of the fee payer — over the ${policy.maxSolPerTx} SOL per-transaction limit.`,
    });
  }

  // 2. Cumulative session cap.
  let sessionProjected: number | null = null;
  if (policy.maxSolPerSession != null) {
    sessionProjected = (ctx.sessionSolOut ?? 0) + solOut;
    if (sessionProjected > policy.maxSolPerSession) {
      findings.push({
        severity: "critical",
        kind: "spend-cap-session",
        detail: `Would bring this session's spend to ${sessionProjected.toFixed(4)} SOL — over the ${policy.maxSolPerSession} SOL session limit.`,
      });
    }
  }

  // 3. Action policy + unknown programs (firewall findings, allowlist-aware).
  for (const f of firewallFindings) {
    if (f.kind === "unknown-program" || f.kind === "unknown-cpi-program") {
      findings.push({
        severity: policy.blockUnknownPrograms ? "critical" : "warn",
        kind: f.kind,
        detail: f.detail,
      });
      continue;
    }
    const actionKey = ACTION_OF[f.kind];
    if (actionKey) {
      const s = sevOf(policy.actions[actionKey]);
      if (s) findings.push({ severity: s, kind: f.kind, detail: f.detail });
      continue;
    }
    // Carry over informational/simulation findings unchanged.
    findings.push({ severity: f.severity as SignguardSeverity, kind: f.kind, detail: f.detail });
  }

  // 4. Recipient allowlist.
  if (policy.allowedRecipients.length > 0) {
    for (const r of transfers.recipients) {
      if (!policy.allowedRecipients.includes(r)) {
        findings.push({
          severity: "critical",
          kind: "recipient-not-allowed",
          detail: `Transfer destination ${r} is not in the policy's allowedRecipients.`,
        });
      }
    }
  }

  const decision = worst(findings);
  return {
    decision,
    solOut,
    sessionSolOut: sessionProjected,
    recipients: transfers.recipients,
    imprecise: transfers.imprecise,
    transfers,
    findings,
    message: messageFor(decision, solOut, findings),
  };
}

function messageFor(decision: SignguardDecision, solOut: number, findings: SignguardFinding[]): string {
  if (decision === "allow") {
    return `ALLOW — within policy${solOut > 0 ? ` (moves ${solOut.toFixed(4)} SOL)` : ""}.`;
  }
  const head =
    decision === "block"
      ? "BLOCK — this transaction violates your signing policy; do not sign:"
      : "WARN — review before signing:";
  const lines = findings
    .filter((f) => (decision === "block" ? f.severity === "critical" : f.severity !== "info"))
    .map((f) => `  ${f.severity === "critical" ? "⛔" : "⚠"} [${f.kind}] ${f.detail}`);
  return `${head}\n${lines.join("\n")}`;
}
