import type { CstChecker } from "../types.ts";

// Checker: cst-struct-field-forbidden-literal (Go)
//
// The Go analog of object-arg-property-forbidden-literal: a struct/composite
// literal of a target type whose field is set to a forbidden literal. The
// canonical footgun is `tls.Config{InsecureSkipVerify: true}` — TLS certificate
// verification silently disabled (the Go twin of node's rejectUnauthorized:false,
// already in the corpus). Also fits `http.Cookie{Secure: false}`, etc.
//
// Required params:
//   typeName       — the composite-literal type, e.g. "tls.Config" (matched
//                    exactly or as a ".Config" suffix so `&tls.Config{...}` hits)
//   field          — the field key, e.g. "InsecureSkipVerify"
//   forbiddenValue — the unsafe literal, e.g. true
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

export const cstStructFieldForbiddenLiteral: CstChecker = (c, p) => {
  const typeName = String(p.typeName ?? "");
  const field = String(p.field ?? "");
  const forbiddenStr = String(p.forbiddenValue);

  for (const lit of collect(c.bodyNode, "composite_literal")) {
    const typeText = (lit.childForFieldName?.("type")?.text ?? "").trim();
    if (typeName && typeText !== typeName && !typeText.endsWith("." + typeName)) continue;

    const body = lit.childForFieldName?.("body") ?? collect(lit, "literal_value")[0];
    if (!body) continue;

    for (const ke of collect(body, "keyed_element")) {
      const parts = named(ke); // [key literal_element, value literal_element]
      if (parts.length < 2) continue;
      const key = (parts[0]?.text ?? "").trim();
      if (key !== field) continue;
      const valText = (parts[parts.length - 1]?.text ?? "").trim();
      if (valText === forbiddenStr) {
        return { result: "fail", detail: (p.failDetail as string) ?? `${typeName}.${field} is ${forbiddenStr}` };
      }
      // Present with a different literal → the safe state (the GREEN fixture).
      return { result: "pass", detail: (p.passDetail as string) ?? `${typeName}.${field} is ${valText}` };
    }
  }

  return {
    result: "cant_tell",
    detail: (p.absentDetail as string) ?? `no ${typeName}{ ${field}: … } literal in this scope`,
  };
};
