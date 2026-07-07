import type { CstChecker } from "../types.ts";

// Checker: cst-call-forbidden (Solidity)
//
// Flags a call to a forbidden function by NAME inside a scope — the shape of
// low-level Solidity footguns that cst-member-access-forbidden cannot express
// because the receiver is a variable, not a fixed global:
//   selfdestruct(x)      — destroys the contract / force-sends ether (griefing,
//                          bricked upgradeable proxies, locked funds)
//   x.delegatecall(data) — runs untrusted code in THIS contract's storage/context
//   suicide(x)           — deprecated alias of selfdestruct
//
// Handles BOTH bare calls (`selfdestruct(...)`, a plain identifier callee) and
// method calls (`addr.delegatecall(...)`, a member_expression whose LAST
// identifier is the method), so the forbidden call is caught regardless of the
// receiver expression.
//
// "Forbidden call present" semantics: present → fail; absent → pass (the fixed
// fixture removes it / uses a safer call → a real GREEN). If saferCalls is
// provided and one is present in scope, that is an explicit PASS.
//
// Required params: forbiddenCalls (string[])
// Optional: saferCalls (string[]), passDetail, failDetail

function collect(node: any, kind: string, out: any[] = []): any[] {
  if (!node) return out;
  if (node.type === kind) out.push(node);
  for (let i = 0; i < node.childCount; i++) collect(node.child(i), kind, out);
  return out;
}

function namedKids(node: any): any[] {
  const out: any[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const k = node.child(i);
    if (k?.isNamed) out.push(k);
  }
  return out;
}

// The callee of a call_expression is its first named child — an `expression`
// wrapper around either an identifier (bare call) or a member_expression
// (method call). Unwrap the wrapper, then read the name.
function calleeName(call: any): string {
  let node = namedKids(call)[0];
  while (node && node.type === "expression") {
    const nk = namedKids(node);
    if (!nk.length) break;
    node = nk[0];
  }
  if (!node) return "";
  if (node.type === "identifier") return (node.text ?? "").trim();
  if (node.type === "member_expression") {
    const ids = namedKids(node).filter((k) => k.type === "identifier");
    return ids.length ? (ids[ids.length - 1].text ?? "").trim() : "";
  }
  return "";
}

export const cstCallForbidden: CstChecker = (c, p) => {
  const forbidden: string[] = (p.forbiddenCalls ?? []).map(String);
  const safer: string[] = (p.saferCalls ?? []).map(String);

  const names = collect(c.bodyNode, "call_expression").map(calleeName);

  if (safer.length && names.some((n) => safer.includes(n))) {
    return { result: "pass", detail: (p.passDetail as string) ?? `uses ${safer.join("/")}` };
  }
  if (names.some((n) => forbidden.includes(n))) {
    return { result: "fail", detail: (p.failDetail as string) ?? `calls ${forbidden.join("/")}` };
  }
  return { result: "pass", detail: (p.passDetail as string) ?? `no forbidden call in this scope` };
};
