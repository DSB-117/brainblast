import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Rule, RustCandidate, RustAccountField } from "./types.ts";

/** Walk .rs files only — parallel to walk.ts but for Rust source. */
function walkRust(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "target") continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walkRust(p, out);
    else if (p.endsWith(".rs")) out.push(p);
  }
  return out;
}

// Lazy-load tree-sitter synchronously via createRequire so the native
// binding works in both CJS and ESM contexts without a top-level await.
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);

let _parser: any = null;

function getParser(): any {
  if (_parser) return _parser;
  const Parser = _require("tree-sitter") as any;
  const Rust = _require("tree-sitter-rust") as any;
  _parser = new Parser();
  _parser.setLanguage(Rust);
  return _parser;
}

// ── AST helpers ────────────────────────────────────────────────────────────

/** Walk all children of a node (non-recursive, single level). */
function children(node: any): any[] {
  const out: any[] = [];
  for (let i = 0; i < node.childCount; i++) out.push(node.child(i));
  return out;
}

/** Named children only (equivalent to node.namedChildren in older APIs). */
function named(node: any): any[] {
  return children(node).filter((c: any) => c.isNamed);
}

/**
 * Extract the Anchor Accounts struct name from the first parameter of an
 * instruction handler: `ctx: Context<Initialize>` → "Initialize".
 * Returns null when the pattern doesn't match.
 */
function accountsStructName(fnNode: any): string | null {
  const params = fnNode.childForFieldName("parameters");
  if (!params) return null;

  for (const param of named(params)) {
    const typeNode = param.childForFieldName?.("type") ?? null;
    if (!typeNode) continue;
    const text = typeNode.text ?? "";
    // Match Context<SomeName> or Context<SomeName<...>>
    const m = text.match(/^Context\s*<\s*([A-Za-z_][A-Za-z0-9_]*)/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Given a sibling list, collect (attribute_text[], item_node) pairs.
 * Attributes precede their item as sibling nodes in tree-sitter-rust.
 */
function itemsWithAttrs(containerNode: any): Array<{ attrs: string[]; node: any }> {
  const kids = named(containerNode);
  const result: Array<{ attrs: string[]; node: any }> = [];
  let pending: string[] = [];

  for (const kid of kids) {
    if (kid.type === "attribute_item") {
      pending.push(kid.text);
    } else {
      result.push({ attrs: pending, node: kid });
      pending = [];
    }
  }
  return result;
}

/**
 * Parse the field_declaration_list of an Accounts struct into
 * RustAccountField[]
 */
function parseAccountsStruct(structNode: any): RustAccountField[] {
  const body = structNode.childForFieldName("body");
  if (!body) return [];

  const pairs = itemsWithAttrs(body);
  const fields: RustAccountField[] = [];

  for (const { attrs, node } of pairs) {
    if (node.type !== "field_declaration") continue;

    const nameNode = node.childForFieldName("name");
    const typeNode = node.childForFieldName("type");
    if (!nameNode || !typeNode) continue;

    const attrText = attrs.join("\n");
    fields.push({
      name: nameNode.text,
      typeName: typeNode.text,
      attrText,
      hasInitIfNeeded: attrText.includes("init_if_needed"),
    });
  }
  return fields;
}

// ── Finder ─────────────────────────────────────────────────────────────────

/**
 * Finds Anchor instruction-handler candidates in Rust source files.
 *
 * Detection strategy:
 * 1. Walk .rs files in targetDir.
 * 2. For each file, parse with tree-sitter-rust.
 * 3. Find `mod_item` nodes preceded by `#[program]`.
 * 4. Within the program module, find `function_item` nodes.
 * 5. For each function, resolve the Accounts struct name from Context<X>.
 * 6. Filter: include only when the function name matches rule.detect.nameRegex
 *    OR the module has any account with init_if_needed (triggerCalls equivalent
 *    for Anchor: presence of attribute).
 * 7. Build RustCandidate with the body node + parsed account fields.
 */
export function findRustCandidates(targetDir: string, rule: Rule): RustCandidate[] {
  const parser = getParser();
  const nameRe = new RegExp(rule.detect.nameRegex, "i");
  const triggerAttrs = new Set<string>(
    (rule.detect.triggerCalls ?? []).map((s) => s.toLowerCase()),
  );
  const out: RustCandidate[] = [];

  for (const file of walkRust(targetDir)) {
    if (!file.endsWith(".rs")) continue;
    const src = readFileSync(file, "utf8");
    const tree = parser.parse(src);

    // Build a map: struct name → RustAccountField[]
    const structMap = new Map<string, RustAccountField[]>();
    const topPairs = itemsWithAttrs(tree.rootNode);

    for (const { attrs, node } of topPairs) {
      if (node.type !== "struct_item") continue;
      const hasAccounts = attrs.some((a) => a.includes("Accounts"));
      if (!hasAccounts) continue;
      const nameNode = node.childForFieldName("name");
      if (!nameNode) continue;
      structMap.set(nameNode.text, parseAccountsStruct(node));
    }

    // Walk program modules
    for (const { attrs, node } of topPairs) {
      if (node.type !== "mod_item") continue;
      const isProgram = attrs.some((a) => a.includes("program"));
      if (!isProgram) continue;

      const body = node.childForFieldName("body");
      if (!body) continue;

      for (const { node: item } of itemsWithAttrs(body)) {
        if (item.type !== "function_item") continue;

        const fnNameNode = item.childForFieldName("name");
        if (!fnNameNode) continue;
        const fnName = fnNameNode.text;

        const structName = accountsStructName(item) ?? "";
        const fields = structMap.get(structName) ?? [];

        // Include this candidate if:
        // (a) function name matches nameRegex, OR
        // (b) any account field matches a triggerAttr (e.g. "init_if_needed")
        const nameMatch = nameRe.test(fnName);
        const attrMatch =
          triggerAttrs.size > 0 &&
          fields.some((f) => [...triggerAttrs].some((t) => f.attrText.includes(t)));

        if (!nameMatch && !attrMatch) continue;

        const bodyNode = item.childForFieldName("body");
        if (!bodyNode) continue;

        out.push({
          filePath: file,
          fnName,
          accountStructName: structName,
          accountFields: fields,
          fnBodyText: bodyNode.text,
          fnBodyNode: bodyNode,
        });
      }
    }
  }

  return out;
}
