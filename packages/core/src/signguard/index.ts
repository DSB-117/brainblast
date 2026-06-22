// Signguard — orchestration + the inline export agents call before signing.
//
// inspectSigning() is the policy-aware sibling of the firewall's
// inspectTransaction(): decode + (optional) simulate via the firewall, then run
// the result through your signing policy. Returns a single allow/warn/block
// verdict an agent can gate a signature on.

import {
  decodeTransaction,
  inspectTransaction,
  KNOWN_PROGRAMS,
  type FirewallOpts,
  type FirewallReport,
} from "../firewall.ts";
import { DEFAULT_POLICY, type SigningPolicy } from "./policy.ts";
import { evaluateSigning, type SignguardVerdict } from "./evaluate.ts";

export * from "./policy.ts";
export * from "./evaluate.ts";
export * from "./transfers.ts";
export * from "./session.ts";

export interface SignguardOpts extends FirewallOpts {
  policy?: SigningPolicy;
  sessionSolOut?: number;
}

export interface SignguardResult extends SignguardVerdict {
  firewall: FirewallReport;
}

function allowedToMap(ids: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const id of ids) m[id] = "policy-allowed";
  return m;
}

export async function inspectSigning(base64: string, opts: SignguardOpts = {}): Promise<SignguardResult> {
  const policy = opts.policy ?? DEFAULT_POLICY;
  const known = { ...KNOWN_PROGRAMS, ...allowedToMap(policy.allowedPrograms), ...(opts.knownPrograms ?? {}) };

  const decoded = decodeTransaction(base64, { messageOnly: opts.messageOnly });
  const firewall = await inspectTransaction(base64, { ...opts, knownPrograms: known });
  const verdict = evaluateSigning(decoded, firewall.findings, policy, { sessionSolOut: opts.sessionSolOut });
  return { ...verdict, firewall };
}

// ── Rendering ────────────────────────────────────────────────────────────────
const VERDICT_BANNER = {
  allow: "ALLOW — within policy",
  warn: "WARN — review before signing",
  block: "BLOCK — violates your signing policy",
} as const;

const SEV_ICON = { critical: "⛔", warn: "⚠ ", info: "· " } as const;

export function renderSignguardText(r: SignguardResult, policySource?: string): string {
  const lines: string[] = [];
  lines.push(`Signguard  [${VERDICT_BANNER[r.decision]}]`);
  if (policySource) lines.push(`  policy: ${policySource}`);
  lines.push("");
  lines.push(`  Fee payer:   ${r.transfers.feePayer}`);
  lines.push(`  SOL out:     ${r.solOut.toFixed(4)} SOL${r.imprecise ? "  (some accounts via lookup tables — not fully visible)" : ""}`);
  if (r.sessionSolOut != null) lines.push(`  Session:     ${r.sessionSolOut.toFixed(4)} SOL (projected)`);
  if (r.recipients.length) lines.push(`  Recipients:  ${r.recipients.join(", ")}`);
  if (r.firewall.simulation.ran) {
    lines.push(`  Simulation:  ${r.firewall.simulation.ok ? "ok" : "FAILED"}${r.firewall.simulation.unitsConsumed != null ? ` (${r.firewall.simulation.unitsConsumed} CU)` : ""}`);
  }
  lines.push("");
  if (r.findings.length === 0) {
    lines.push("  No policy findings.");
  } else {
    lines.push("  Findings:");
    for (const f of r.findings) lines.push(`    ${SEV_ICON[f.severity]} [${f.kind}] ${f.detail}`);
  }
  return lines.join("\n");
}
