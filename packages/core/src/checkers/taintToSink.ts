import { SyntaxKind } from "ts-morph";
import type { CallExpression, FunctionDeclaration, ArrowFunction, SourceFile, Node } from "ts-morph";
import type { Checker } from "../types.ts";

// Vetted checker template: taint-to-sink.
//
// A project-wide (cross-file) taint tracker: does a value matching one of
// `sources` (a regex tested against expression text — e.g. a secret-shaped
// `process.env.X`, or `req.body`/`req.query`/`req.params`) reach one of
// `sinkCalls` (logging, HTTP response, shell exec, etc.)?
//
// Three flow shapes are checked, each up to `maxHops` (default 2) calls deep:
//
//  1. Direct: a source expression (or a local variable initialized from one)
//     is passed straight to a sink call within this function.
//  2. Forward: this function passes a tainted value to another function
//     (same file, or imported from another file in the project) whose
//     corresponding parameter is itself leaked to a sink.
//  3. Backward: this function (the candidate, which contains a sink) takes a
//     parameter that's passed straight to that sink — and somewhere else in
//     the project, this function is called with a source expression (or a
//     local matching one) as that argument.
//
// params: { sources: { name: string; pattern: string }[], sinkCalls: string[], maxHops?: number }

type Fn = FunctionDeclaration | ArrowFunction;

function calleeName(call: CallExpression): string {
  const exp = call.getExpression();
  if (exp.getKind() === SyntaxKind.Identifier) return exp.getText();
  if (exp.getKind() === SyntaxKind.PropertyAccessExpression) {
    return exp.asKind(SyntaxKind.PropertyAccessExpression)!.getName();
  }
  return "";
}

function calleeIdentifierName(call: CallExpression): string | undefined {
  const exp = call.getExpression();
  return exp.getKind() === SyntaxKind.Identifier ? exp.getText() : undefined;
}

function wordIn(text: string, name: string): boolean {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

function matchesSource(text: string, sourceRes: RegExp[]): boolean {
  return sourceRes.some((re) => re.test(text));
}

// Local variables in `fn` initialized directly from a source expression.
function localTaintedNames(fn: Fn, sourceRes: RegExp[]): Set<string> {
  const names = new Set<string>();
  for (const decl of fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (init && matchesSource(init.getText(), sourceRes)) names.add(decl.getName());
  }
  return names;
}

// Does `fn` pass a source expression or a `taintedNames` value straight to a sink?
function findDirectLeak(
  fn: Fn,
  sinkCalls: Set<string>,
  sourceRes: RegExp[],
  taintedNames: Set<string>,
): string | undefined {
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeName(call);
    if (!sinkCalls.has(name)) continue;
    for (const arg of call.getArguments()) {
      const text = arg.getText();
      if (matchesSource(text, sourceRes)) {
        return `'${text}' is passed directly to ${name}(...) — tainted values must not reach this sink.`;
      }
      for (const tv of taintedNames) {
        if (wordIn(text, tv)) {
          return `'${tv}' (a tainted value) is passed to ${name}(...) — tainted values must not reach this sink.`;
        }
      }
    }
  }
  return undefined;
}

// Resolve a called function by name: declared in `sourceFile`, or imported
// from another file in the project (named import only).
function resolveFunction(sourceFile: SourceFile, name: string): { fn: Fn; sf: SourceFile } | undefined {
  const local = sourceFile.getFunction(name);
  if (local) return { fn: local, sf: sourceFile };

  for (const imp of sourceFile.getImportDeclarations()) {
    const named = imp
      .getNamedImports()
      .find((ni) => (ni.getAliasNode()?.getText() ?? ni.getName()) === name);
    if (!named) continue;
    const targetSf = imp.getModuleSpecifierSourceFile();
    if (!targetSf) continue;
    const targetFn = targetSf.getFunction(named.getName());
    if (targetFn) return { fn: targetFn, sf: targetSf };
  }
  return undefined;
}

// Forward: does `fn` call another function (same-file or cross-file) passing
// a tainted value into a parameter that's itself leaked to a sink?
function findForwardLeak(
  fn: Fn,
  rootName: string,
  sinkCalls: Set<string>,
  sourceRes: RegExp[],
  taintedNames: Set<string>,
  hopsLeft: number,
  visited: Set<string>,
): string | undefined {
  if (hopsLeft <= 0) return undefined;

  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeIdentifierName(call);
    if (!name || name === rootName) continue;

    const args = call.getArguments();
    const taintedArgIndices: number[] = [];
    args.forEach((arg, i) => {
      const text = arg.getText();
      if (matchesSource(text, sourceRes)) {
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

    const resolved = resolveFunction(fn.getSourceFile(), name);
    if (!resolved) continue;
    const key = `${resolved.sf.getFilePath()}::${name}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const params = resolved.fn.getParameters().map((pr) => pr.getName());
    const calleeTainted = new Set<string>(
      taintedArgIndices.map((i) => params[i]).filter((x): x is string => !!x),
    );
    if (calleeTainted.size === 0) continue;

    const direct = findDirectLeak(resolved.fn, sinkCalls, sourceRes, calleeTainted);
    if (direct) {
      const where = resolved.sf === fn.getSourceFile() ? "" : ` (in ${resolved.sf.getFilePath()})`;
      return `A tainted value flows into '${name}(...)'${where}, where ${direct}`;
    }

    const deeper = findForwardLeak(resolved.fn, rootName, sinkCalls, sourceRes, calleeTainted, hopsLeft - 1, visited);
    if (deeper) return `via '${name}(...)': ${deeper}`;
  }
  return undefined;
}

// Names of `fn`'s parameters that are passed straight to a sink within `fn`'s body.
function paramsUsedInSink(fn: Fn, sinkCalls: Set<string>): Set<string> {
  const params = new Set(fn.getParameters().map((p) => p.getName()));
  const sinked = new Set<string>();
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!sinkCalls.has(calleeName(call))) continue;
    for (const arg of call.getArguments()) {
      const text = arg.getText();
      for (const p of params) {
        if (wordIn(text, p)) sinked.add(p);
      }
    }
  }
  return sinked;
}

function enclosingFunction(node: Node): Fn | undefined {
  return node.getFirstAncestor(
    (a) => a.getKind() === SyntaxKind.FunctionDeclaration || a.getKind() === SyntaxKind.ArrowFunction,
  ) as Fn | undefined;
}

// Backward: is `fnName` (the candidate, which sinks `sinkedParams` directly)
// ever called elsewhere in the project with a source expression — or a local
// variable initialized from one — as the argument for a sinked parameter?
function findBackwardLeak(
  candidateFn: Fn,
  fnName: string,
  candidateFile: string,
  params: string[],
  sinkedParams: Set<string>,
  sourceRes: RegExp[],
): string | undefined {
  const project = candidateFn.getProject();
  for (const sf of project.getSourceFiles()) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (calleeIdentifierName(call) !== fnName) continue;
      if (call.getFirstAncestor((a) => a === candidateFn)) continue; // skip self-recursion

      const args = call.getArguments();
      for (const pname of sinkedParams) {
        const idx = params.indexOf(pname);
        const arg = args[idx];
        if (!arg) continue;
        const text = arg.getText();

        if (matchesSource(text, sourceRes)) {
          return `'${fnName}' is called from ${sf.getFilePath()}:${call.getStartLineNumber()} with '${text}' as '${pname}', which this function passes to a sink.`;
        }

        if (arg.getKind() === SyntaxKind.Identifier) {
          const callerFn = enclosingFunction(arg);
          if (callerFn) {
            const callerTainted = localTaintedNames(callerFn, sourceRes);
            if (callerTainted.has(text)) {
              return `'${fnName}' is called from ${sf.getFilePath()}:${call.getStartLineNumber()} with '${text}' (a tainted value) as '${pname}', which this function passes to a sink.`;
            }
          }
        }
      }
    }
  }
  return undefined;
}

export const taintToSink: Checker = (c, p) => {
  const sourceRes = (p.sources as { name: string; pattern: string }[]).map((s) => new RegExp(s.pattern));
  const sinkCalls = new Set<string>(p.sinkCalls ?? []);
  const maxHops = p.maxHops ?? 2;
  const fn = c.fn;

  const taintedNames = localTaintedNames(fn, sourceRes);

  const direct = findDirectLeak(fn, sinkCalls, sourceRes, taintedNames);
  if (direct) return { result: "fail", detail: direct };

  const forward = findForwardLeak(fn, c.fnName, sinkCalls, sourceRes, taintedNames, maxHops, new Set([
    `${fn.getSourceFile().getFilePath()}::${c.fnName}`,
  ]));
  if (forward) return { result: "fail", detail: forward };

  const sinkedParams = paramsUsedInSink(fn, sinkCalls);
  if (sinkedParams.size > 0) {
    const backward = findBackwardLeak(
      fn,
      c.fnName,
      c.filePath,
      fn.getParameters().map((pr) => pr.getName()),
      sinkedParams,
      sourceRes,
    );
    if (backward) return { result: "fail", detail: backward };
  }

  return { result: "pass", detail: "No tracked source value flows to a sink within the analyzed call graph." };
};
