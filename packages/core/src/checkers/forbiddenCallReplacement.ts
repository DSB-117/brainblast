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

// Checker: forbidden-call-replacement
//
// Flags calls to a "forbidden" function when a "safer" alternative exists
// and was not used instead — e.g. createTransferInstruction (no mint/decimals
// validation) where createTransferCheckedInstruction is available.
//
// Required params:
//   forbiddenCalls — call names that should be replaced (e.g. ["createTransferInstruction"])
//   saferCalls     — call names that are the safe alternative (e.g. ["createTransferCheckedInstruction"])
//
// Optional params:
//   passDetail    — message for PASS (a saferCall is used)
//   failDetail    — message for FAIL (a forbiddenCall is used, no saferCall)
//   absentDetail  — message for CANT_TELL (neither call found)
export const forbiddenCallReplacement: Checker = (c, p) => {
  const calls = c.fn.getDescendantsOfKind(SyntaxKind.CallExpression);
  const names = calls.map(callName);

  const forbidden: string[] = p.forbiddenCalls ?? [];
  const safer: string[] = p.saferCalls ?? [];

  const usesSafer = names.some((n) => safer.includes(n));
  if (usesSafer) {
    return { result: "pass", detail: (p.passDetail as string) ?? `uses ${safer.join("/")}` };
  }

  const usesForbidden = names.some((n) => forbidden.includes(n));
  if (usesForbidden) {
    return { result: "fail", detail: (p.failDetail as string) ?? `uses ${forbidden.join("/")}` };
  }

  return {
    result: "cant_tell",
    detail: (p.absentDetail as string) ?? `neither ${forbidden.join("/")} nor ${safer.join("/")} found`,
  };
};
