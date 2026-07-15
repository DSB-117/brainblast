import type { CstChecker } from "../types.ts";

// Checker: cst-positional-arg-forbidden-literal (Solidity)
//
// The Solidity positional-argument analog of object-arg/struct-field forbidden
// literal. Many of the most common EVM footguns pass the dangerous value
// POSITIONALLY, not as a named struct field — the Uniswap V2 family especially:
//   router.addLiquidityETH(token, bal, 0, 0, to, deadline)   // amountTokenMin / amountETHMin = 0
//   uni.swapExactTokensForTokens(amountIn, 0, path, to, dl)   // amountOutMin = 0  (sandwichable)
//   pool.removeLiquidity(a, b, lp, 0, 0, to, dl)              // min-outs = 0
// A zeroed min-out silently disables slippage protection. cst-struct-field only
// inspects named struct fields; cst-call-forbidden only checks the callee name —
// neither can express "the Nth positional argument is a forbidden literal", so
// the scouts kept hitting these V2 sites with no checker to bind them to.
//
// Semantics mirror the JS positional-arg-forbidden-literal: the trap is a
// HARDCODED forbidden literal in the slot. The forbidden literal → fail; any
// other value (a different literal, or a computed/variable expression — the safe
// GREEN case) → pass; the call/arg absent → cant_tell. Recognizes bare `0` and a
// numeric-cast zero (`uint256(0)`, `uint(0)`).
//
// Required params: call, argIndex, forbiddenValue
// Optional: passDetail, failDetail, absentCallDetail, absentArgDetail

function namedKids(node: any): any[] {
  const out: any[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const k = node.child(i);
    if (k?.isNamed) out.push(k);
  }
  return out;
}

function collect(node: any, kind: string, out: any[] = []): any[] {
  if (!node) return out;
  if (node.type === kind) out.push(node);
  for (let i = 0; i < node.childCount; i++) collect(node.child(i), kind, out);
  return out;
}

// The method/function name of a call_expression: unwrap the `expression` wrapper,
// then take the last identifier of a member_expression (`router.addLiquidityETH`
// → "addLiquidityETH") or the bare identifier (`swap(...)` → "swap").
function calleeName(call: any): string {
  let node = namedKids(call)[0];
  // Unwrap `expression` wrappers AND the payable-call `struct_expression`
  // (`router.addLiquidityETH{value: x}(...)` — extremely common for V2 LP seeds),
  // whose first named child is the real callee expression.
  while (node && (node.type === "expression" || node.type === "struct_expression")) {
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
  return (node.text ?? "").trim();
}

// Does a positional argument's source text equal the forbidden literal? Handles
// a bare literal and a numeric-cast wrapper around it (`uint256(0)`, `uint(0)`,
// `int128(0)`) — idiomatic Solidity for a typed zero.
function argIsForbidden(argText: string, forbiddenStr: string): boolean {
  const t = argText.trim();
  if (t === forbiddenStr) return true;
  const cast = t.match(/^u?int\d*\(\s*(.+?)\s*\)$/);
  return !!cast && cast[1].trim() === forbiddenStr;
}

export const cstPositionalArgForbiddenLiteral: CstChecker = (c, p) => {
  if (c.lang !== "solidity") {
    return { result: "cant_tell", detail: `cst-positional-arg-forbidden-literal supports Solidity only (got ${c.lang})` };
  }
  const call = String(p.call ?? "");
  const argIndex = Number(p.argIndex ?? 0);
  const forbiddenStr = String(p.forbiddenValue);

  // Scan ALL matching calls, not just the first. A scope often calls the target
  // more than once (e.g. a multi-hop router: the final hop passes a real min-out
  // while intermediate hops pass a literal 0). If ANY matching call has the
  // forbidden literal in the slot, the scope is unsafe → fail. Only when every
  // matching call's slot is a non-forbidden value is the scope safe → pass. (The
  // old first-match return missed the footgun whenever a safe call came first.)
  let sawCall = false;
  let sawArg = false;
  let safeArgText = "";
  for (const ce of collect(c.bodyNode, "call_expression")) {
    if (calleeName(ce) !== call) continue;
    sawCall = true;
    // Positional arguments are the `call_argument` direct children, in order.
    // (A struct literal uses `call_struct_argument` instead — not positional.)
    const args = namedKids(ce).filter((k) => k.type === "call_argument");
    const arg = args[argIndex];
    if (!arg) continue;
    sawArg = true;
    if (argIsForbidden(arg.text ?? "", forbiddenStr)) {
      return { result: "fail", detail: (p.failDetail as string) ?? `${call} positional arg[${argIndex}] is the forbidden literal ${forbiddenStr}` };
    }
    safeArgText = (arg.text ?? "").trim();
  }

  if (!sawCall) {
    return { result: "cant_tell", detail: (p.absentCallDetail as string) ?? `no ${call}(...) call in this scope` };
  }
  if (!sawArg) {
    return { result: "cant_tell", detail: (p.absentArgDetail as string) ?? `${call} has no positional arg at index ${argIndex}` };
  }
  return { result: "pass", detail: (p.passDetail as string) ?? `${call} arg[${argIndex}] is ${safeArgText}, not the forbidden ${forbiddenStr}` };
};
