import { SyntaxKind } from "ts-morph";
import type { CallExpression, FunctionDeclaration, ArrowFunction } from "ts-morph";
import type { Checker } from "../types.ts";

// Vetted checker template: env-taint-to-sink.
//
// A shallow (1-2 hop), intra-file taint tracker: does a secret-shaped
// `process.env.X` value flow — directly, via a local variable, or through one
// call to a sibling function in the same file — into a "sink" call (logging,
// HTTP response, etc.)?
//
// params: { sinkCalls: string[], secretKeyPattern: string }
//
// PASS      -> no secret-shaped env value reaches a sink within this function
//              (or one hop into a same-file helper).
// FAIL      -> a secret-shaped process.env.X (directly, or via a local
//              variable) is passed to a sink call.

function calleeName(call: CallExpression): string {
  const exp = call.getExpression();
  if (exp.getKind() === SyntaxKind.Identifier) return exp.getText();
  if (exp.getKind() === SyntaxKind.PropertyAccessExpression) {
    return exp.asKind(SyntaxKind.PropertyAccessExpression)!.getName();
  }
  return "";
}

// Returns the env var name (e.g. "STRIPE_SECRET_KEY") if `text` contains a
// `process.env.<NAME>` access, else undefined.
function envVarIn(text: string): string | undefined {
  const m = text.match(/process\.env\.([A-Za-z0-9_]+)/);
  return m?.[1];
}

function wordIn(text: string, name: string): boolean {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

// Does `fn` directly pass `taintedNames` (variable names) or a secret-shaped
// `process.env.X` into one of `sinkCalls`? Returns a detail string if so.
function findDirectLeak(
  fn: FunctionDeclaration | ArrowFunction,
  sinkCalls: Set<string>,
  secretKeyRe: RegExp,
  taintedNames: Set<string>,
): string | undefined {
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeName(call);
    if (!sinkCalls.has(name)) continue;
    for (const arg of call.getArguments()) {
      const text = arg.getText();
      const envVar = envVarIn(text);
      if (envVar && secretKeyRe.test(envVar)) {
        return `process.env.${envVar} is passed directly to ${name}(...) — secret values must not be logged or returned to clients.`;
      }
      for (const tv of taintedNames) {
        if (wordIn(text, tv)) {
          return `'${tv}' (holding a secret-shaped process.env value) is passed to ${name}(...) — secret values must not be logged or returned to clients.`;
        }
      }
    }
  }
  return undefined;
}

export const envTaintToSink: Checker = (c, p) => {
  const sinkCalls = new Set<string>(p.sinkCalls ?? []);
  const secretKeyRe = new RegExp(p.secretKeyPattern, "i");
  const fn = c.fn;

  // Step 1: local taint sources — `const x = process.env.SECRET_X` (or
  // destructured `const { SECRET_X } = process.env`).
  const taintedNames = new Set<string>();
  for (const decl of fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init) continue;
    const envVar = envVarIn(init.getText());
    if (envVar && secretKeyRe.test(envVar)) {
      taintedNames.add(decl.getName());
    }
  }

  // Step 2: direct leak — process.env.X or a tainted local passed to a sink.
  const direct = findDirectLeak(fn, sinkCalls, secretKeyRe, taintedNames);
  if (direct) return { result: "fail", detail: direct };

  // Step 3 (1-hop): tainted value passed as an argument to a same-file
  // function whose corresponding parameter is itself leaked to a sink.
  const sourceFile = fn.getSourceFile();
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeExp = call.getExpression();
    if (calleeExp.getKind() !== SyntaxKind.Identifier) continue;
    const calleeFnName = calleeExp.getText();
    if (calleeFnName === (c.fnName ?? "")) continue; // skip self-recursion

    const args = call.getArguments();
    const taintedArgIndices: number[] = [];
    args.forEach((arg, i) => {
      const text = arg.getText();
      const envVar = envVarIn(text);
      if (envVar && secretKeyRe.test(envVar)) {
        taintedArgIndices.push(i);
        return;
      }
      for (const tv of taintedNames) {
        if (wordIn(text, tv)) {
          taintedArgIndices.push(i);
          return;
        }
      }
    });
    if (taintedArgIndices.length === 0) continue;

    const calleeFn = sourceFile.getFunction(calleeFnName);
    if (!calleeFn) continue;
    const params = calleeFn.getParameters().map((pr) => pr.getName());
    const calleeTainted = new Set<string>(taintedArgIndices.map((i) => params[i]).filter((x): x is string => !!x));
    if (calleeTainted.size === 0) continue;

    const hop = findDirectLeak(calleeFn, sinkCalls, secretKeyRe, calleeTainted);
    if (hop) {
      return {
        result: "fail",
        detail: `A secret-shaped process.env value flows into '${calleeFnName}(...)' (called from '${c.fnName}'), where ${hop}`,
      };
    }
  }

  return { result: "pass", detail: "No secret-shaped process.env value flows to a logging/response sink." };
};
