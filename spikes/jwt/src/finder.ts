import { Project, SyntaxKind } from "ts-morph";
import type { FunctionDeclaration, ArrowFunction } from "ts-morph";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// A Privy/JWT access-token verification candidate. Deliberately different shape
// from the Stripe spike: this trap is about token CLAIM verification, not body
// handling. That divergence is what T3 uses to find the real core abstraction.
export interface Candidate {
  filePath: string;
  fnName: string;
  tokenParam: string | null;
  fn: FunctionDeclaration | ArrowFunction;
}

const JWT_MODULES = new Set(["jose", "jsonwebtoken", "@privy-io/node", "@privy-io/server-auth"]);

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

function callsAnyOf(fn: FunctionDeclaration | ArrowFunction, names: Set<string>): boolean {
  return fn.getDescendantsOfKind(SyntaxKind.CallExpression).some((c) => {
    const exp = c.getExpression();
    if (exp.getKind() === SyntaxKind.Identifier) return names.has(exp.getText());
    if (exp.getKind() === SyntaxKind.PropertyAccessExpression) {
      return names.has(exp.asKind(SyntaxKind.PropertyAccessExpression)!.getName());
    }
    return false;
  });
}

export function findTokenVerifiers(targetDir: string): Candidate[] {
  const files = walk(targetDir);
  const project = new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: false } });
  const candidates: Candidate[] = [];

  for (const file of files) {
    const sf = project.addSourceFileAtPath(file);
    const importsJwt = sf
      .getImportDeclarations()
      .some((d) => JWT_MODULES.has(d.getModuleSpecifierValue()));

    const consider = (fn: FunctionDeclaration | ArrowFunction, name: string) => {
      const tokenish =
        importsJwt ||
        /token|auth|verify|privy|jwt/i.test(name) ||
        callsAnyOf(fn, new Set(["decodeJwt", "jwtVerify", "verify", "decode"]));
      if (!tokenish) return;
      candidates.push({
        filePath: file,
        fnName: name || "(anonymous)",
        tokenParam: fn.getParameters()[0]?.getName() ?? null,
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
