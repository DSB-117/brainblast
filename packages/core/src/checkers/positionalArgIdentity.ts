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

  if (calls.length === 0) {
    // Before reporting a hard FAIL, check whether the call exists elsewhere in the
    // same source file.  If it does, this function likely delegates to another
    // function in the file that performs the check (e.g. a `constructStripeEvent`
    // helper called from the outer handler).  Static analysis can't follow the
    // call chain, so we return cant_tell rather than a false FAIL.
    const sf = c.fn.getSourceFile();
    const existsInFile = sf.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
      const exp = call.getExpression();
      return (
        exp.getKind() === SyntaxKind.PropertyAccessExpression &&
        exp.asKind(SyntaxKind.PropertyAccessExpression)!.getName() === p.call
      );
    });
    if (existsInFile) {
      return {
        result: "cant_tell",
        detail: `${p.call} is called elsewhere in this file; unable to confirm this function's delegation path statically.`,
      };
    }
    return { result: "fail", detail: p.absentDetail };
  }

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
