import { SyntaxKind } from "ts-morph";
import type { Node } from "ts-morph";
import type { Checker } from "../types.ts";
import { canonicalMintForSymbol } from "../solanaCanonicalMints.ts";

// Checker: solana-mint-identity-mismatch
//
// Flags a hardcoded Solana mint CONSTANT whose name denotes a canonical token
// symbol (USDC, USDT, JUP, …) but whose address is NOT that symbol's canonical
// mint — i.e. an impersonator address baked into source. Verified OFFLINE
// against the bundled canonical-mint snapshot (no network), so it runs inside
// the core `brainblast .` auditor.
//
// Recognised shapes (the name may be an identifier or an object-literal key):
//   const USDC_MINT = "EPjF…";              // bare string
//   const usdcMint  = new PublicKey("…");   // wrapped in new PublicKey
//   const MINTS = { USDC: "…", JUP: "…" };  // map of symbol -> address
//
// Optional params: passDetail, failDetail, absentDetail (message overrides).

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Split a camelCase / snake_case / SCREAMING name into uppercased word tokens. */
function tokenize(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toUpperCase());
}

/** The canonical symbol denoted by a variable/property name, if any. */
function symbolFromName(name: string): string | undefined {
  for (const tok of tokenize(name)) {
    if (canonicalMintForSymbol(tok)) return tok;
  }
  return undefined;
}

/** Extract a base58 address string from an initializer (bare or new PublicKey("…")). */
function addressFromInitializer(init: Node | undefined): string | undefined {
  if (!init) return undefined;
  const str = init.asKind(SyntaxKind.StringLiteral);
  if (str) {
    const v = str.getLiteralValue();
    return BASE58_ADDRESS.test(v) ? v : undefined;
  }
  // new PublicKey("…")
  const newExpr = init.asKind(SyntaxKind.NewExpression);
  if (newExpr) {
    const arg = newExpr.getArguments()[0]?.asKind(SyntaxKind.StringLiteral);
    if (arg) {
      const v = arg.getLiteralValue();
      return BASE58_ADDRESS.test(v) ? v : undefined;
    }
  }
  return undefined;
}

interface NamedAddress {
  name: string;
  symbol: string;
  address: string;
}

export const solanaMintIdentity: Checker = (c, p) => {
  const sf = c.fn.getSourceFile();
  const found: NamedAddress[] = [];

  const consider = (name: string, init: Node | undefined) => {
    const symbol = symbolFromName(name);
    if (!symbol) return;
    const address = addressFromInitializer(init);
    if (!address) return;
    found.push({ name, symbol, address });
  };

  // const <name> = <init>
  for (const v of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    consider(v.getName(), v.getInitializer());
  }
  // object-literal { SYMBOL: <init> }
  for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    consider(pa.getName(), pa.getInitializer());
  }

  const mismatches = found.filter((f) => {
    const canon = canonicalMintForSymbol(f.symbol);
    return canon && canon.mint !== f.address;
  });
  const matches = found.filter((f) => {
    const canon = canonicalMintForSymbol(f.symbol);
    return canon && canon.mint === f.address;
  });

  if (mismatches.length > 0) {
    const m = mismatches[0];
    const canon = canonicalMintForSymbol(m.symbol)!;
    return {
      result: "fail",
      detail:
        (p?.failDetail as string) ??
        `'${m.name}' is labelled ${m.symbol} but set to ${m.address}, which is NOT the canonical ${m.symbol} mint (${canon.mint}). ` +
          `This is a token-impersonation footgun: code that trusts this constant will route value to the wrong token. ` +
          `Replace it with ${canon.mint}.`,
    };
  }

  if (matches.length > 0) {
    const m = matches[0];
    return {
      result: "pass",
      detail:
        (p?.passDetail as string) ??
        `'${m.name}' resolves to the canonical ${m.symbol} mint (${m.address}).`,
    };
  }

  return {
    result: "cant_tell",
    detail:
      (p?.absentDetail as string) ??
      `No hardcoded mint constant named after a known canonical symbol was found; this rule does not apply here.`,
  };
};
