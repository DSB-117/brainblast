import { SyntaxKind } from "ts-morph";

// positional-arg-forbidden-literal — a NEW static shape proposed by the fleet
// (Move 2). Flags a call OR constructor whose POSITIONAL argument at a given index
// is a forbidden string / number / boolean LITERAL. The workhorse
// object-arg-property-forbidden-literal only inspects OBJECT PROPERTIES, but many
// real footguns pass the dangerous value POSITIONALLY:
//   new Connection(url, "processed")     — weakest commitment as the 2nd arg
//   connection.getBalance(pubkey, "processed")
//   crypto.createHash("md5")             — broken hash as the 1st arg
//   bcrypt.hashSync(pw, 4)               — too-low cost factor
// The scouts repeatedly hit these and had to skip them. Pure: imports only ts-morph.
//
// params: call, argIndex, forbiddenValue, {pass,fail,absentCall,absentArg}Detail
export const checker = (c: any, p: any) => {
  const named = (ce: any) => {
    const expr = ce.getExpression?.();
    if (!expr) return false;
    if (expr.getKind() === SyntaxKind.Identifier) return expr.getText() === p.call;
    if (expr.getKind() === SyntaxKind.PropertyAccessExpression) return expr.getName?.() === p.call;
    return false;
  };
  // Match plain calls `foo(...)` AND constructor calls `new Foo(...)`.
  const calls = [
    ...c.fn.getDescendantsOfKind(SyntaxKind.CallExpression),
    ...c.fn.getDescendantsOfKind(SyntaxKind.NewExpression),
  ].filter(named);
  if (calls.length === 0) return { result: "cant_tell", detail: p.absentCallDetail ?? `no ${p.call} call found` };

  const arg = calls[0].getArguments?.()[p.argIndex];
  if (!arg) return { result: "cant_tell", detail: p.absentArgDetail ?? `${p.call} has no positional arg[${p.argIndex}]` };

  const k = arg.getKind();
  const isBool = k === SyntaxKind.TrueKeyword || k === SyntaxKind.FalseKeyword;
  const isStr = k === SyntaxKind.StringLiteral;
  const isNum = k === SyntaxKind.NumericLiteral;
  if (!isBool && !isStr && !isNum) {
    // A variable / expression / default — cannot determine statically. Abstain.
    return { result: "cant_tell", detail: p.absentArgDetail ?? `${p.call} arg[${p.argIndex}] is not a literal — cannot inspect statically` };
  }

  const text = arg.getText().replace(/^['"`]|['"`]$/g, "");
  const forbidden = String(p.forbiddenValue);
  const matches = isBool
    ? text === forbidden
    : arg.getLiteralValue?.() === p.forbiddenValue || text === forbidden;

  if (matches) {
    return { result: "fail", detail: p.failDetail ?? `${p.call} arg[${p.argIndex}] is the forbidden ${JSON.stringify(p.forbiddenValue)}` };
  }
  return { result: "pass", detail: p.passDetail ?? `${p.call} arg[${p.argIndex}] is ${JSON.stringify(text)}, not the forbidden ${JSON.stringify(p.forbiddenValue)}` };
};
