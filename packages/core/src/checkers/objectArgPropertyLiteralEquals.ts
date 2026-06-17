import { SyntaxKind } from "ts-morph";
import type { Checker } from "../types.ts";

// Returns true if the source file imports the named binding (named, default, or
// namespace) from any module — used as a scope predicate (requireImport).
function fileImports(sf: ReturnType<typeof import("ts-morph").Project.prototype.createSourceFile>, name: string): boolean {
  return sf.getImportDeclarations().some((d) => {
    if (d.getDefaultImport()?.getText() === name) return true;
    if (d.getNamespaceImport()?.getText() === name) return true;
    return d.getNamedImports().some((i) => i.getName() === name);
  });
}

// Checker: object-arg-property-literal-equals
//
// Verifies that a specific property inside an object-literal argument to a
// target call equals the expected literal value.
//
// Required params:
//   call           — target function name (e.g. "createV1")
//   argIndex       — which positional argument to inspect (0-based)
//   propName       — property key to check (e.g. "isMutable")
//   expectedValue  — expected literal (e.g. false, "strict", 0)
//
// Optional params:
//   requireImport      — scope predicate; if set, only run when this named
//                        binding is imported by the source file
//   passDetail         — message template for PASS
//   failAbsentDetail   — message for property absent (defaults to bad value)
//   failWrongDetail    — message for property present but wrong value
//   failDynamicDetail  — message for property not a resolvable literal
//   failArgDetail      — message when the whole arg is not an object literal
//   absentCallDetail   — message when the target call is not found
//   scopeNotMetDetail  — message when requireImport predicate not satisfied
export const objectArgPropertyLiteralEquals: Checker = (c, p) => {
  // --- Scope predicate ---
  if (p.requireImport) {
    const sf = c.fn.getSourceFile();
    if (!fileImports(sf, p.requireImport as string)) {
      return {
        result: "cant_tell",
        detail: (p.scopeNotMetDetail as string) ?? `no ${p.requireImport} import`,
      };
    }
  }

  // --- Find the target call ---
  const calls = c.fn
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((ce) => {
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

  // --- Arg index bounds ---
  if (args.length <= (p.argIndex as number)) {
    return {
      result: "fail",
      detail: (p.failAbsentDetail as string) ??
        `${p.call} arg[${p.argIndex}] missing — ${p.propName} defaults to ${p.expectedValue === false ? "true" : p.expectedValue}`,
    };
  }

  const arg = args[p.argIndex as number];

  // --- Arg must be an object literal ---
  const objLit = arg.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!objLit) {
    return {
      result: "cant_tell",
      detail: (p.failArgDetail as string) ??
        `${p.call} arg[${p.argIndex}] is not an inline object literal — cannot statically inspect ${p.propName}`,
    };
  }

  // --- Find the property ---
  const propAssignment = objLit
    .getProperties()
    .map((prop) => prop.asKind(SyntaxKind.PropertyAssignment))
    .find((pa) => pa?.getName() === (p.propName as string));

  if (!propAssignment) {
    // Property absent — callers must treat the default as the bad value.
    return {
      result: "fail",
      detail: (p.failAbsentDetail as string) ??
        `${p.propName} is absent; the SDK defaults to ${p.expectedValue === false ? "mutable (true)" : String(p.expectedValue)}`,
    };
  }

  const init = propAssignment.getInitializer();
  if (!init) {
    return {
      result: "cant_tell",
      detail: (p.failDynamicDetail as string) ?? `${p.propName} has no initializer`,
    };
  }

  // --- Compare to expected literal ---
  const kind = init.getKind();

  if (p.expectedValue === false) {
    if (kind === SyntaxKind.FalseKeyword) {
      return { result: "pass", detail: (p.passDetail as string) ?? `${p.propName} is false` };
    }
    if (kind === SyntaxKind.TrueKeyword) {
      return {
        result: "fail",
        detail: (p.failWrongDetail as string) ??
          `${p.propName} is true — metadata will remain mutable after mint`,
      };
    }
    // Non-literal (identifier, expression, etc.)
    return {
      result: "cant_tell",
      detail: (p.failDynamicDetail as string) ??
        `${p.propName} is a non-literal expression — cannot determine immutability statically`,
    };
  }

  if (p.expectedValue === true) {
    if (kind === SyntaxKind.TrueKeyword) return { result: "pass", detail: (p.passDetail as string) ?? `${p.propName} is true` };
    if (kind === SyntaxKind.FalseKeyword) {
      return { result: "fail", detail: (p.failWrongDetail as string) ?? `${p.propName} is false` };
    }
    return { result: "cant_tell", detail: (p.failDynamicDetail as string) ?? `${p.propName} is a non-literal expression` };
  }

  // String / number literals
  const text = init.getText();
  const expected = JSON.stringify(p.expectedValue);
  if (text === expected || text === String(p.expectedValue)) {
    return { result: "pass", detail: (p.passDetail as string) ?? `${p.propName} is ${p.expectedValue}` };
  }
  if (kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NumericLiteral) {
    return {
      result: "fail",
      detail: (p.failWrongDetail as string) ?? `${p.propName} is ${text} (expected ${p.expectedValue})`,
    };
  }
  return {
    result: "cant_tell",
    detail: (p.failDynamicDetail as string) ?? `${p.propName} is a non-literal expression`,
  };
};
