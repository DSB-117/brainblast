import { SyntaxKind } from "ts-morph";
import type { CallExpression } from "ts-morph";
import type { Checker } from "../types.ts";

function callName(call: CallExpression): string {
  const exp = call.getExpression();
  if (exp.getKind() === SyntaxKind.Identifier) return exp.getText();
  if (exp.getKind() === SyntaxKind.PropertyAccessExpression) {
    return exp.asKind(SyntaxKind.PropertyAccessExpression)!.getName();
  }
  return "";
}

// All synonym groups must be satisfied by one options object on the call.
function hasAllProps(call: CallExpression, groups: string[][]): boolean {
  for (const arg of call.getArguments()) {
    const obj = arg.asKind(SyntaxKind.ObjectLiteralExpression);
    if (!obj) continue;
    const names = obj.getProperties().map((pr) => {
      const pa =
        pr.asKind(SyntaxKind.PropertyAssignment) ?? pr.asKind(SyntaxKind.ShorthandPropertyAssignment);
      return pa?.getName() ?? "";
    });
    if (groups.every((g) => g.some((n) => names.includes(n)))) return true;
  }
  return false;
}

// Vetted checker template (T2's matcher, generalized).
// params: { verifyCalls, decodeCalls, requiredProps (synonym groups),
//           passDetail, missingPropsDetail, decodeOnlyDetail }
export const requiredCallWithOptions: Checker = (c, p) => {
  const calls = c.fn.getDescendantsOfKind(SyntaxKind.CallExpression);
  const verify = calls.filter((x) => p.verifyCalls.includes(callName(x)));
  const decode = calls.filter((x) => p.decodeCalls.includes(callName(x)));

  if (verify.length > 0) {
    if (verify.some((v) => hasAllProps(v, p.requiredProps))) {
      return { result: "pass", detail: p.passDetail };
    }
    return { result: "fail", detail: p.missingPropsDetail };
  }
  if (decode.length > 0) return { result: "fail", detail: p.decodeOnlyDetail };
  return { result: "cant_tell", detail: "No verification or decode call found." };
};
