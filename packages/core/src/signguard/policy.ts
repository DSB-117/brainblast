// Signguard — the standing signing policy.
//
// A policy you set once and enforce on every transaction before it's signed.
// Secure by default: small spend cap, unknown programs blocked, authority/
// upgrade/delegate actions blocked. Override per-project in .brainblast/signguard.json.

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type ActionPolicy = "allow" | "warn" | "block";

export interface SigningPolicy {
  version: string;
  // SOL leaving the fee payer. null = no cap. Default caps are deliberately
  // small so a drainer trips them; raise for legitimately large operations.
  maxSolPerTx: number | null;
  maxSolPerSession: number | null;
  // Programs allowed beyond the built-in KNOWN_PROGRAMS allowlist.
  allowedPrograms: string[];
  // Any program not in (known ∪ allowedPrograms) is a hard block (vs the
  // firewall's soft warn) when true.
  blockUnknownPrograms: boolean;
  // If non-empty, SOL/token transfers must be to one of these addresses.
  allowedRecipients: string[];
  actions: {
    setAuthority: ActionPolicy;
    delegateApproval: ActionPolicy;
    programUpgrade: ActionPolicy;
    closeAccount: ActionPolicy;
  };
}

export const DEFAULT_POLICY: SigningPolicy = {
  version: "1",
  maxSolPerTx: 1,
  maxSolPerSession: 5,
  allowedPrograms: [],
  blockUnknownPrograms: true,
  allowedRecipients: [],
  actions: {
    setAuthority: "block",
    delegateApproval: "block",
    programUpgrade: "block",
    closeAccount: "warn",
  },
};

export const DEFAULT_POLICY_FILENAME = join(".brainblast", "signguard.json");

// Merge a partial (file) policy over the secure defaults so an incomplete file
// can never silently disable a protection.
export function normalizePolicy(partial: Partial<SigningPolicy> | undefined): SigningPolicy {
  const p = partial ?? {};
  return {
    ...DEFAULT_POLICY,
    ...p,
    actions: { ...DEFAULT_POLICY.actions, ...(p.actions ?? {}) },
    allowedPrograms: p.allowedPrograms ?? DEFAULT_POLICY.allowedPrograms,
    allowedRecipients: p.allowedRecipients ?? DEFAULT_POLICY.allowedRecipients,
  };
}

// Resolve a policy: explicit path → project .brainblast/signguard.json → defaults.
export function loadPolicy(opts: { policyPath?: string; cwd?: string } = {}): { policy: SigningPolicy; source: string } {
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const candidates = [
    opts.policyPath ? (isAbsolute(opts.policyPath) ? opts.policyPath : resolve(cwd, opts.policyPath)) : null,
    join(cwd, DEFAULT_POLICY_FILENAME),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        return { policy: normalizePolicy(JSON.parse(readFileSync(c, "utf8"))), source: c };
      } catch (e: any) {
        throw new Error(`signguard: policy file ${c} is invalid JSON: ${e?.message ?? e}`);
      }
    }
  }
  return { policy: DEFAULT_POLICY, source: "(built-in secure defaults)" };
}

export function scaffoldPolicy(targetDir = "."): string {
  const dir = resolve(targetDir);
  const path = join(dir, DEFAULT_POLICY_FILENAME);
  if (existsSync(path)) throw new Error(`signguard: ${path} already exists`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(DEFAULT_POLICY, null, 2) + "\n");
  return path;
}
