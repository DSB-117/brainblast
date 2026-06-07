import { SyntaxKind } from "ts-morph";
import type { Checker } from "../types.ts";

// Vetted checker template (T1's matcher, generalized).
// params: { call, argIndex, paramIndex, absentDetail, parsedDetail, passDetail }
// PASS  -> `call(...)` exists and arg[argIndex] is the handler's param[paramIndex].
// FAIL  -> call absent, or the arg is a derived/parsed value (a CallExpression).
export const positionalArgIdentity: Checker = (c, p) => {
  const calls = c.fn.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    const exp = call.getExpression();
    return (
      exp.getKind() === SyntaxKind.PropertyAccessExpression &&
      exp.asKind(SyntaxKind.PropertyAccessExpression)!.getName() === p.call
    );
  });

  if (calls.length === 0) return { result: "fail", detail: p.absentDetail };

  const arg = calls[0].getArguments()[p.argIndex];
  const wantParam = c.params[p.paramIndex];

  if (arg && wantParam && arg.getKind() === SyntaxKind.Identifier && arg.getText() === wantParam) {
    return { result: "pass", detail: String(p.passDetail).replace("{param}", wantParam) };
  }
  if (arg && arg.getKind() === SyntaxKind.CallExpression) {
    return { result: "fail", detail: p.parsedDetail };
  }
  return {
    result: "cant_tell",
    detail: `Could not confirm argument ${p.argIndex} of ${p.call} is the raw input.`,
  };
};
