import { SyntaxKind } from "ts-morph";
import type { CallExpression } from "ts-morph";
import type { Candidate } from "./finder.ts";

export type CheckResultKind = "pass" | "fail" | "cant_tell";

export interface CheckResult {
  ruleId: string;
  severity: "critical";
  result: CheckResultKind;
  file: string;
  line: number;
  title: string;
  detail: string;
}

function callName(call: CallExpression): string {
  const exp = call.getExpression();
  if (exp.getKind() === SyntaxKind.Identifier) return exp.getText();
  if (exp.getKind() === SyntaxKind.PropertyAccessExpression) {
    return exp.asKind(SyntaxKind.PropertyAccessExpression)!.getName();
  }
  return "";
}

// Does any argument of this call carry an object literal with BOTH `audience`
// and `issuer` (jose) — the aud/iss assertion that stops cross-app token reuse?
function assertsAudAndIss(call: CallExpression): boolean {
  for (const arg of call.getArguments()) {
    const obj = arg.asKind(SyntaxKind.ObjectLiteralExpression);
    if (!obj) continue;
    const names = obj.getProperties().map((p) => {
      const pa = p.asKind(SyntaxKind.PropertyAssignment) ?? p.asKind(SyntaxKind.ShorthandPropertyAssignment);
      return pa?.getName() ?? "";
    });
    const hasAud = names.includes("audience") || names.includes("aud");
    const hasIss = names.includes("issuer") || names.includes("iss");
    if (hasAud && hasIss) return true;
  }
  return false;
}

// Rule: privy-jwt-verification
// PASS  -> token is cryptographically verified AND aud + iss are asserted.
// FAIL  -> token is decoded without verification (auth bypass), or verified
//          without asserting aud/iss (cross-app token reuse).
// CANT_TELL -> no recognizable token handling.
export function checkTokenVerification(c: Candidate): CheckResult {
  const base = {
    ruleId: "privy-jwt-verification",
    severity: "critical" as const,
    file: c.filePath,
    line: c.fn.getStartLineNumber(),
    title: "Privy access token verified (signature + aud + iss)",
  };

  const calls = c.fn.getDescendantsOfKind(SyntaxKind.CallExpression);
  const verifyCalls = calls.filter((c2) => ["jwtVerify", "verify"].includes(callName(c2)));
  const decodeCalls = calls.filter((c2) => ["decodeJwt", "decode"].includes(callName(c2)));

  if (verifyCalls.length > 0) {
    if (verifyCalls.some(assertsAudAndIss)) {
      return { ...base, result: "pass", detail: "Token signature is verified and both aud and iss are asserted." };
    }
    return {
      ...base,
      result: "fail",
      detail: "Token signature is verified but aud/iss are not asserted. A valid token from another Privy app is accepted.",
    };
  }

  if (decodeCalls.length > 0) {
    return {
      ...base,
      result: "fail",
      detail: "Token is decoded without verifying its signature (e.g. decodeJwt/jwt.decode). Any forged token is accepted — auth bypass.",
    };
  }

  return { ...base, result: "cant_tell", detail: "No recognizable token verification or decode call found." };
}
