import { SyntaxKind } from "ts-morph";
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

// Rule: stripe-webhook-raw-body-verification
// PASS  -> constructEvent is called on the raw body parameter.
// FAIL  -> no constructEvent (forged events accepted), or it verifies a
//          parsed/derived value instead of the raw body (the silent trap).
// CANT_TELL -> a constructEvent call exists but the raw body can't be confirmed.
export function checkRawBodyVerification(c: Candidate): CheckResult {
  const base = {
    ruleId: "stripe-webhook-raw-body-verification",
    severity: "critical" as const,
    file: c.filePath,
    line: c.fn.getStartLineNumber(),
    title: "Stripe webhook signature verified on the raw body",
  };

  const constructEventCalls = c.fn
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => {
      const exp = call.getExpression();
      return (
        exp.getKind() === SyntaxKind.PropertyAccessExpression &&
        exp.asKind(SyntaxKind.PropertyAccessExpression)?.getName() === "constructEvent"
      );
    });

  if (constructEventCalls.length === 0) {
    const parsesBody = c.fn
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .some((call) => {
        const exp = call.getExpression();
        return (
          exp.getKind() === SyntaxKind.PropertyAccessExpression &&
          exp.asKind(SyntaxKind.PropertyAccessExpression)?.getName() === "parse"
        );
      });
    return {
      ...base,
      result: "fail",
      detail: parsesBody
        ? "Handler parses the request body but never calls stripe.webhooks.constructEvent. Forged 'payment_intent.succeeded' events are accepted."
        : "No stripe.webhooks.constructEvent call in the handler. Webhook signatures are not verified.",
    };
  }

  const firstArg = constructEventCalls[0].getArguments()[0];
  if (!firstArg) {
    return { ...base, result: "cant_tell", detail: "constructEvent called with no arguments." };
  }
  if (
    c.rawBodyParam &&
    firstArg.getKind() === SyntaxKind.Identifier &&
    firstArg.getText() === c.rawBodyParam
  ) {
    return {
      ...base,
      result: "pass",
      detail: `constructEvent verifies the raw body parameter '${c.rawBodyParam}'.`,
    };
  }
  if (firstArg.getKind() === SyntaxKind.CallExpression) {
    return {
      ...base,
      result: "fail",
      detail: "constructEvent is called on a parsed/derived value, not the raw request body. Verification is bypassed.",
    };
  }
  return {
    ...base,
    result: "cant_tell",
    detail: `Could not confirm the first argument to constructEvent is the raw body (got '${firstArg.getText()}').`,
  };
}
