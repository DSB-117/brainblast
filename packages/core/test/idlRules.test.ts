import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseIdl,
  generateRulesFromIdl,
  buildConstraintParams,
  toSnakeCase,
  renderRulesYaml,
} from "../src/idlRules.ts";
import { anchorIdlAccount } from "../src/checkers/anchorIdlAccount.ts";
import { audit } from "../src/audit.ts";
import type { RustCandidate } from "../src/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (p: string) => resolve(here, "..", "fixtures", p);

const VAULT_IDL = {
  metadata: { name: "vault_program", version: "0.1.0" },
  instructions: [
    {
      name: "withdraw",
      accounts: [
        { name: "authority", isMut: true, isSigner: true },
        { name: "vault", isMut: true, isSigner: false },
      ],
    },
  ],
};

describe("toSnakeCase", () => {
  it("converts camelCase and PascalCase", () => {
    expect(toSnakeCase("tokenAccount")).toBe("token_account");
    expect(toSnakeCase("Withdraw")).toBe("withdraw");
    expect(toSnakeCase("initializeVaultV2")).toBe("initialize_vault_v2");
  });
});

describe("parseIdl", () => {
  it("accepts a well-formed IDL", () => {
    const idl = parseIdl(VAULT_IDL);
    expect(idl.instructions).toHaveLength(1);
  });
  it("rejects a non-object", () => {
    expect(() => parseIdl(null)).toThrow();
  });
  it("rejects an IDL with no instructions array", () => {
    expect(() => parseIdl({ metadata: { name: "x" } })).toThrow(/instructions/);
  });
});

describe("buildConstraintParams", () => {
  it("extracts signer and mutable accounts in snake_case", () => {
    const params = buildConstraintParams(parseIdl(VAULT_IDL));
    expect(params.idlName).toBe("vault_program");
    expect(params.instructions[0].name).toBe("withdraw");
    expect(params.instructions[0].signers).toEqual(["authority"]);
    expect(params.instructions[0].mutable).toEqual(["authority", "vault"]);
  });
});

describe("generateRulesFromIdl", () => {
  it("produces one scoped rule", () => {
    const rules = generateRulesFromIdl(parseIdl(VAULT_IDL));
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("idl-vault-program-account-constraints");
    expect(rules[0].detect.lang).toBe("rust");
    expect(rules[0].detect.nameRegex).toBe("^(withdraw)$");
    expect(rules[0].check.kind).toBe("anchor-account-matches-idl");
  });

  it("serializes to YAML", () => {
    const yaml = renderRulesYaml(generateRulesFromIdl(parseIdl(VAULT_IDL)));
    expect(yaml).toContain("idl-vault-program-account-constraints");
    expect(yaml).toContain("anchor-account-matches-idl");
  });
});

// ── Checker unit tests (synthetic RustCandidate) ─────────────────────────────
function rustCandidate(fnName: string, accountFields: RustCandidate["accountFields"]): RustCandidate {
  return { filePath: "lib.rs", fnName, accountStructName: "Withdraw", accountFields, fnBodyText: "{}", fnBodyNode: null };
}

const params = buildConstraintParams(parseIdl(VAULT_IDL));

describe("anchorIdlAccount checker", () => {
  it("FAILs when an IDL signer is not a Signer in Rust", () => {
    const c = rustCandidate("withdraw", [
      { name: "authority", typeName: "AccountInfo<'info>", attrText: "#[account(mut)]", hasInitIfNeeded: false },
      { name: "vault", typeName: "Account<'info, Vault>", attrText: "#[account(mut)]", hasInitIfNeeded: false },
    ]);
    expect(anchorIdlAccount(c, params).result).toBe("fail");
  });

  it("PASSes when all IDL constraints are present", () => {
    const c = rustCandidate("withdraw", [
      { name: "authority", typeName: "Signer<'info>", attrText: "#[account(mut)]", hasInitIfNeeded: false },
      { name: "vault", typeName: "Account<'info, Vault>", attrText: "#[account(mut)]", hasInitIfNeeded: false },
    ]);
    expect(anchorIdlAccount(c, params).result).toBe("pass");
  });

  it("FAILs when an IDL mutable account lacks mut", () => {
    const c = rustCandidate("withdraw", [
      { name: "authority", typeName: "Signer<'info>", attrText: "#[account()]", hasInitIfNeeded: false },
      { name: "vault", typeName: "Account<'info, Vault>", attrText: "#[account()]", hasInitIfNeeded: false },
    ]);
    const r = anchorIdlAccount(c, params);
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("vault");
  });

  it("accepts a signer declared via attribute constraint", () => {
    const c = rustCandidate("withdraw", [
      { name: "authority", typeName: "AccountInfo<'info>", attrText: "#[account(mut, signer)]", hasInitIfNeeded: false },
      { name: "vault", typeName: "Account<'info, Vault>", attrText: "#[account(mut)]", hasInitIfNeeded: false },
    ]);
    expect(anchorIdlAccount(c, params).result).toBe("pass");
  });

  it("CANT_TELL for a handler not in the IDL", () => {
    const c = rustCandidate("unrelated", []);
    expect(anchorIdlAccount(c, params).result).toBe("cant_tell");
  });

  it("accepts init as satisfying mut", () => {
    const c = rustCandidate("withdraw", [
      { name: "authority", typeName: "Signer<'info>", attrText: "#[account(mut)]", hasInitIfNeeded: false },
      { name: "vault", typeName: "Account<'info, Vault>", attrText: "#[account(init, payer = authority, space = 16)]", hasInitIfNeeded: false },
    ]);
    expect(anchorIdlAccount(c, params).result).toBe("pass");
  });
});

// ── End-to-end: generate rule → audit real Rust fixtures (RED → GREEN) ────────
describe("idl-rules end-to-end audit", () => {
  const rules = generateRulesFromIdl(parseIdl(VAULT_IDL));

  it("FAILs the vulnerable program (missing Signer)", () => {
    const { checks } = audit(fx("idlconstraints/vulnerable"), rules);
    const fail = checks.find((c) => c.ruleId === "idl-vault-program-account-constraints");
    expect(fail?.result).toBe("fail");
  });

  it("PASSes the fixed program", () => {
    const { checks } = audit(fx("idlconstraints/fixed"), rules);
    const pass = checks.find((c) => c.ruleId === "idl-vault-program-account-constraints");
    expect(pass?.result).toBe("pass");
  });
});
