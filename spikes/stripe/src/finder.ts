import { Project, SyntaxKind } from "ts-morph";
import type { FunctionDeclaration, ArrowFunction } from "ts-morph";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// A Stripe-webhook handler candidate found by the deterministic finder.
// "Hardcoded internals are fine" (spike): detection is intentionally simple.
export interface Candidate {
  filePath: string;
  fnName: string;
  rawBodyParam: string | null;
  signatureParam: string | null;
  fn: FunctionDeclaration | ArrowFunction;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === ".gen") continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function hasConstructEvent(fn: FunctionDeclaration | ArrowFunction): boolean {
  return fn.getDescendantsOfKind(SyntaxKind.CallExpression).some((c) => {
    const exp = c.getExpression();
    return (
      exp.getKind() === SyntaxKind.PropertyAccessExpression &&
      exp.asKind(SyntaxKind.PropertyAccessExpression)?.getName() === "constructEvent"
    );
  });
}

// Find functions that look like Stripe webhook handlers: the file imports
// `stripe`, OR the body calls `constructEvent`, OR the function name mentions
// "webhook". This is the FINDER (zero-setup acquisition), not the guarantee.
export function findStripeWebhookHandlers(targetDir: string): Candidate[] {
  const files = walk(targetDir);
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false },
  });
  const candidates: Candidate[] = [];

  for (const file of files) {
    const sf = project.addSourceFileAtPath(file);
    const importsStripe = sf
      .getImportDeclarations()
      .some((d) => d.getModuleSpecifierValue() === "stripe");

    const consider = (fn: FunctionDeclaration | ArrowFunction, name: string) => {
      if (!(importsStripe || hasConstructEvent(fn) || /webhook/i.test(name))) return;
      const params = fn.getParameters();
      candidates.push({
        filePath: file,
        fnName: name || "(anonymous)",
        rawBodyParam: params[0]?.getName() ?? null,
        signatureParam: params[1]?.getName() ?? null,
        fn,
      });
    };

    for (const fn of sf.getFunctions()) consider(fn, fn.getName() ?? "");
    for (const v of sf.getVariableDeclarations()) {
      const arrow = v.getInitializerIfKind(SyntaxKind.ArrowFunction);
      if (arrow) consider(arrow, v.getName());
    }
  }
  return candidates;
}
