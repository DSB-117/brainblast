import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { CstCandidate, Rule } from "./types.ts";

// Generic tree-sitter finder — the multi-language sibling of finder.ts (ts-morph)
// and rustFinder.ts (Anchor-specific). It walks a language's source files, parses
// with that language's grammar, and hands each function-like scope to a CST
// checker as a CstCandidate. Adding a language is one entry in LANGS + a checker
// that knows that grammar's node kinds — the same "one abstraction, many configs"
// shape the differential oracle's LangRunners use.

const SKIP_DIRS = new Set([
  "node_modules", ".git", "target", "vendor", "dist", ".next",
  ".Trash", ".Trashes", ".Spotlight-V100", ".fseventsd", ".DocumentRevisions-V100", ".TemporaryItems",
]);

interface LangSpec {
  ext: string;
  grammarModule: string;
  // tree-sitter node kinds that introduce a function-like scope for this grammar.
  fnKinds: string[];
}

// Go: `func f()` / `func (r R) m()`. Solidity: `function f()`, plus modifiers and
// the constructor (all can carry the footgun a checker looks for).
const LANGS: Record<"go" | "solidity", LangSpec> = {
  go: { ext: ".go", grammarModule: "tree-sitter-go", fnKinds: ["function_declaration", "method_declaration"] },
  solidity: {
    ext: ".sol",
    grammarModule: "tree-sitter-solidity",
    fnKinds: ["function_definition", "modifier_definition", "constructor_definition"],
  },
};

const _require = createRequire(import.meta.url);
const _parsers = new Map<string, any>();

function getParser(lang: "go" | "solidity"): any {
  const cached = _parsers.get(lang);
  if (cached) return cached;
  const Parser = _require("tree-sitter") as any;
  const Grammar = _require(LANGS[lang].grammarModule) as any;
  const p = new Parser();
  p.setLanguage(Grammar);
  _parsers.set(lang, p);
  return p;
}

function walkExt(dir: string, ext: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkExt(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

// Depth-first collection of every node whose type is in `kinds`.
function collectByKind(node: any, kinds: Set<string>, out: any[] = []): any[] {
  if (!node) return out;
  if (kinds.has(node.type)) out.push(node);
  for (let i = 0; i < node.childCount; i++) collectByKind(node.child(i), kinds, out);
  return out;
}

// Best-effort function name: the "name" field, else the first identifier child.
function fnNameOf(node: any): string {
  const byField = node.childForFieldName?.("name");
  if (byField?.text) return byField.text;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c?.type === "identifier" || c?.type === "field_identifier") return c.text;
  }
  return "(anonymous)";
}

// The body/block node a checker queries. Prefer the "body" field; else the last
// block-ish child; else the whole node (so a bodiless decl still yields a scope).
function bodyOf(node: any): any {
  const byField = node.childForFieldName?.("body");
  if (byField) return byField;
  for (let i = node.childCount - 1; i >= 0; i--) {
    const c = node.child(i);
    if (c && /block|body/.test(c.type)) return c;
  }
  return node;
}

// Same detection contract as the other finders: a scope is a candidate when its
// name matches `nameRegex` OR its body text mentions a trigger call. (Text match
// on the body keeps this grammar-agnostic; the CHECKER does the precise CST work.)
export function findCstCandidates(targetDir: string, rule: Rule): CstCandidate[] {
  const lang = rule.detect.lang as "go" | "solidity";
  const spec = LANGS[lang];
  if (!spec) return [];

  const parser = getParser(lang);
  const nameRe = new RegExp(rule.detect.nameRegex, "i");
  const triggers = (rule.detect.triggerCalls ?? []).filter(Boolean);
  const fnKinds = new Set(spec.fnKinds);
  const out: CstCandidate[] = [];

  for (const file of walkExt(targetDir, spec.ext)) {
    let tree;
    try {
      tree = parser.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const fnNode of collectByKind(tree.rootNode, fnKinds)) {
      const fnName = fnNameOf(fnNode);
      const body = bodyOf(fnNode);
      const bodyText: string = body?.text ?? "";
      const nameMatch = !!fnName && nameRe.test(fnName);
      const triggerMatch = triggers.length > 0 && triggers.some((t) => bodyText.includes(t));
      if (!nameMatch && !triggerMatch) continue;
      out.push({ filePath: file, fnName, lang, bodyNode: body, rootNode: tree.rootNode });
    }
  }
  return out;
}
