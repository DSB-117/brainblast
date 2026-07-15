import type { CstChecker } from "../types.ts";

// Checker: cst-required-guard-missing (Solidity / Go)
//
// An ABSENCE trap: a trigger call is present in the scope but a REQUIRED guard is
// not. This is the shape of a whole class of footguns that literal-based checkers
// can't reach, because the bug is what's *missing*, not a wrong literal. The
// canonical case is Chainlink oracle staleness:
//
//   // RED — reads the price but never checks freshness
//   (, int256 answer, , , ) = feed.latestRoundData();
//   return uint256(answer);
//
//   // GREEN — guards on updatedAt / block.timestamp
//   (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
//   require(block.timestamp - updatedAt <= MAX_STALENESS, "stale price");
//   return uint256(answer);
//
// "Required guard present" semantics: trigger present + guard absent → fail;
// trigger present + guard present → pass; trigger absent → pass (not applicable).
// The provenance target is the TRIGGER call line (present in both fixtures), so a
// wild VTI cites `feed.latestRoundData()` — a real, matchable line — sidestepping
// the "absence has no line to cite" problem that sinks naive absence traps.
//
// Required params:
//   triggerCall  — call whose presence arms the check (e.g. "latestRoundData").
//   guardTokens  — identifiers / member accesses that satisfy the guard when they
//                  appear in the scope (e.g. ["updatedAt","block.timestamp"]).
// Optional:
//   guardMode    — "any" (default): any one token satisfies. "all": every token
//                  must appear (e.g. require BOTH updatedAt AND block.timestamp).
//   passDetail / failDetail.

function collect(node: any, kind: string, out: any[] = []): any[] {
  if (!node) return out;
  if (node.type === kind) out.push(node);
  for (let i = 0; i < node.childCount; i++) collect(node.child(i), kind, out);
  return out;
}

// Bare-callee identifier of a call: `foo(...)` → "foo"; a method call
// `feed.latestRoundData(...)` → "latestRoundData" (last identifier of the
// member_expression). Mirrors cstCallForbidden's calleeName.
function calleeName(call: any): string {
  const fn = call.childForFieldName?.("function") ?? call.namedChild?.(0) ?? call.child?.(0);
  if (!fn) return "";
  if (fn.type === "identifier") return (fn.text ?? "").trim();
  if (fn.type === "member_expression") {
    // last named identifier child is the method name
    let last = "";
    for (let i = 0; i < fn.childCount; i++) {
      const ch = fn.child(i);
      if (ch?.isNamed && ch.type === "identifier") last = (ch.text ?? "").trim();
    }
    return last;
  }
  // unwrap an `expression` wrapper
  if (fn.type === "expression" && fn.namedChildCount > 0) {
    return calleeName({ childForFieldName: () => fn.namedChild(0), namedChild: (i: number) => fn.namedChild(i), child: (i: number) => fn.child(i) });
  }
  return "";
}

// Does the scope contain an identifier or member_expression whose text equals `tok`?
// Matching real AST nodes (not raw source text) avoids counting the token inside a
// comment or string.
function tokenPresent(bodyNode: any, tok: string): boolean {
  if (tok.includes(".")) {
    for (const m of collect(bodyNode, "member_expression")) {
      if ((m.text ?? "").trim() === tok) return true;
    }
    return false;
  }
  for (const id of collect(bodyNode, "identifier")) {
    if ((id.text ?? "").trim() === tok) return true;
  }
  return false;
}

export const cstRequiredGuardMissing: CstChecker = (c, p) => {
  const triggerCall = String(p.triggerCall ?? "");
  const guardTokens: string[] = Array.isArray(p.guardTokens) ? p.guardTokens.map(String) : [];
  const guardMode = p.guardMode === "all" ? "all" : "any";

  const triggered = collect(c.bodyNode, "call_expression").some((ce) => calleeName(ce) === triggerCall);
  if (!triggered) {
    return {
      result: "pass",
      detail: (p.passDetail as string) ?? `${triggerCall} is not called in this scope`,
    };
  }

  const present = guardTokens.map((t) => tokenPresent(c.bodyNode, t));
  const guarded = guardMode === "all" ? present.every(Boolean) : present.some(Boolean);

  if (guarded) {
    return {
      result: "pass",
      detail: (p.passDetail as string) ?? `${triggerCall} is guarded (${guardTokens.join(", ")} present)`,
    };
  }
  return {
    result: "fail",
    detail: (p.failDetail as string) ??
      `${triggerCall} is called but no guard (${guardTokens.join(guardMode === "all" ? " AND " : " / ")}) is present in scope`,
  };
};
