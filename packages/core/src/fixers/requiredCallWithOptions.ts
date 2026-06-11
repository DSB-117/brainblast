import { SyntaxKind } from "ts-morph";
import type { CallExpression } from "ts-morph";
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

// Best-effort placeholder values for the synonym groups this checker
// understands. Generic property names fall back to a TODO marker the
// developer must fill in.
function placeholderFor(propName: string): string {
  switch (propName) {
    case "audience":
    case "aud":
      return `audience: process.env.PRIVY_APP_ID`;
    case "issuer":
    case "iss":
      return `issuer: "https://privy.io"`;
    default:
      return `${propName}: undefined /* TODO: brainblast could not infer this value */`;
  }
}

// Fixer counterpart to checkers/requiredCallWithOptions.ts.
// params: { verifyCalls, decodeCalls, requiredProps, ... } (same shape as the checker).
//
// FAIL "missingPropsDetail" (verify call exists, but is missing required
// option groups like audience/issuer): mechanical fix — merge the missing
// properties into the call's options object literal (or append a new options
// object if none exists).
//
// FAIL "decodeOnlyDetail" (only a decode call, no verification): switching
// from decode to a verified call requires structural changes (key source,
// JWKS, etc.) brainblast cannot safely synthesize — return guidance only.
export const fixRequiredCallWithOptions: Fixer = (c, p, outcome) => {
  if (outcome.result !== "fail") return undefined;

  const calls = c.fn.getDescendantsOfKind(SyntaxKind.CallExpression);
  const verify = calls.filter((x) => p.verifyCalls.includes(callName(x)));

  if (verify.length > 0) {
    const call = verify[0]!;
    const args = call.getArguments();
    const lastArg = args[args.length - 1];
    const obj = lastArg?.asKind(SyntaxKind.ObjectLiteralExpression);

    const presentNames = obj
      ? obj.getProperties().map((pr) => {
          const pa =
            pr.asKind(SyntaxKind.PropertyAssignment) ?? pr.asKind(SyntaxKind.ShorthandPropertyAssignment);
          return pa?.getName() ?? "";
        })
      : [];
    const missingGroups = (p.requiredProps as string[][]).filter(
      (g) => !g.some((n) => presentNames.includes(n)),
    );
    if (missingGroups.length === 0) return undefined;

    const newProps = missingGroups.map((g) => placeholderFor(g[0]!)).join(", ");
    const summary = `Add ${missingGroups.map((g) => g[0]).join(" and ")} to the ${callName(call)} call`;

    if (obj) {
      const inner = obj.getText().slice(1, -1).trim();
      const newText = inner.length > 0 ? `{ ${inner}, ${newProps} }` : `{ ${newProps} }`;
      return { summary, diff: buildDiff(obj, newText) };
    }

    if (lastArg) {
      const newText = `${lastArg.getText()}, { ${newProps} }`;
      return { summary, diff: buildDiff(lastArg, newText) };
    }

    return {
      summary,
      suggestion: `Add an options object ({ ${newProps} }) as an argument to ${callName(call)}.`,
    };
  }

  return {
    summary: "Replace the decode-only call with a verified call",
    suggestion:
      `This token is decoded without verifying its signature, accepting any forged token. ` +
      `Replace the decode call with a verifying call that asserts audience and issuer, e.g.:\n\n` +
      `  const { payload } = await jwtVerify(token, JWKS, { audience: process.env.PRIVY_APP_ID, issuer: "https://privy.io" });\n\n` +
      `JWKS must come from Privy's published JWKS endpoint for your app.`,
  };
};
