import type { OracleBackend, OracleMethod, OracleVerdict } from "./types.ts";
import type { Rule } from "../types.ts";

// THE ONE TRUE GATE. Today synth-prove, pack-validate, and bench each re-implement
// "RED on vulnerable, GREEN on fixed" by calling audit() directly. v0.9.0 routes
// every consumer through one shared prover, parameterized by backend — so the same
// RED→GREEN contract can be satisfied by a static checker, a compiler, an executed
// test, or a differential, with the verdict recorded as whatever actually proved it.

export interface RedGreenResult {
  // PROVEN === RED on vulnerable AND GREEN on fixed (strict — UNKNOWN is NOT a
  // proof, only ever GREEN-for-gating).
  proven: boolean;
  red: boolean;
  green: boolean;
  method: OracleMethod;
  redVerdict: OracleVerdict;
  greenVerdict: OracleVerdict;
}

// Run one backend against the vulnerable/fixed pair and report whether it proves
// the RED→GREEN contract. Deterministic for a given (dirs, rule) under pinned deps.
export async function proveRedGreen(
  backend: OracleBackend,
  vulnerableDir: string,
  fixedDir: string,
  rule: Rule,
  context: "local" | "ingest" = "local",
): Promise<RedGreenResult> {
  const redVerdict = await backend.verify({ dir: vulnerableDir, rule, context });
  const greenVerdict = await backend.verify({ dir: fixedDir, rule, context });
  const red = redVerdict.color === "RED";
  const green = greenVerdict.color === "GREEN";
  return {
    proven: red && green,
    red,
    green,
    method: backend.method,
    redVerdict,
    greenVerdict,
  };
}

export interface ProveWithBestResult {
  // The strongest single proof, or null if no eligible backend proved RED→GREEN.
  proven: RedGreenResult | null;
  // Every OTHER backend that also proved it — corroboration raises confidence
  // (and, later, price). e.g. static-checker + compiler agreeing on one record.
  corroborations: OracleMethod[];
  // What was tried (for diagnostics / a reproduction scorecard).
  attempts: RedGreenResult[];
}

// Try backends in trust order (lowest tier first: static → compiler → executed →
// differential) and return the FIRST that proves RED→GREEN, plus all that
// corroborated. The method recorded on a record is the strongest single proof;
// corroborating methods are surfaced separately.
export async function proveWithBest(
  backends: OracleBackend[],
  vulnerableDir: string,
  fixedDir: string,
  rule: Rule,
  context: "local" | "ingest" = "local",
): Promise<ProveWithBestResult> {
  const eligible = [...backends]
    .filter((b) => b.supports(rule))
    .sort((a, b) => a.tier - b.tier);

  const attempts: RedGreenResult[] = [];
  let proven: RedGreenResult | null = null;
  const corroborations: OracleMethod[] = [];

  for (const backend of eligible) {
    const result = await proveRedGreen(backend, vulnerableDir, fixedDir, rule, context);
    attempts.push(result);
    if (result.proven) {
      if (!proven) proven = result;
      else corroborations.push(result.method);
    }
  }

  return { proven, corroborations, attempts };
}

// The proof-method string a record carries. A single backend records its method;
// corroborating backends compound it ("static-checker+compiler"), the exact shape
// the proof enum was built to hold.
export function proofMethod(result: ProveWithBestResult): OracleMethod | string | null {
  if (!result.proven) return null;
  if (result.corroborations.length === 0) return result.proven.method;
  return [result.proven.method, ...result.corroborations].join("+");
}
