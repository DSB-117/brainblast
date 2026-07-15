import type { CstChecker } from "../types.ts";

// Checker: cst-member-access-forbidden (Solidity)
//
// Flags a forbidden `object.property` member access inside a scope — the shape of
// several classic Solidity footguns:
//   tx.origin        — authorization via tx.origin (phishing: a malicious contract
//                      relays the victim's call, so tx.origin == owner passes)
//   block.timestamp  — used as randomness / deadline a miner can nudge
//   block.difficulty — used as randomness
//
// "Forbidden pattern present" semantics: the access present → fail; absent → pass
// (the fixed fixture, e.g. tx.origin replaced by msg.sender, has none → GREEN).
//
// Required params: object (e.g. "tx"), property (e.g. "origin").
// Optional: passDetail / failDetail.

function collect(node: any, kind: string, out: any[] = []): any[] {
  if (!node) return out;
  if (node.type === kind) out.push(node);
  for (let i = 0; i < node.childCount; i++) collect(node.child(i), kind, out);
  return out;
}

function named(node: any): any[] {
  const out: any[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c?.isNamed) out.push(c);
  }
  return out;
}

// The rightmost identifier leaf of a subtree. Needed because tree-sitter-solidity
// mis-associates member access across a boolean operator: it parses
//   !isContract(msg.sender) && tx.origin
// as `(!isContract(msg.sender) && tx).origin` — a member_expression whose OBJECT is
// the whole `... && tx` binary_expression, not the bare identifier `tx`. The real
// object of the `.origin` access is that binary's trailing operand (`tx`), so we
// match against the object subtree's rightmost identifier as a fallback. For a
// plain-identifier object this is just the identifier itself (no behavior change).
function rightmostIdentifier(node: any): string {
  if (!node) return "";
  if (node.type === "identifier") return (node.text ?? "").trim();
  const kids = named(node);
  for (let i = kids.length - 1; i >= 0; i--) {
    const r = rightmostIdentifier(kids[i]);
    if (r) return r;
  }
  return "";
}

export const cstMemberAccessForbidden: CstChecker = (c, p) => {
  const object = String(p.object ?? "");
  const property = String(p.property ?? "");

  for (const m of collect(c.bodyNode, "member_expression")) {
    const kids = named(m); // [object identifier, property identifier]
    if (kids.length < 2) continue;
    const objNode = kids[0];
    const objText = (objNode?.text ?? "").trim();
    const propText = (kids[kids.length - 1]?.text ?? "").trim();
    // Exact object match, OR (for the `&&`/`||` grammar mis-parse above) the object
    // subtree's rightmost identifier is the target — `... && tx`.`origin` still trips
    // the tx.origin trap.
    const objMatches = objText === object || rightmostIdentifier(objNode) === object;
    if (objMatches && propText === property) {
      return { result: "fail", detail: (p.failDetail as string) ?? `${object}.${property} is used here` };
    }
  }

  return { result: "pass", detail: (p.passDetail as string) ?? `${object}.${property} is not used in this scope` };
};
