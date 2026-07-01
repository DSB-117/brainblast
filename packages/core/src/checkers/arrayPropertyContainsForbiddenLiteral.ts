import { SyntaxKind } from "ts-morph";

// array-property-contains-forbidden-literal — a NEW static shape proposed by the
// fleet (Move 2). Flags a call whose options-object property is an ARRAY that
// CONTAINS a forbidden literal, e.g. `jwt.verify(t, s, { algorithms: ["none"] })`
// — the classic algorithm-confusion auth bypass. The existing
// object-arg-property-forbidden-literal only handles SCALAR values, so array
// footguns had no checker. Pure: imports only ts-morph, analyzes the AST.
//
// params: call, argIndex, propName, forbiddenValue, {pass,fail,absentCall,absentArg}Detail
export const checker = (c: any, p: any) => {
  const calls = c.fn.getDescendantsOfKind(SyntaxKind.CallExpression).filter((ce: any) => {
    const expr = ce.getExpression();
    if (expr.getKind() === SyntaxKind.Identifier) return expr.getText() === p.call;
    if (expr.getKind() === SyntaxKind.PropertyAccessExpression) return expr.getName() === p.call;
    return false;
  });
  if (calls.length === 0) return { result: "cant_tell", detail: p.absentCallDetail ?? `no ${p.call} call found` };

  const arg = calls[0].getArguments()[p.argIndex];
  const objLit = arg?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!objLit) return { result: "cant_tell", detail: p.absentArgDetail ?? `${p.call} arg[${p.argIndex}] is not an inline object literal` };

  const prop = objLit
    .getProperties()
    .map((pr: any) => pr.asKind(SyntaxKind.PropertyAssignment))
    .find((pa: any) => pa?.getName() === p.propName);
  if (!prop) return { result: "cant_tell", detail: p.absentArgDetail ?? `${p.propName} is absent from the ${p.call} options` };

  const arr = prop.getInitializer()?.asKind(SyntaxKind.ArrayLiteralExpression);
  if (!arr) return { result: "cant_tell", detail: `${p.propName} is not an inline array literal — cannot inspect statically` };

  const els = arr.getElements();
  const isLit = (el: any) => el.getKind() === SyntaxKind.StringLiteral || el.getKind() === SyntaxKind.NumericLiteral;
  const hit = els.some((el: any) => isLit(el) && (el.getLiteralValue?.() === p.forbiddenValue || el.getText().replace(/['"]/g, "") === String(p.forbiddenValue)));
  if (hit) return { result: "fail", detail: p.failDetail ?? `${p.propName} array contains the forbidden value ${JSON.stringify(p.forbiddenValue)}` };

  return els.every(isLit)
    ? { result: "pass", detail: p.passDetail ?? `${p.propName} array does not contain ${JSON.stringify(p.forbiddenValue)}` }
    : { result: "cant_tell", detail: `${p.propName} array has non-literal elements — cannot determine statically` };
};
