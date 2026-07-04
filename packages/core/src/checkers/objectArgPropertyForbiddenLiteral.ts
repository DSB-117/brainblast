import { SyntaxKind } from "ts-morph";
import type { Expression, ObjectLiteralExpression, PropertyAssignment } from "ts-morph";
import type { Checker } from "../types.ts";

// Amounts, percentages and slippage are rarely bare literals in real SDK code —
// they are wrapped in a numeric/percentage constructor or factory:
//   minOutAmount: new BN(0)            tipLamports: new anchor.BN(0)
//   slippage: Percentage.fromFraction(0, 100)   (Orca / Cetus)
//   sellerFeeBasisPoints: percentAmount(0)      (Metaplex umi)
//   fee: new Decimal(0)
// The bare-literal check misses all of these, so a real zeroed-slippage / zeroed-
// royalty footgun slips through. Recognize the well-known numeric wrappers so a
// value that provably evaluates to zero counts as the forbidden 0. Only meaningful
// when the forbidden value is 0.
//
// Two constructor shapes:
//   NUMERIC_WRAPPER  — `new BN(0)`, `percentAmount(0)`, `new Decimal(0)` etc.:
//                      the FIRST arg is the numeric value.
//   FRACTION_FACTORY — `Percentage.fromFraction(0, 100)`, `.fromDecimal(0)` etc.:
//                      a zero NUMERATOR (first arg) is a zero fraction.
const NUMERIC_WRAPPER = /(^|\.)(bn|bignum|bignumber|decimal|percentamount|percentage)$/i;
const FRACTION_FACTORY = /\.(fromfraction|fromdecimal|fromnumber|fromratio|frompercent|frompercentage)$/i;

function calleeOf(init: Expression): string {
  const isNewOrCall = init.getKind() === SyntaxKind.NewExpression || init.getKind() === SyntaxKind.CallExpression;
  if (!isNewOrCall) return "";
  return (init as any).getExpression?.()?.getText?.() ?? "";
}

// A call to one of the recognized numeric/percentage wrappers, regardless of args.
// Used to treat a fixed fixture's non-zero wrapper (e.g. `Percentage.fromFraction(500, 10000)`)
// as a determinable safe value → PASS.
function isKnownNumericWrapperCall(init: Expression): boolean {
  const c = calleeOf(init);
  return c !== "" && (NUMERIC_WRAPPER.test(c) || FRACTION_FACTORY.test(c));
}

// A recognized numeric/percentage wrapper whose numeric value provably evaluates
// to zero (first arg is a literal 0 / "0"). Generalizes the old BN-zero handling.
function isZeroValuedNumericCall(init: Expression): boolean {
  if (!isKnownNumericWrapperCall(init)) return false;
  const args = (init as any).getArguments?.() ?? [];
  if (args.length === 0) return false;
  const a = args[0];
  const k = a.getKind();
  if (k === SyntaxKind.NumericLiteral) return Number(a.getLiteralValue()) === 0;
  if (k === SyntaxKind.StringLiteral) return a.getLiteralValue() === "0";
  return false;
}

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
  // Match both plain calls `foo({...})` and constructor calls `new Foo({...})`.
  // Many SDK footguns live in a constructor's options object (e.g. passport-jwt
  // `new Strategy({ ignoreExpiration: true })`, `new Pool({ ssl: {...} })`), which
  // are NewExpression nodes, not CallExpression — both expose getExpression()/getArguments().
  const calls = [
    ...c.fn.getDescendantsOfKind(SyntaxKind.CallExpression),
    ...c.fn.getDescendantsOfKind(SyntaxKind.NewExpression),
  ].filter((ce) => {
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

  // propName may be a dotted PATH into nested object literals, e.g.
  // `ssl.rejectUnauthorized` for `new Pool({ ssl: { rejectUnauthorized: false } })`
  // or `tls.rejectUnauthorized` for nodemailer.createTransport. A single segment
  // (no dot) behaves exactly as before. We only descend through inline object
  // literals; a non-inline intermediate (spread, variable, call) is `cant_tell`.
  const path = String(p.propName).split(".");
  let cursor: ObjectLiteralExpression | undefined = objLit;
  let propAssignment: PropertyAssignment | undefined = undefined;

  for (let i = 0; i < path.length; i++) {
    if (!cursor) break;
    const seg = path[i];
    const pa: PropertyAssignment | undefined = cursor
      .getProperties()
      .map((prop) => prop.asKind(SyntaxKind.PropertyAssignment))
      .find((x) => x?.getName() === seg);
    if (!pa) {
      propAssignment = undefined;
      break;
    }
    if (i === path.length - 1) {
      propAssignment = pa;
      break;
    }
    cursor = pa.getInitializer()?.asKind(SyntaxKind.ObjectLiteralExpression);
  }

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

  // Boolean flags are the canonical shape of insecure-default footguns
  // (`rejectUnauthorized: false`, `ignoreExpiration: true`, `secure: false`).
  // ts-morph models `true`/`false` as keyword nodes, not Numeric/StringLiteral,
  // so they need their own branch.
  const isBool = kind === SyntaxKind.TrueKeyword || kind === SyntaxKind.FalseKeyword;
  const isStringOrNumber = kind === SyntaxKind.NumericLiteral || kind === SyntaxKind.StringLiteral;

  const isLiteralForbidden =
    (isStringOrNumber && (text === forbidden || text === String(p.forbiddenValue))) ||
    (isBool && typeof p.forbiddenValue === "boolean" && text === String(p.forbiddenValue));

  // A numeric/percentage wrapper that evaluates to zero — `new BN(0)`,
  // `Percentage.fromFraction(0, 100)`, `percentAmount(0)` — counts as the forbidden
  // zero (idiomatic amount/slippage/royalty code the bare-literal check misses).
  const isForbidden = isLiteralForbidden || (p.forbiddenValue === 0 && isZeroValuedNumericCall(init));

  if (isForbidden) {
    return {
      result: "fail",
      detail: (p.failDetail as string) ?? `${p.propName} is ${p.forbiddenValue}`,
    };
  }

  if (isStringOrNumber || isBool) {
    return {
      result: "pass",
      detail: (p.passDetail as string) ?? `${p.propName} is ${text}`,
    };
  }

  // A recognized numeric/percentage wrapper with a non-zero value (e.g. the fixed
  // fixture's `Percentage.fromFraction(500, 10000)`) is a determinable safe value.
  if (p.forbiddenValue === 0 && isKnownNumericWrapperCall(init)) {
    return {
      result: "pass",
      detail: (p.passDetail as string) ?? `${p.propName} is a non-zero ${text}`,
    };
  }

  return {
    result: "cant_tell",
    detail: `${p.propName} is a non-literal expression — cannot determine statically`,
  };
};
