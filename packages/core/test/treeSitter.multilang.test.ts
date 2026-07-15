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
  // Regression: tree-sitter-solidity mis-parses `!isContract(x) && tx.origin == y`
  // as `(!isContract(x) && tx).origin`, so the member_expression's object is a
  // binary_expression, not the bare `tx`. Matching the object's rightmost identifier
  // still trips the trap. (Real repo: dypfinance noContractsAllowed gate.)
  it("flags tx.origin inside a compound && guard (RED)", () => {
    const src = `pragma solidity ^0.8.0;
contract Farm { function auth() public view {
  require(!isContract(msg.sender) && tx.origin == msg.sender, "no contracts");
} function isContract(address a) internal view returns (bool) { return a.code.length > 0; } }
`;
    const r = scan("solidity", "Farm.sol", src, SOL_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("fail");
  });
  it("does not fire on a compound && guard once tx.origin is removed (GREEN)", () => {
    const src = `pragma solidity ^0.8.0;
contract Farm { function auth() public view {
  require(!isContract(msg.sender), "no contracts");
} function isContract(address a) internal view returns (bool) { return a.code.length > 0; } }
`;
    const r = scan("solidity", "Farm.sol", src, SOL_RULE);
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

const SOL_POSITIONAL_RULE: Rule = {
  id: "sol-v2-minout", severity: "high", title: "zeroed V2 min-out",
  component: { name: "solidity", type: "SmartContract" },
  detect: { modules: ["solidity"], nameRegex: "open", triggerCalls: [], lang: "solidity" },
  check: { kind: "cst-positional-arg-forbidden-literal", params: { call: "addLiquidityETH", argIndex: 2, forbiddenValue: "0" } },
  test: { kind: "none" },
};
const solPosVuln = `pragma solidity ^0.8.20;
contract C { function open() external { router.addLiquidityETH(token, bal, 0, 0, owner, block.timestamp); } }
`;
const solPosFixed = `pragma solidity ^0.8.20;
contract C { function open(uint256 minTok) external { router.addLiquidityETH(token, bal, minTok, 1, owner, block.timestamp); } }
`;
const solPosCast = `pragma solidity ^0.8.20;
contract C { function open() external { uni.swapExactTokensForTokens(amountIn, uint256(0), path, to, deadline); } }
`;
const SOL_POSITIONAL_CAST_RULE: Rule = {
  ...SOL_POSITIONAL_RULE,
  detect: { ...SOL_POSITIONAL_RULE.detect, nameRegex: "open" },
  check: { kind: "cst-positional-arg-forbidden-literal", params: { call: "swapExactTokensForTokens", argIndex: 1, forbiddenValue: "0" } },
};

describe("Solidity static AST — cst-positional-arg-forbidden-literal", () => {
  it("flags a zeroed positional min-out — addLiquidityETH(...,0,...) (RED)", () => {
    const r = scan("solidity", "C.sol", solPosVuln, SOL_POSITIONAL_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("fail");
  });
  it("clears a computed/non-forbidden positional arg (GREEN)", () => {
    const r = scan("solidity", "C.sol", solPosFixed, SOL_POSITIONAL_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("pass");
  });
  it("recognizes a numeric-cast zero — swapExactTokensForTokens(amt, uint256(0), ...) (RED)", () => {
    const r = scan("solidity", "C.sol", solPosCast, SOL_POSITIONAL_CAST_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("fail");
  });
  it("matches a payable call — router.addLiquidityETH{value: bal}(...,0,...) (RED)", () => {
    const src = `pragma solidity ^0.8.20;
contract C { function open() external { router.addLiquidityETH{value: address(this).balance}(tk, bal, 0, 0, to, dl); } }
`;
    const rule: Rule = { ...SOL_POSITIONAL_RULE, detect: { ...SOL_POSITIONAL_RULE.detect, nameRegex: "open" } };
    const r = scan("solidity", "C.sol", src, rule);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("fail");
  });
  // Regression: a scope that calls the target more than once — a safe call FIRST,
  // then an unguarded 0 in a later hop — must still fail (any-match, not first-
  // match). Real repo: a Base Aave liquidator's multi-hop _swapDispatch.
  const SOL_MULTICALL_RULE: Rule = {
    ...SOL_POSITIONAL_RULE, id: "sol-multihop-minout",
    detect: { ...SOL_POSITIONAL_RULE.detect, nameRegex: "doSwaps" },
    check: { kind: "cst-positional-arg-forbidden-literal", params: { call: "_swap", argIndex: 5, forbiddenValue: "0" } },
  };
  it("flags a forbidden 0 in a LATER call when the first call is safe (RED, any-match)", () => {
    const src = `pragma solidity ^0.8.20;
contract C { function doSwaps(uint256 owed) internal {
  _swap(col, debt, k1, f1, bal, owed);        // safe (variable min-out)
  uint256 mid = _swap(col, USDC, k1, f1, bal, 0);  // unguarded
} }
`;
    const r = scan("solidity", "C.sol", src, SOL_MULTICALL_RULE);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe("fail");
  });
  it("passes when every call's slot is a non-forbidden value (GREEN)", () => {
    const src = `pragma solidity ^0.8.20;
contract C { function doSwaps(uint256 owed, uint256 midMin) internal {
  _swap(col, debt, k1, f1, bal, owed);
  uint256 mid = _swap(col, USDC, k1, f1, bal, midMin);
} }
`;
    const r = scan("solidity", "C.sol", src, SOL_MULTICALL_RULE);
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
