// Anchor IDL → auto-generated security rules.
//
// Every Anchor program ships an IDL that declares, per instruction, which
// accounts must be signers and which must be mutable. Developers hand-write the
// matching `#[derive(Accounts)]` constraints in Rust and routinely miss one —
// a missing `Signer<'info>` or `mut` is a silent authorization hole.
//
// This module turns an IDL into a brainblast rule that scans the program's Rust
// source and verifies every account constraint the IDL promises is actually
// present. It flips brainblast from "N hand-curated rules" to "unlimited rules
// derived directly from your own program's spec."

import { stringify as yamlStringify } from "yaml";
import type { Rule } from "./types.ts";

export interface IdlAccount {
  name: string;
  isMut?: boolean;
  isSigner?: boolean;
  // Nested account groups (Anchor composite accounts)
  accounts?: IdlAccount[];
}

export interface IdlInstruction {
  name: string;
  accounts: IdlAccount[];
}

export interface AnchorIdl {
  // Anchor >= 0.30 nests under `metadata.name`; older IDLs use top-level `name`.
  name?: string;
  metadata?: { name?: string; version?: string };
  version?: string;
  instructions: IdlInstruction[];
}

// camelCase or PascalCase → snake_case, so IDL account names line up with the
// Rust struct field identifiers Anchor generates.
export function toSnakeCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

export function idlProgramName(idl: AnchorIdl): string {
  return idl.metadata?.name ?? idl.name ?? "anchor-program";
}

// Flatten nested composite accounts into a single list of leaf accounts.
function flattenAccounts(accounts: IdlAccount[]): IdlAccount[] {
  const out: IdlAccount[] = [];
  for (const a of accounts) {
    if (a.accounts && a.accounts.length > 0) {
      out.push(...flattenAccounts(a.accounts));
    } else {
      out.push(a);
    }
  }
  return out;
}

export function parseIdl(json: unknown): AnchorIdl {
  if (!json || typeof json !== "object") throw new Error("IDL is not an object");
  const idl = json as AnchorIdl;
  if (!Array.isArray(idl.instructions)) throw new Error("IDL has no instructions array");
  for (const ix of idl.instructions) {
    if (!ix.name || !Array.isArray(ix.accounts)) {
      throw new Error(`IDL instruction missing name/accounts: ${JSON.stringify(ix).slice(0, 80)}`);
    }
  }
  return idl;
}

// The shape carried in the generated rule's check.params. The checker reads
// this to know what each instruction handler must declare.
export interface IdlConstraintParams {
  idlName: string;
  instructions: {
    name: string; // snake_case handler name
    signers: string[]; // snake_case account field names that must be signers
    mutable: string[]; // snake_case account field names that must be mutable
  }[];
}

export function buildConstraintParams(idl: AnchorIdl): IdlConstraintParams {
  const instructions = idl.instructions.map((ix) => {
    const leaves = flattenAccounts(ix.accounts);
    return {
      name: toSnakeCase(ix.name),
      signers: leaves.filter((a) => a.isSigner).map((a) => toSnakeCase(a.name)),
      mutable: leaves.filter((a) => a.isMut).map((a) => toSnakeCase(a.name)),
    };
  });
  return { idlName: idlProgramName(idl), instructions };
}

// Generate a single brainblast rule covering every instruction in the IDL.
// nameRegex matches only the handler names declared in this IDL, so the rule is
// scoped to this program and won't fire on unrelated Rust code.
export function generateRulesFromIdl(idl: AnchorIdl): Rule[] {
  const params = buildConstraintParams(idl);
  const handlerNames = params.instructions.map((i) => i.name).filter(Boolean);
  if (handlerNames.length === 0) return [];

  const nameRegex = `^(${handlerNames.map(escapeRegex).join("|")})$`;
  const progName = params.idlName;

  const rule: Rule = {
    id: `idl-${toKebab(progName)}-account-constraints`,
    severity: "critical",
    title: `Anchor accounts match the ${progName} IDL signer/mut constraints`,
    component: {
      name: progName,
      type: "Anchor program",
      version: idl.metadata?.version ?? idl.version ?? "unversioned",
      sourceUrl: "https://www.anchor-lang.com/docs/the-accounts-struct",
    },
    detect: {
      lang: "rust",
      modules: ["@coral-xyz/anchor", "@project-serum/anchor"],
      nameRegex,
      triggerCalls: [],
    },
    check: {
      kind: "anchor-account-matches-idl",
      params: params as unknown as Record<string, any>,
    },
    test: { kind: "none" },
  };

  return [rule];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toKebab(s: string): string {
  return toSnakeCase(s).replace(/_/g, "-");
}

// Render generated rules as YAML for writing into a rule pack directory.
export function renderRulesYaml(rules: Rule[]): string {
  return rules.map((r) => yamlStringify(r)).join("\n---\n");
}
