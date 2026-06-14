import { SyntaxKind } from "ts-morph";
import type { CallExpression, Node } from "ts-morph";
import type { Fixer } from "../types.ts";
import { buildDiff } from "./diffUtil.ts";

function callName(call: CallExpression): string {
  const exp = call.getExpression();
  if (exp.getKind() === SyntaxKind.Identifier) return exp.getText();
  if (exp.getKind() === SyntaxKind.PropertyAccessExpression) {
    return exp.asKind(SyntaxKind.PropertyAccessExpression)!.getName();
  }
  return "";
}

function findIdentifier(node: Node, name: string): Node | undefined {
  if (node.getKind() === SyntaxKind.Identifier && node.getText() === name) return node;
  return node.getDescendantsOfKind(SyntaxKind.Identifier).find((id) => id.getText() === name);
}

// Fixer counterpart to checkers/literalMultiplierWrongConstant.ts.
// params: { call, argIndex, forbiddenIdentifiers, expectedIdentifiers, ... } (same
// shape as the checker).
//
// FAIL (arg references a forbidden constant like LAMPORTS_PER_SOL): if the
// expected identifier (e.g. `decimals`) is already in scope as a parameter of
// the enclosing function, mechanically swap the forbidden identifier for
// `10 ** <expected>`. Otherwise the function doesn't have the right value
// available — return guidance instead of a diff, since synthesizing a new
// parameter (and threading it through every call site) isn't a safe
// mechanical change.
export const fixLiteralMultiplierWrongConstant: Fixer = (c, p, outcome) => {
  if (outcome.result !== "fail") return undefined;

  const calls = c.fn
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => callName(call) === p.call);
  if (calls.length === 0) return undefined;

  const arg = calls[0]!.getArguments()[p.argIndex];
  if (!arg) return undefined;

  const forbidden: string[] = Array.isArray(p.forbiddenIdentifiers) ? p.forbiddenIdentifiers : [];
  const forbiddenNode = forbidden.map((name) => findIdentifier(arg, name)).find((n) => n);
  if (!forbiddenNode) return undefined;

  const expected: string[] = Array.isArray(p.expectedIdentifiers) ? p.expectedIdentifiers : [];
  const expectedName = expected.find((name) => c.params.includes(name));

  if (!expectedName) {
    return {
      summary: `Scale by the mint's decimals instead of ${forbiddenNode.getText()}`,
      suggestion:
        `'${forbiddenNode.getText()}' is the native-SOL lamports constant (1e9), not the mint's ` +
        `decimals. Add a 'decimals: number' parameter to this function (threaded from the mint's ` +
        `configuration) and scale the amount with '10 ** decimals' instead of ` +
        `'${forbiddenNode.getText()}'.`,
    };
  }

  return {
    summary: `Scale by 10 ** ${expectedName} instead of ${forbiddenNode.getText()}`,
    diff: buildDiff(forbiddenNode, `10 ** ${expectedName}`),
  };
};
