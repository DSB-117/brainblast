import { SyntaxKind } from "ts-morph";
import type { CallExpression, Expression } from "ts-morph";
import type { Candidate, Checker } from "../types.ts";

// Checker: fee-configs-zero-or-missing
//
// Fee Config Validator (v0.7.5) — the generalized Bags exploit.
//
// The Bags trap was one instance of a whole class: a *revenue-bearing* field in
// a config object that, if omitted, silently defaults to zero. The protocol
// runs fine, no error is thrown, and the creator/treasury/holder simply earns
// nothing — permanently. The same shape recurs everywhere money is split:
// royalties (Metaplex `sellerFeeBasisPoints`), transfer fees, LP/reward
// allocation rates, referral bps.
//
// This checker validates one such field on a setup/config call:
//
//   FAIL (omitted)      — the field is absent from the config object, so it
//                         defaults to zero. The silent, permanent footgun.
//   FAIL (literal zero) — the field is present but a literal `0` (or `0n`/`0.0`).
//   PASS                — present as a non-zero numeric literal, OR a non-literal
//                         expression (variable / call like `percentAmount(5)`):
//                         evidence it was set on purpose; we can't prove zero.
//   CANT_TELL           — no matching config call in this function (rule N/A),
//                         or the argument isn't an object literal we can read.
//
// Params:
//   calls      — string | string[] of config/setup call names (e.g. "create",
//                ["createV1","createNft"]). Required.
//   field      — the revenue field to validate (e.g. "sellerFeeBasisPoints"). Required.
//   absentDetail / omittedDetail / zeroDetail / passDetail — message overrides.

function callName(call: CallExpression): string {
  const exp = call.getExpression();
  if (exp.getKind() === SyntaxKind.Identifier) return exp.getText();
  if (exp.getKind() === SyntaxKind.PropertyAccessExpression) {
    return exp.asKind(SyntaxKind.PropertyAccessExpression)!.getName();
  }
  return "";
}

// Strip `expr as T`, `<T>expr`, `(expr)`, and `expr!` so casts (common in real
// SDK code — `{ ... } as any`, `0 as any`) don't hide the underlying literal.
function unwrap(expr: Expression | undefined): Expression | undefined {
  let e = expr;
  while (e) {
    const k = e.getKind();
    if (
      k === SyntaxKind.AsExpression ||
      k === SyntaxKind.ParenthesizedExpression ||
      k === SyntaxKind.TypeAssertionExpression ||
      k === SyntaxKind.NonNullExpression
    ) {
      e = (e as any).getExpression();
    } else break;
  }
  return e;
}

// Is this expression a literal numeric zero (0, 0n, 0.0, 0x0)?
function isLiteralZero(expr: Expression | undefined): boolean {
  const u = unwrap(expr);
  if (!u) return false;
  const num = u.asKind(SyntaxKind.NumericLiteral);
  if (num) return Number(num.getLiteralValue()) === 0;
  const big = u.asKind(SyntaxKind.BigIntLiteral);
  if (big) return /^0n?$/.test(big.getText().replace(/_/g, ""));
  return false;
}

export const feeConfigsZeroOrMissing: Checker = (c, p) => {
  const names: string[] = Array.isArray(p.calls) ? p.calls : [p.calls];
  const field: string = p.field;

  const calls = c.fn
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((x) => names.includes(callName(x)));

  if (calls.length === 0) {
    return {
      result: "cant_tell",
      detail: p.absentDetail ?? `No call to ${names.join("/")} in '${c.fnName}'; fee-configs check does not apply.`,
    };
  }

  // Evaluate the first matching call that carries an object-literal argument.
  for (const call of calls) {
    const obj = call
      .getArguments()
      .map((a) => unwrap(a as Expression)?.asKind(SyntaxKind.ObjectLiteralExpression))
      .find((o) => !!o);
    if (!obj) continue;

    const member = obj.getProperty(field);
    if (!member) {
      return {
        result: "fail",
        detail:
          p.omittedDetail ??
          `'${field}' is omitted from the ${callName(call)} config — it defaults to zero. ` +
            `This is a permanent, silent zero-revenue misconfiguration: the call succeeds and no value is ever collected. Set '${field}' explicitly.`,
      };
    }

    const pa = member.asKind(SyntaxKind.PropertyAssignment);
    const shorthand = member.asKind(SyntaxKind.ShorthandPropertyAssignment);
    const init = pa?.getInitializer() ?? shorthand?.getNameNode();

    if (isLiteralZero(init)) {
      return {
        result: "fail",
        detail:
          p.zeroDetail ??
          `'${field}' is set to a literal 0 in the ${callName(call)} config — zero revenue will ever be collected. If intentional, this is a footgun; otherwise set a non-zero value.`,
      };
    }

    return {
      result: "pass",
      detail:
        p.passDetail ??
        `'${field}' is set to a non-zero value in the ${callName(call)} config.`,
    };
  }

  // Matching call(s) existed but none had a readable object-literal argument.
  return {
    result: "cant_tell",
    detail:
      p.absentDetail ??
      `Call to ${names.join("/")} found but its config argument isn't an object literal; can't validate '${field}'.`,
  };
};
