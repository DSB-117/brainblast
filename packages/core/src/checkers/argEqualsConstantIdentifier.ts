import { SyntaxKind } from "ts-morph";
import type { CallExpression } from "ts-morph";
import type { Checker } from "../types.ts";

// Vetted checker template (Phase 2, Token-2022 program-ID pinning).
//
// Semantics — a call must pass a SPECIFIC constant identifier at a specific
// argument position. Used for traps like Token-2022 vs legacy Token program-ID
// mismatch: when the dev's *intent* is Token-2022 (signaled by importing
// TOKEN_2022_PROGRAM_ID), any call to `createMint` MUST pass that constant
// as its programId argument, never `TOKEN_PROGRAM_ID` and never `undefined`
// (which defaults to legacy).
//
// params: {
//   call: string,                        // function name to inspect
//   argIndex: number,                    // 0-based positional arg
//   expectedIdentifier: string,          // required Identifier text
//   forbiddenIdentifiers?: string[],     // named-bad alternatives -> hard FAIL
//   requireImport?: string,              // scope predicate: rule only applies
//                                        //   when the source file imports this
//                                        //   identifier (e.g. TOKEN_2022_PROGRAM_ID)
//   passDetail, failForbiddenDetail,
//   failMissingDetail, failOtherDetail,
//   absentCallDetail, scopeNotMetDetail
// }
//
// Outcomes:
//   pass       - arg is an Identifier === expectedIdentifier.
//   fail       - arg is a forbidden constant, or absent (defaults to wrong),
//                or any other Identifier (some third constant), reusing the
//                relevant detail string.
//   cant_tell  - the rule's scope is not met (requireImport not imported),
//                the candidate doesn't call `call` at all, or the arg is a
//                non-Identifier expression we can't classify statically.

function callName(call: CallExpression): string {
  const exp = call.getExpression();
  if (exp.getKind() === SyntaxKind.Identifier) return exp.getText();
  if (exp.getKind() === SyntaxKind.PropertyAccessExpression) {
    return exp.asKind(SyntaxKind.PropertyAccessExpression)!.getName();
  }
  return "";
}

function fileImports(sf: ReturnType<CallExpression["getSourceFile"]>, name: string): boolean {
  for (const decl of sf.getImportDeclarations()) {
    if (decl.getDefaultImport()?.getText() === name) return true;
    for (const n of decl.getNamedImports()) {
      if (n.getName() === name || n.getAliasNode()?.getText() === name) return true;
    }
    if (decl.getNamespaceImport()?.getText() === name) return true;
  }
  return false;
}

export const argEqualsConstantIdentifier: Checker = (c, p) => {
  // Scope gate: if a requireImport is specified and the source file doesn't
  // import it, the rule's premise doesn't hold. Soft-skip (cant_tell) rather
  // than false-positiving every legacy-token codebase.
  if (p.requireImport) {
    const sf = c.fn.getSourceFile();
    if (!fileImports(sf, p.requireImport)) {
      return { result: "cant_tell", detail: p.scopeNotMetDetail };
    }
  }

  const calls = c.fn
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((x) => callName(x) === p.call);

  if (calls.length === 0) {
    // The candidate matched on imports/regex but doesn't actually call our
    // target. Non-blocking — the rule doesn't apply to this handler.
    return { result: "cant_tell", detail: p.absentCallDetail };
  }

  // Inspect the first matching call. (Future: every match must satisfy; for
  // now one is sufficient because the rule is "you used the SDK wrong here.")
  const arg = calls[0].getArguments()[p.argIndex];
  const forbidden: string[] = Array.isArray(p.forbiddenIdentifiers) ? p.forbiddenIdentifiers : [];

  if (!arg) {
    return {
      result: "fail",
      detail: String(p.failMissingDetail).replace("{expected}", p.expectedIdentifier),
    };
  }

  if (arg.getKind() === SyntaxKind.Identifier) {
    const text = arg.getText();
    if (text === p.expectedIdentifier) {
      return { result: "pass", detail: String(p.passDetail).replace("{expected}", p.expectedIdentifier) };
    }
    if (forbidden.includes(text)) {
      return {
        result: "fail",
        detail: String(p.failForbiddenDetail)
          .replace("{got}", text)
          .replace("{expected}", p.expectedIdentifier),
      };
    }
    return {
      result: "fail",
      detail: String(p.failOtherDetail)
        .replace("{got}", text)
        .replace("{expected}", p.expectedIdentifier),
    };
  }

  // `undefined` literal — the dev explicitly defaulted. Same hazard as missing.
  if (arg.getKind() === SyntaxKind.Identifier && arg.getText() === "undefined") {
    return {
      result: "fail",
      detail: String(p.failMissingDetail).replace("{expected}", p.expectedIdentifier),
    };
  }

  return {
    result: "cant_tell",
    detail: `Argument ${p.argIndex} of ${p.call} is a ${arg.getKindName()}; could not statically confirm it equals ${p.expectedIdentifier}.`,
  };
};
