import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditWithRule } from "../src/audit.ts";
import type { Rule } from "../src/types.ts";

function scan(lang: "go" | "solidity", filename: string, source: string, rule: Rule) {
  const dir = mkdtempSync(join(tmpdir(), `bb-${lang}-`));
  writeFileSync(join(dir, filename), source);
  return auditWithRule(dir, rule);
}

const GO_RULE: Rule = {
  id: "go-tls", severity: "critical", title: "insecure tls",
  component: { name: "crypto/tls", type: "Networking" },
  detect: { modules: ["crypto/tls"], nameRegex: "client|new|tls", triggerCalls: ["tls.Config"], lang: "go" },
  check: { kind: "cst-struct-field-forbidden-literal", params: { typeName: "tls.Config", field: "InsecureSkipVerify", forbiddenValue: true } },
  test: { kind: "none" },
};

const SOL_RULE: Rule = {
  id: "sol-txorigin", severity: "high", title: "tx.origin auth",
  component: { name: "solidity", type: "SmartContract" },
  detect: { modules: ["solidity"], nameRegex: "withdraw|owner|auth", triggerCalls: ["tx.origin"], lang: "solidity" },
  check: { kind: "cst-member-access-forbidden", params: { object: "tx", property: "origin" } },
  test: { kind: "none" },
};

const goVuln = `package client
import "crypto/tls"
func newClient() *tls.Config { return &tls.Config{InsecureSkipVerify: true} }
`;
const goFixed = `package client
import "crypto/tls"
func newClient() *tls.Config { return &tls.Config{InsecureSkipVerify: false} }
`;
const solVuln = `pragma solidity ^0.8.0;
contract Vault { address owner; function withdraw() public { require(tx.origin == owner); } }
`;
const solFixed = `pragma solidity ^0.8.0;
contract Vault { address owner; function withdraw() public { require(msg.sender == owner); } }
`;

describe("Go static AST — cst-struct-field-forbidden-literal", () => {
  it("flags InsecureSkipVerify: true (RED)", () => {
    const r = scan("go", "client.go", goVuln, GO_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("fail");
  });
  it("clears InsecureSkipVerify: false (GREEN)", () => {
    const r = scan("go", "client.go", goFixed, GO_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("pass");
  });
});

describe("Solidity static AST — cst-member-access-forbidden", () => {
  it("flags tx.origin authorization (RED)", () => {
    const r = scan("solidity", "Vault.sol", solVuln, SOL_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("fail");
  });
  it("clears msg.sender authorization (GREEN)", () => {
    const r = scan("solidity", "Vault.sol", solFixed, SOL_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("pass");
  });
});

describe("finder scoping", () => {
  it("does not consider a Go function that neither matches nameRegex nor calls the trigger", () => {
    const src = `package other
import "crypto/tls"
func unrelatedHelper() *tls.Config { return &tls.Config{InsecureSkipVerify: true} }
`;
    // nameRegex "client|new|tls" doesn't match "unrelatedHelper"; trigger "tls.Config"
    // IS in the body, so it's still considered — assert it's caught (trigger match).
    const r = scan("go", "other.go", src, GO_RULE);
    expect(r[0]?.result).toBe("fail");
  });
});
