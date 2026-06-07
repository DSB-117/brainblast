import { Project, SyntaxKind } from "ts-morph";
import type { FunctionDeclaration, ArrowFunction } from "ts-morph";
import { walk } from "./walk.ts";
import type { Candidate, Rule } from "./types.ts";

function bodyCallsAnyOf(fn: FunctionDeclaration | ArrowFunction, names: Set<string>): boolean {
  if (names.size === 0) return false;
  return fn.getDescendantsOfKind(SyntaxKind.CallExpression).some((c) => {
    const exp = c.getExpression();
    if (exp.getKind() === SyntaxKind.Identifier) return names.has(exp.getText());
    if (exp.getKind() === SyntaxKind.PropertyAccessExpression) {
      return names.has(exp.asKind(SyntaxKind.PropertyAccessExpression)!.getName());
    }
    return false;
  });
}

// Generic candidate detection driven entirely by rule.detect facts.
// (Shared skeleton; was duplicated per-spike before extraction.)
export function findCandidates(targetDir: string, rule: Rule): Candidate[] {
  const files = walk(targetDir);
  const project = new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: false } });
  const modules = new Set(rule.detect.modules);
  const triggers = new Set(rule.detect.triggerCalls);
  const nameRe = new RegExp(rule.detect.nameRegex, "i");
  const out: Candidate[] = [];

  for (const file of files) {
    const sf = project.addSourceFileAtPath(file);
    const importsModule = sf
      .getImportDeclarations()
      .some((d) => modules.has(d.getModuleSpecifierValue()));

    const consider = (fn: FunctionDeclaration | ArrowFunction, name: string) => {
      if (!(importsModule || (name && nameRe.test(name)) || bodyCallsAnyOf(fn, triggers))) return;
      out.push({
        filePath: file,
        fnName: name || "(anonymous)",
        params: fn.getParameters().map((p) => p.getName()),
        fn,
      });
    };

    for (const fn of sf.getFunctions()) consider(fn, fn.getName() ?? "");
    for (const v of sf.getVariableDeclarations()) {
      const arrow = v.getInitializerIfKind(SyntaxKind.ArrowFunction);
      if (arrow) consider(arrow, v.getName());
    }
  }
  return out;
}
