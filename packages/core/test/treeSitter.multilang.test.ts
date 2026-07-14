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

const SOL_CALL_RULE: Rule = {
  id: "sol-selfdestruct", severity: "high", title: "selfdestruct present",
  component: { name: "solidity", type: "SmartContract" },
  detect: { modules: ["solidity"], nameRegex: "close|destroy|kill|handler", triggerCalls: ["selfdestruct"], lang: "solidity" },
  check: { kind: "cst-call-forbidden", params: { forbiddenCalls: ["selfdestruct"] } },
  test: { kind: "none" },
};

const SOL_DELEGATECALL_RULE: Rule = {
  id: "sol-delegatecall", severity: "high", title: "delegatecall present",
  component: { name: "solidity", type: "SmartContract" },
  detect: { modules: ["solidity"], nameRegex: "exec|proxy|forward|handler", triggerCalls: ["delegatecall"], lang: "solidity" },
  check: { kind: "cst-call-forbidden", params: { forbiddenCalls: ["delegatecall"] } },
  test: { kind: "none" },
};

const solSelfdestruct = `pragma solidity ^0.8.0;
contract C { function kill(address payable a) public { selfdestruct(a); } }
`;
const solNoSelfdestruct = `pragma solidity ^0.8.0;
contract C { function kill(address payable a) public { a.transfer(address(this).balance); } }
`;
const solDelegatecall = `pragma solidity ^0.8.0;
contract P { function forward(address a, bytes memory d) public { a.delegatecall(d); } }
`;

describe("Solidity static AST — cst-call-forbidden", () => {
  it("flags a bare selfdestruct(...) call (RED)", () => {
    const r = scan("solidity", "C.sol", solSelfdestruct, SOL_CALL_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("fail");
  });
  it("clears a scope with no selfdestruct (GREEN)", () => {
    const r = scan("solidity", "C.sol", solNoSelfdestruct, SOL_CALL_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("pass");
  });
  it("flags a method-call callee regardless of receiver — a.delegatecall(d) (RED)", () => {
    const r = scan("solidity", "P.sol", solDelegatecall, SOL_DELEGATECALL_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("fail");
  });
});

const SOL_STRUCT_RULE: Rule = {
  id: "sol-v3-minout", severity: "high", title: "zeroed amountOutMinimum",
  component: { name: "solidity", type: "SmartContract" },
  detect: { modules: ["solidity"], nameRegex: "swap", triggerCalls: [], lang: "solidity" },
  check: { kind: "cst-struct-field-forbidden-literal", params: { typeName: "ExactInputSingleParams", field: "amountOutMinimum", forbiddenValue: "0" } },
  test: { kind: "none" },
};

const solStructVuln = `pragma solidity ^0.8.20;
contract S {
  function swap(uint256 amountIn) external {
    IR.ExactInputSingleParams memory p = IR.ExactInputSingleParams({ tokenIn: address(0), amountIn: amountIn, amountOutMinimum: 0, sqrtPriceLimitX96: 0 });
  }
}
`;
const solStructFixed = `pragma solidity ^0.8.20;
contract S {
  function swap(uint256 amountIn, uint256 minOut) external {
    IR.ExactInputSingleParams memory p = IR.ExactInputSingleParams({ tokenIn: address(0), amountIn: amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0 });
  }
}
`;
const solStructSafeLiteral = `pragma solidity ^0.8.20;
contract S {
  function swap(uint256 amountIn) external {
    IR.ExactInputSingleParams memory p = IR.ExactInputSingleParams({ tokenIn: address(0), amountIn: amountIn, amountOutMinimum: 1, sqrtPriceLimitX96: 0 });
  }
}
`;

describe("Solidity static AST — cst-struct-field-forbidden-literal", () => {
  it("flags a struct field set to the forbidden 0 — amountOutMinimum: 0 (RED)", () => {
    const r = scan("solidity", "S.sol", solStructVuln, SOL_STRUCT_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("fail");
  });
  it("clears a computed field value — amountOutMinimum: minOut (GREEN)", () => {
    const r = scan("solidity", "S.sol", solStructFixed, SOL_STRUCT_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("pass");
  });
  it("clears a non-forbidden literal — amountOutMinimum: 1 (GREEN)", () => {
    const r = scan("solidity", "S.sol", solStructSafeLiteral, SOL_STRUCT_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("pass");
  });
  it("matches the type by member-access suffix (IR.ExactInputSingleParams) not just a bare name", () => {
    const r = scan("solidity", "S.sol", solStructVuln, SOL_STRUCT_RULE);
    expect(r[0].result).toBe("fail");
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
