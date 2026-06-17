import { SyntaxKind } from "ts-morph";
import type { Checker } from "../types.ts";

// Checker: object-arg-property-forbidden-literal
//
// Verifies that a specific property inside an object-literal argument to a
// target call does NOT equal a forbidden literal value (e.g. slippageBps: 0
// disables slippage protection entirely).
//
// Required params:
//   call           — target function name (e.g. "quoteGet")
//   argIndex       — which positional argument to inspect (0-based)
//   propName       — property key to check (e.g. "slippageBps")
//   forbiddenValue — literal value that is unsafe (e.g. 0)
//
// Optional params:
//   passDetail          — message template for PASS
//   failDetail          — message for property present and equal to forbiddenValue
//   absentCallDetail    — message when the target call is not found (cant_tell)
//   absentArgDetail     — message when the arg/property is absent (cant_tell)
export const objectArgPropertyForbiddenLiteral: Checker = (c, p) => {
  const calls = c.fn
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((ce) => {
      const expr = ce.getExpression();
      if (expr.getKind() === SyntaxKind.Identifier) return expr.getText() === p.call;
      if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
        return expr.asKind(SyntaxKind.PropertyAccessExpression)!.getName() === p.call;
      }
      return false;
    });

  if (calls.length === 0) {
    return {
      result: "cant_tell",
      detail: (p.absentCallDetail as string) ?? `no ${p.call} call found`,
    };
  }

  const ce = calls[0];
  const args = ce.getArguments();
  const arg = args[p.argIndex as number];
  const objLit = arg?.asKind(SyntaxKind.ObjectLiteralExpression);

  if (!objLit) {
    return {
      result: "cant_tell",
      detail: (p.absentArgDetail as string) ??
        `${p.call} arg[${p.argIndex}] is not an inline object literal — cannot statically inspect ${p.propName}`,
    };
  }

  const propAssignment = objLit
    .getProperties()
    .map((prop) => prop.asKind(SyntaxKind.PropertyAssignment))
    .find((pa) => pa?.getName() === (p.propName as string));

  if (!propAssignment) {
    return {
      result: "cant_tell",
      detail: (p.absentArgDetail as string) ?? `${p.propName} is absent from the ${p.call} options`,
    };
  }

  const init = propAssignment.getInitializer();
  if (!init) {
    return { result: "cant_tell", detail: `${p.propName} has no initializer` };
  }

  const kind = init.getKind();
  const text = init.getText();
  const forbidden = JSON.stringify(p.forbiddenValue);

  const isForbidden =
    (kind === SyntaxKind.NumericLiteral || kind === SyntaxKind.StringLiteral) &&
    (text === forbidden || text === String(p.forbiddenValue));

  if (isForbidden) {
    return {
      result: "fail",
      detail: (p.failDetail as string) ?? `${p.propName} is ${p.forbiddenValue}`,
    };
  }

  if (kind === SyntaxKind.NumericLiteral || kind === SyntaxKind.StringLiteral) {
    return {
      result: "pass",
      detail: (p.passDetail as string) ?? `${p.propName} is ${text}`,
    };
  }

  return {
    result: "cant_tell",
    detail: `${p.propName} is a non-literal expression — cannot determine statically`,
  };
};
