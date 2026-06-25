import { auditWithRule } from "../../audit.ts";
import type { OracleBackend, OracleVerdict } from "../types.ts";

// Tier 0 — the static checker, wrapped (not rewritten) as an oracle backend.
//
// This is the seam: `auditWithRule` keeps its exact signature and behavior; the
// oracle layer sits ABOVE it. The verdict here is exactly the legacy RED/GREEN/
// cant_tell collapsed into the two-color scheme, so routing the static path
// through the oracle is a no-op (proved by a parametrized test over every pack).
//
//   any check FAIL                         → RED   (the bad shape is present)
//   no FAIL but some cant_tell             → UNKNOWN (static couldn't decide)
//   candidates checked, none FAIL/cant_tell → GREEN (the trap is avoided)
//   no candidate detected at all           → GREEN (nothing to flag)
export const staticChecker: OracleBackend = {
  method: "static-checker",
  tier: 0,
  supports: () => true,
  async verify({ dir, rule }) {
    const t0 = Date.now();
    const checks = auditWithRule(dir, rule);
    const failed = checks.find((c) => c.result === "fail");
    const cantTell = checks.find((c) => c.result === "cant_tell");
    const verdict: OracleVerdict = {
      color: failed ? "RED" : cantTell ? "UNKNOWN" : "GREEN",
      method: "static-checker",
      detail:
        failed?.detail ??
        cantTell?.detail ??
        checks[0]?.detail ??
        "no candidate detected",
      evidence: { checkKind: rule.check.kind, checks: checks.length },
      durationMs: Date.now() - t0,
    };
    return verdict;
  },
};
