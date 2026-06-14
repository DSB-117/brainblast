import { SyntaxKind } from "ts-morph";
import type { CallExpression, Node } from "ts-morph";
import type { Checker } from "../types.ts";

// Vetted checker template — flags a call argument whose expression
// multiplies/scales by the WRONG named constant. Catches traps like
// `amount * LAMPORTS_PER_SOL` passed to an SPL-token instruction that
// expects an amount scaled by the mint's decimals (`amount * 10 ** decimals`),
// not by the native-SOL lamports constant. The two only coincide when a
// token happens to use 9 decimals — for any other decimals count the minted
// amount is off by orders of magnitude.
//
// params: {
//   call: string,                  // function name to inspect
//   argIndex: number,               // 0-based positional arg (the amount expr)
//   forbiddenIdentifiers: string[], // identifiers that must NOT appear in the arg expression
//   expectedIdentifiers?: string[], // identifiers whose presence confirms a correct pattern (e.g. "decimals")
//   failDetail, passDetail, absentCallDetail, cantTellDetail
// }
//
// Outcomes:
//   fail      - the arg expression references a forbidden identifier anywhere
//               in its descendants (e.g. LAMPORTS_PER_SOL used as a multiplier).
//   pass      - the arg expression references one of expectedIdentifiers and
//               no forbidden identifier.
//   cant_tell - the candidate doesn't call `call`, the arg is absent, or the
//               arg expression matches neither pattern (can't classify statically).

function callName(call: CallExpression): string {
  const exp = call.getExpression();
  if (exp.getKind() === SyntaxKind.Identifier) return exp.getText();
  if (exp.getKind() === SyntaxKind.PropertyAccessExpression) {
    return exp.asKind(SyntaxKind.PropertyAccessExpression)!.getName();
  }
  return "";
}

function containsIdentifier(node: Node, name: string): boolean {
  if (node.getKind() === SyntaxKind.Identifier && node.getText() === name) return true;
  return node.getDescendantsOfKind(SyntaxKind.Identifier).some((id) => id.getText() === name);
}

export const literalMultiplierWrongConstant: Checker = (c, p) => {
  const calls = c.fn
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((x) => callName(x) === p.call);

  if (calls.length === 0) {
    return { result: "cant_tell", detail: p.absentCallDetail };
  }

  const arg = calls[0].getArguments()[p.argIndex];
  if (!arg) {
    return { result: "cant_tell", detail: p.absentCallDetail };
  }

  const forbidden: string[] = Array.isArray(p.forbiddenIdentifiers) ? p.forbiddenIdentifiers : [];
  for (const name of forbidden) {
    if (containsIdentifier(arg, name)) {
      return { result: "fail", detail: String(p.failDetail).replace("{got}", name) };
    }
  }

  const expected: string[] = Array.isArray(p.expectedIdentifiers) ? p.expectedIdentifiers : [];
  for (const name of expected) {
    if (containsIdentifier(arg, name)) {
      return { result: "pass", detail: String(p.passDetail) };
    }
  }

  return { result: "cant_tell", detail: p.cantTellDetail };
};
