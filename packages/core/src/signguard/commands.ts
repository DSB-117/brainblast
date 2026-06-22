// Signguard — recognize value-moving / authority-changing Solana CLI commands.
//
// An agent rarely hands you a base64 transaction; it runs `solana transfer …` or
// `solana program set-upgrade-authority …` in Bash. This parses those commands
// and applies the same signing policy, so the PreToolUse hook can block a drain
// or an authority hand-off before it's sent — even with no serialized tx in hand.

import type { SigningPolicy } from "./policy.ts";
import type { SignguardDecision, SignguardFinding } from "./evaluate.ts";

export interface CommandVerdict {
  recognized: boolean; // false → not a Signguard-relevant command (allow)
  decision: SignguardDecision;
  solOut: number | null; // null = amount not statically known (e.g. "ALL")
  recipients: string[];
  findings: SignguardFinding[];
  message: string;
}

function tokenize(seg: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  let has = false;
  for (const c of seg) {
    if (q) {
      if (c === q) q = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has) { out.push(cur); cur = ""; has = false; }
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function worst(findings: SignguardFinding[]): SignguardDecision {
  if (findings.some((f) => f.severity === "critical")) return "block";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "allow";
}

export function evaluateSolanaCommand(
  command: string,
  policy: SigningPolicy,
  ctx: { sessionSolOut?: number } = {},
): CommandVerdict {
  const findings: SignguardFinding[] = [];
  const recipients: string[] = [];
  let recognized = false;
  let solOut: number | null = 0;

  for (const raw of command.split(/&&|\|\||;|\n|\|/)) {
    let toks = tokenize(raw.trim());
    while (toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0])) toks = toks.slice(1);
    if (toks.length === 0) continue;
    const [bin, sub] = toks;
    const args = toks.slice(1);
    const nonFlags = args.filter((a) => !a.startsWith("-"));

    // solana transfer <RECIPIENT> <AMOUNT>
    if (bin === "solana" && sub === "transfer") {
      recognized = true;
      const recipient = nonFlags[1];
      const amountTok = nonFlags[2];
      if (recipient && BASE58.test(recipient)) recipients.push(recipient);
      if (amountTok && /^[0-9]*\.?[0-9]+$/.test(amountTok)) {
        const amt = parseFloat(amountTok);
        if (solOut != null) solOut += amt;
        if (policy.maxSolPerTx != null && amt > policy.maxSolPerTx) {
          findings.push({ severity: "critical", kind: "spend-cap-tx", detail: `\`solana transfer\` sends ${amt} SOL — over the ${policy.maxSolPerTx} SOL per-transaction limit.` });
        }
      } else if (amountTok && /^ALL$/i.test(amountTok)) {
        solOut = null;
        findings.push({ severity: "critical", kind: "spend-all", detail: "`solana transfer … ALL` empties the account's SOL — amount is unbounded." });
      }
      if (policy.allowedRecipients.length && recipient && !policy.allowedRecipients.includes(recipient)) {
        findings.push({ severity: "critical", kind: "recipient-not-allowed", detail: `Transfer destination ${recipient} is not in the policy's allowedRecipients.` });
      }
      continue;
    }

    // spl-token transfer <TOKEN> <AMOUNT> <RECIPIENT>
    if (bin === "spl-token" && sub === "transfer") {
      recognized = true;
      const recipient = nonFlags[3];
      if (recipient && BASE58.test(recipient)) {
        recipients.push(recipient);
        if (policy.allowedRecipients.length && !policy.allowedRecipients.includes(recipient)) {
          findings.push({ severity: "critical", kind: "recipient-not-allowed", detail: `Token transfer destination ${recipient} is not in the policy's allowedRecipients.` });
        }
      }
      continue;
    }

    // Authority / upgrade changes — map to the action policy.
    if (bin === "solana" && sub === "program") {
      const op = nonFlags[1];
      if (op === "set-upgrade-authority") {
        recognized = true;
        const s = policy.actions.setAuthority;
        if (s !== "allow") findings.push({ severity: s === "block" ? "critical" : "warn", kind: "program-set-authority", detail: "`solana program set-upgrade-authority` changes who can upgrade the program — a terminal authority hand-off." });
      } else if (op === "deploy" && args.includes("--program-id")) {
        recognized = true;
        const s = policy.actions.programUpgrade;
        if (s !== "allow") findings.push({ severity: s === "block" ? "critical" : "warn", kind: "program-upgrade", detail: "`solana program deploy --program-id` replaces the on-chain code of an existing program." });
      }
      continue;
    }

    if ((bin === "spl-token" && sub === "authorize") || (bin === "solana" && sub === "authorize")) {
      recognized = true;
      const s = policy.actions.setAuthority;
      if (s !== "allow") findings.push({ severity: s === "block" ? "critical" : "warn", kind: "set-authority", detail: `\`${bin} authorize\` changes an authority.` });
    }
  }

  // Session cap across recognized SOL spend.
  if (recognized && solOut != null && policy.maxSolPerSession != null) {
    const projected = (ctx.sessionSolOut ?? 0) + solOut;
    if (projected > policy.maxSolPerSession) {
      findings.push({ severity: "critical", kind: "spend-cap-session", detail: `Would bring this session's spend to ${projected.toFixed(4)} SOL — over the ${policy.maxSolPerSession} SOL session limit.` });
    }
  }

  const decision = recognized ? worst(findings) : "allow";
  const message =
    !recognized
      ? "Not a Signguard-relevant command."
      : decision === "allow"
        ? `ALLOW — within policy${solOut ? ` (sends ${solOut} SOL)` : ""}.`
        : `${decision === "block" ? "BLOCK" : "WARN"} — ` + findings.map((f) => `[${f.kind}] ${f.detail}`).join(" ");
  return { recognized, decision, solOut, recipients, findings, message };
}
