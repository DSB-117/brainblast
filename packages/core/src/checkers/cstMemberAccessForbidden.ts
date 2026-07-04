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

export const cstMemberAccessForbidden: CstChecker = (c, p) => {
  const object = String(p.object ?? "");
  const property = String(p.property ?? "");

  for (const m of collect(c.bodyNode, "member_expression")) {
    const kids = named(m); // [object identifier, property identifier]
    if (kids.length < 2) continue;
    const objText = (kids[0]?.text ?? "").trim();
    const propText = (kids[kids.length - 1]?.text ?? "").trim();
    if (objText === object && propText === property) {
      return { result: "fail", detail: (p.failDetail as string) ?? `${object}.${property} is used here` };
    }
  }

  return { result: "pass", detail: (p.passDetail as string) ?? `${object}.${property} is not used in this scope` };
};
