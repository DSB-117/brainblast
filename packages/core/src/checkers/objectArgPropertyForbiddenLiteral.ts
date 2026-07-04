import { SyntaxKind } from "ts-morph";
import type { Expression, ObjectLiteralExpression, PropertyAssignment } from "ts-morph";
import type { Checker } from "../types.ts";

// Solana amounts are almost always BN-wrapped: `minOutAmount: new BN(0)`,
// `tipLamports: new anchor.BN(0)`, `slippage: BN("0")`. Treat such a zero-wrapped
// literal as the underlying zero so amount/slippage rules catch idiomatic code,
// not just bare `0`. Only meaningful when the forbidden value is 0.
function isBnWrappedZero(init: Expression): boolean {
  const isNewOrCall = init.getKind() === SyntaxKind.NewExpression || init.getKind() === SyntaxKind.CallExpression;
  if (!isNewOrCall) return false;
  const calleeText = (init as any).getExpression?.()?.getText?.() ?? "";
  // `BN`, `bn`, `anchor.BN`, `web3.BN`, `new BN`, etc.
  if (!/(^|\.)bn$/i.test(calleeText)) return false;
  const args = (init as any).getArguments?.() ?? [];
  if (args.length !== 1) return false;
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

  // `new BN(0)` / `BN("0")` count as the forbidden zero (idiomatic Solana amounts).
  const isForbidden = isLiteralForbidden || (p.forbiddenValue === 0 && isBnWrappedZero(init));

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

  return {
    result: "cant_tell",
    detail: `${p.propName} is a non-literal expression — cannot determine statically`,
  };
};
