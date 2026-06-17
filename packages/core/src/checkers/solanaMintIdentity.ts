import { Node, SyntaxKind } from "ts-morph";
import type { Checker } from "../types.ts";
import { CANONICAL_MINTS } from "../solanaCanonicalMints.ts";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function tokenize(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .split(/[_\s]+/)
    .map((t) => t.toUpperCase())
    .filter(Boolean);
}

function symbolFromName(name: string): string | undefined {
  return tokenize(name).find((t) => t in CANONICAL_MINTS);
}

function addressFromInitializer(init: Node): string | undefined {
  if (Node.isStringLiteral(init)) {
    return init.getLiteralValue();
  }
  if (Node.isNewExpression(init)) {
    const args = init.getArguments();
    if (args.length > 0 && Node.isStringLiteral(args[0])) {
      return (args[0] as any).getLiteralValue?.() ?? args[0].getText().replace(/['"]/g, "");
    }
  }
  return undefined;
}

export const solanaMintIdentity: Checker = (c, _params) => {
  const sf = (c.fn as any).getSourceFile?.();
  if (!sf) return { result: "cant_tell", detail: "Could not access source file" };

  let foundWrong = false;
  let foundRight = false;

  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const sym = symbolFromName(vd.getName());
    if (!sym) continue;
    const init = vd.getInitializer();
    if (!init) continue;
    const addr = addressFromInitializer(init);
    if (!addr || !BASE58_RE.test(addr)) continue;
    if (addr === CANONICAL_MINTS[sym]!.mint) {
      foundRight = true;
    } else {
      foundWrong = true;
    }
  }

  for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const nameNode = pa.getNameNode();
    const name = Node.isIdentifier(nameNode)
      ? nameNode.getText()
      : nameNode.getText().replace(/['"]/g, "");
    const sym = symbolFromName(name);
    if (!sym) continue;
    const init = pa.getInitializer();
    if (!init) continue;
    const addr = addressFromInitializer(init);
    if (!addr || !BASE58_RE.test(addr)) continue;
    if (addr === CANONICAL_MINTS[sym]!.mint) {
      foundRight = true;
    } else {
      foundWrong = true;
    }
  }

  if (foundWrong) return { result: "fail", detail: "Mint constant has wrong address for its symbol" };
  if (foundRight) return { result: "pass", detail: "All symbol-named mint constants have canonical addresses" };
  return { result: "cant_tell", detail: "No symbol-named mint constants found" };
};
