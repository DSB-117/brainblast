import { staticChecker } from "./backends/staticChecker.ts";
import { compilerBackend } from "./backends/compiler.ts";
import { executedTestBackend } from "./backends/executedTest.ts";
import { differentialBackend } from "./backends/differential.ts";
import type {
  OracleBackend,
  OracleMethod,
  OracleVerdict,
  OracleContext,
  OracleTier,
} from "./types.ts";
import type { Rule } from "../types.ts";

export type {
  OracleBackend,
  OracleColor,
  OracleMethod,
  OracleVerdict,
  OracleEvidence,
  OracleTarget,
  OracleContext,
  OracleTier,
} from "./types.ts";
export {
  proveRedGreen,
  proveWithBest,
  proofMethod,
  type RedGreenResult,
  type ProveWithBestResult,
} from "./prove.ts";
export { staticChecker } from "./backends/staticChecker.ts";
export { compilerBackend } from "./backends/compiler.ts";
export { executedTestBackend } from "./backends/executedTest.ts";
export { differentialBackend } from "./backends/differential.ts";
export {
  runInSandbox,
  containerRuntime,
  packageRoot,
  makeSandboxDir,
  copyCandidate,
  type SandboxSpec,
  type SandboxResult,
  type SandboxStatus,
} from "./sandbox.ts";

// Every backend, indexed by method. Trust order is tier order.
export const ALL_BACKENDS: OracleBackend[] = [
  staticChecker, // tier 0
  compilerBackend, // tier 1
  executedTestBackend, // tier 2
  differentialBackend, // tier 2
];

export const BACKENDS_BY_METHOD: Record<OracleMethod, OracleBackend> = {
  "static-checker": staticChecker,
  compiler: compilerBackend,
  "executed-test": executedTestBackend,
  differential: differentialBackend,
};

// What `--oracle=<name>` can name. "best" tries every allowed backend in trust
// order and reports the strongest proof.
export type OracleSelector = OracleMethod | "best";

export const ORACLE_SELECTORS: OracleSelector[] = [
  "static-checker",
  "compiler",
  "executed-test",
  "differential",
  "best",
];

// CLI-friendly aliases → method names.
const ALIASES: Record<string, OracleSelector> = {
  static: "static-checker",
  "static-checker": "static-checker",
  compiler: "compiler",
  compile: "compiler",
  executed: "executed-test",
  "executed-test": "executed-test",
  exec: "executed-test",
  differential: "differential",
  diff: "differential",
  best: "best",
};

export function parseOracleSelector(raw: string | undefined): OracleSelector {
  if (!raw) return "static-checker";
  const sel = ALIASES[raw.trim().toLowerCase()];
  if (!sel) {
    throw new Error(
      `unknown --oracle '${raw}'. Choose: static | compiler | executed | differential | best`,
    );
  }
  return sel;
}

// Tier 0/1 are offline+deterministic and execute no candidate code, so they are
// safe by default. Tier 2 runs code and is opt-in only — enabled by the explicit
// flag or BRAINBLAST_ORACLE_EXEC=1.
export function tier2Enabled(): boolean {
  const v = process.env.BRAINBLAST_ORACLE_EXEC;
  return v === "1" || v === "true";
}

export interface BackendSelection {
  // Ordered (trust-ascending) list of backends to actually run.
  backends: OracleBackend[];
  // The highest tier permitted for this run.
  maxTier: OracleTier;
}

// Resolve an `--oracle` selector + opt-in state into the concrete backend list.
//   selector "best" → all backends up to maxTier, in trust order.
//   a named selector → just that backend (Tier 2 names still require the opt-in;
//     when not opted-in they are returned so the run can no-op to UNKNOWN with a
//     reason, never silently dropped).
export function selectBackends(
  selector: OracleSelector,
  opts: { allowTier2?: boolean } = {},
): BackendSelection {
  const allowTier2 = opts.allowTier2 ?? tier2Enabled();
  const maxTier: OracleTier = allowTier2 ? 2 : 1;
  if (selector === "best") {
    return { backends: ALL_BACKENDS.filter((b) => b.tier <= maxTier), maxTier };
  }
  return { backends: [BACKENDS_BY_METHOD[selector]], maxTier };
}

export interface AuditWithOracleOptions {
  oracle?: OracleSelector | string;
  context?: OracleContext;
  allowTier2?: boolean;
}

// Inline export mirroring `auditWithRule`, for agent frameworks: scan ONE dir
// with ONE rule through the chosen oracle and return the two-color verdict. With
// "best", returns the strongest decisive verdict (RED preferred over GREEN over
// UNKNOWN) across the allowed backends.
export async function auditWithOracle(
  dir: string,
  rule: Rule,
  opts: AuditWithOracleOptions = {},
): Promise<OracleVerdict> {
  const selector =
    typeof opts.oracle === "string" ? parseOracleSelector(opts.oracle) : opts.oracle ?? "static-checker";
  const { backends } = selectBackends(selector, { allowTier2: opts.allowTier2 });
  const context = opts.context ?? "local";

  const eligible = backends.filter((b) => b.supports(rule)).sort((a, b) => a.tier - b.tier);
  if (eligible.length === 0) {
    return {
      color: "UNKNOWN",
      method: "static-checker",
      detail: `no oracle backend supports rule '${rule.id}' (check.kind '${rule.check?.kind}').`,
    };
  }

  let best: OracleVerdict | null = null;
  const rank = (c: OracleVerdict["color"]) => (c === "RED" ? 2 : c === "GREEN" ? 1 : 0);
  for (const backend of eligible) {
    const v = await backend.verify({ dir, rule, context });
    if (!best || rank(v.color) > rank(best.color)) best = v;
  }
  return best!;
}
