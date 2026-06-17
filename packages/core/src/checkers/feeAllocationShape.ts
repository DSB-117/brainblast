import { SyntaxKind } from "ts-morph";
import type { CallExpression, ObjectLiteralExpression, Expression } from "ts-morph";
import type { Candidate, Checker } from "../types.ts";

function callName(call: CallExpression): string {
  const exp = call.getExpression();
  if (exp.getKind() === SyntaxKind.Identifier) return exp.getText();
  if (exp.getKind() === SyntaxKind.PropertyAccessExpression) {
    return exp.asKind(SyntaxKind.PropertyAccessExpression)!.getName();
  }
  return "";
}

// Resolve an expression to an array-literal, following one level of local
// `const x = [...]` indirection within the candidate function. Real Bags code
// builds `const feeClaimers = [...]` and passes it by shorthand.
function asArrayLiteral(expr: Expression | undefined, c: Candidate) {
  if (!expr) return undefined;
  const direct = expr.asKind(SyntaxKind.ArrayLiteralExpression);
  if (direct) return direct;
  if (expr.getKind() === SyntaxKind.Identifier) {
    const name = expr.getText();
    for (const decl of c.fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      if (decl.getName() === name) {
        return decl.getInitializerIfKind(SyntaxKind.ArrayLiteralExpression);
      }
    }
  }
  return undefined;
}

// Find the array-literal value of `prop` among a call's object-literal args,
// resolving both `prop: [...]`, `prop: someArrayVar`, and shorthand `{ prop }`.
// Returns the array literal, `null` if the prop is present but not resolvable to
// a literal (dynamic), or `undefined` if the prop is absent entirely.
function feeArray(call: CallExpression, prop: string, c: Candidate) {
  for (const arg of call.getArguments()) {
    const obj = arg.asKind(SyntaxKind.ObjectLiteralExpression);
    if (!obj) continue;
    const member = obj.getProperty(prop);
    if (!member) continue;
    const pa = member.asKind(SyntaxKind.PropertyAssignment);
    if (pa) return asArrayLiteral(pa.getInitializer(), c) ?? null;
    const shorthand = member.asKind(SyntaxKind.ShorthandPropertyAssignment);
    if (shorthand) return asArrayLiteral(shorthand.getNameNode(), c) ?? null;
    return null;
  }
  return undefined;
}

function propInit(entry: ObjectLiteralExpression, name: string): Expression | undefined {
  return entry.getProperty(name)?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
}

// Vetted checker template (Bags fee-share creator-inclusion / BPS allocation).
// params: { configCall, arrayProp, walletProp, bpsProp, bpsTotal, creatorParamRegex,
//           absentDetail, dynamicDetail, creatorMissingDetail, bpsSumDetail, passDetail }
// PASS  -> configCall builds feeClaimers as a literal array, the creator param
//          appears as an entry's wallet, and the userBps sum to bpsTotal.
// FAIL  -> configCall absent (no fee config); creator omitted from the array;
//          or the literal BPS do not sum to bpsTotal.
// CANT_TELL -> the array is built dynamically (variable, spread, or .map) or the
//          BPS are non-literal — the trap can't be confirmed statically.
export const feeAllocationShape: Checker = (c, p) => {
  const calls = c.fn
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((x) => callName(x) === p.configCall);

  if (calls.length === 0) return { result: "fail", detail: p.absentDetail };

  const arr = feeArray(calls[0], p.arrayProp, c);
  if (arr === undefined || arr === null) {
    return { result: "cant_tell", detail: p.dynamicDetail };
  }

  const entries = arr.getElements().map((e) => e.asKind(SyntaxKind.ObjectLiteralExpression));
  if (entries.length === 0 || entries.some((e) => !e)) {
    // a spread, a call, or anything that isn't a plain entry object
    return { result: "cant_tell", detail: p.dynamicDetail };
  }

  const creatorParam = c.params.find((name) => new RegExp(p.creatorParamRegex, "i").test(name));
  const creatorIncluded = creatorParam
    ? entries.some((e) => propInit(e!, p.walletProp)?.getText() === creatorParam)
    : false;

  if (!creatorIncluded) return { result: "fail", detail: p.creatorMissingDetail };

  // BPS sum: only decidable when every entry's bps is a numeric literal.
  let sum = 0;
  let allNumeric = true;
  for (const e of entries) {
    const lit = propInit(e!, p.bpsProp)?.asKind(SyntaxKind.NumericLiteral);
    if (!lit) {
      allNumeric = false;
      break;
    }
    sum += Number(lit.getLiteralValue());
  }

  if (!allNumeric) return { result: "cant_tell", detail: p.dynamicDetail };
  if (sum !== p.bpsTotal) {
    return { result: "fail", detail: String(p.bpsSumDetail).replace("{sum}", String(sum)) };
  }
  return { result: "pass", detail: String(p.passDetail).replace("{param}", creatorParam!) };
};
