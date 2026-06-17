import { SyntaxKind } from "ts-morph";
import type { Fixer } from "../types.ts";
import { buildDiff } from "./diffUtil.ts";

// Fixer counterpart to checkers/positionalArgIdentity.ts.
// params: { call, argIndex, paramIndex, ... } (same shape as the checker).
//
// FAIL "absentDetail" (call missing entirely): brainblast cannot safely
// synthesize a brand-new verification call (it doesn't know the verifier
// instance's variable name, the secret env var, etc.) — return guidance only.
//
// FAIL "parsedDetail" (arg is a derived/parsed CallExpression, e.g.
// JSON.parse(req.body)): mechanical fix — swap that argument for the raw
// param identifier.
export const fixPositionalArgIdentity: Fixer = (c, p, outcome) => {
  if (outcome.result !== "fail") return undefined;

  const calls = c.fn.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    const exp = call.getExpression();
    return (
      exp.getKind() === SyntaxKind.PropertyAccessExpression &&
      exp.asKind(SyntaxKind.PropertyAccessExpression)!.getName() === p.call
    );
  });

  if (calls.length === 0) {
    const wantParam = c.params[p.paramIndex] ?? "<rawBodyParam>";
    return {
      summary: `Add a ${p.call} call that verifies the raw request body`,
      suggestion:
        `No '${p.call}' call was found in this handler. Verify the signature against the ` +
        `raw, unparsed request body — parameter '${wantParam}' — before trusting the event, e.g.:\n\n` +
        `  const event = stripe.webhooks.constructEvent(${wantParam}, signature, process.env.STRIPE_WEBHOOK_SECRET!);\n\n` +
        `Do not call JSON.parse() on the body before this verification step.`,
    };
  }

  const arg = calls[0]!.getArguments()[p.argIndex];
  const wantParam = c.params[p.paramIndex];

  if (arg && wantParam && arg.getKind() === SyntaxKind.CallExpression) {
    return {
      summary: `Pass the raw body parameter '${wantParam}' to ${p.call} instead of a parsed value`,
      diff: buildDiff(arg, wantParam),
    };
  }

  return undefined;
};
