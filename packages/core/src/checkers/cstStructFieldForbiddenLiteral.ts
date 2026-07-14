import type { CstChecker } from "../types.ts";

// Checker: cst-struct-field-forbidden-literal (Go + Solidity)
//
// The multi-language analog of object-arg-property-forbidden-literal: a struct /
// composite literal of a target type whose field is set to a forbidden literal.
//
// Go — the canonical footgun is `tls.Config{InsecureSkipVerify: true}` (TLS
// certificate verification silently disabled), also `http.Cookie{Secure: false}`.
//
// Solidity — the canonical footgun is a Uniswap-style params struct with a zeroed
// slippage floor: `ISwapRouter.ExactInputSingleParams({ …, amountOutMinimum: 0 })`
// (the swap accepts any output — fully sandwichable), or a launchpad token config
// with a zeroed fee. Solidity constructs a struct as a call with named
// `call_struct_argument`s, so the shapes differ from Go and each grammar gets its
// own walk; the checker dispatches on `c.lang`.
//
// Required params:
//   typeName       — the struct/composite type, e.g. "tls.Config" /
//                    "ExactInputSingleParams" (matched exactly or as a
//                    ".TypeName" suffix so `&tls.Config{...}` and
//                    `ISwapRouter.ExactInputSingleParams({...})` both hit)
//   field          — the field key, e.g. "InsecureSkipVerify" / "amountOutMinimum"
//   forbiddenValue — the unsafe literal, e.g. true / 0
// Optional: passDetail / failDetail / absentDetail.

function collect(node: any, kind: string, out: any[] = []): any[] {
  if (!node) return out;
  if (node.type === kind) out.push(node);
  for (let i = 0; i < node.childCount; i++) collect(node.child(i), kind, out);
  return out;
}

function named(node: any): any[] {
  const out: any[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c?.isNamed) out.push(c);
  }
  return out;
}

// A field name matches a struct type when it equals it exactly or is a
// member-access suffix (`pkg.Type` / `IRouter.Type`). Empty typeName matches any.
function typeMatches(typeText: string, typeName: string): boolean {
  if (!typeName) return true;
  return typeText === typeName || typeText.endsWith("." + typeName);
}

// ── Go: composite_literal { keyed_element* } ─────────────────────────────────
function checkGo(bodyNode: any, typeName: string, field: string, forbiddenStr: string, p: any) {
  for (const lit of collect(bodyNode, "composite_literal")) {
    const typeText = (lit.childForFieldName?.("type")?.text ?? "").trim();
    if (!typeMatches(typeText, typeName)) continue;

    const body = lit.childForFieldName?.("body") ?? collect(lit, "literal_value")[0];
    if (!body) continue;

    for (const ke of collect(body, "keyed_element")) {
      const parts = named(ke); // [key literal_element, value literal_element]
      if (parts.length < 2) continue;
      const key = (parts[0]?.text ?? "").trim();
      if (key !== field) continue;
      const valText = (parts[parts.length - 1]?.text ?? "").trim();
      if (valText === forbiddenStr) {
        return { result: "fail" as const, detail: (p.failDetail as string) ?? `${typeName}.${field} is ${forbiddenStr}` };
      }
      return { result: "pass" as const, detail: (p.passDetail as string) ?? `${typeName}.${field} is ${valText}` };
    }
  }
  return null;
}

// ── Solidity: call_expression → call_argument → call_struct_argument* ─────────
// A Solidity struct literal is a call whose callee is the struct type and whose
// argument is a brace-list of `call_struct_argument` (field: value) pairs:
//   ISwapRouter02.ExactInputSingleParams({ tokenIn: …, amountOutMinimum: 0 })
// Each call_struct_argument's named children are [identifier(field), expression(value)].
function checkSolidity(bodyNode: any, typeName: string, field: string, forbiddenStr: string, p: any) {
  for (const call of collect(bodyNode, "call_expression")) {
    // The callee is the first named child (`expression` / member_expression / identifier).
    const callee = (named(call)[0]?.text ?? "").trim();
    if (!typeMatches(callee, typeName)) continue;

    // Only the DIRECT call_argument's struct fields — nested struct calls are
    // separate call_expression nodes handled by their own iteration.
    const callArg = named(call).find((n) => n.type === "call_argument");
    if (!callArg) continue;
    const structArgs = named(callArg).filter((n) => n.type === "call_struct_argument");

    for (const sa of structArgs) {
      const kids = named(sa); // [identifier(field), expression(value)]
      if (kids.length < 2) continue;
      const key = (kids[0]?.text ?? "").trim();
      if (key !== field) continue;
      const valText = (kids[kids.length - 1]?.text ?? "").trim();
      if (valText === forbiddenStr) {
        return { result: "fail" as const, detail: (p.failDetail as string) ?? `${typeName}.${field} is ${forbiddenStr}` };
      }
      return { result: "pass" as const, detail: (p.passDetail as string) ?? `${typeName}.${field} is ${valText}` };
    }
  }
  return null;
}

export const cstStructFieldForbiddenLiteral: CstChecker = (c, p) => {
  const typeName = String(p.typeName ?? "");
  const field = String(p.field ?? "");
  const forbiddenStr = String(p.forbiddenValue);

  const hit =
    c.lang === "solidity"
      ? checkSolidity(c.bodyNode, typeName, field, forbiddenStr, p)
      : checkGo(c.bodyNode, typeName, field, forbiddenStr, p);

  return (
    hit ?? {
      result: "cant_tell",
      detail: (p.absentDetail as string) ?? `no ${typeName}{ ${field}: … } literal in this scope`,
    }
  );
};
