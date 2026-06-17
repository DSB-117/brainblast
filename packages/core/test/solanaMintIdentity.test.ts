import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { solanaMintIdentity } from "../src/checkers/solanaMintIdentity.ts";
import type { Candidate } from "../src/types.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

function candidate(code: string, fnName: string): Candidate {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("t.ts", code);
  const fn = sf.getFunctionOrThrow(fnName);
  return { filePath: "t.ts", fnName, params: fn.getParameters().map((p) => p.getName()), fn };
}

describe("solanaMintIdentity checker", () => {
  it("FAIL: USDC_MINT bound to a non-canonical address (bare string)", () => {
    const c = candidate(
      `const USDC_MINT = "${USDT}";\nexport function getMint() { return USDC_MINT; }`,
      "getMint",
    );
    const r = solanaMintIdentity(c, {});
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("USDC");
  });

  it("PASS: USDC_MINT bound to the canonical address", () => {
    const c = candidate(
      `const USDC_MINT = "${USDC}";\nexport function getMint() { return USDC_MINT; }`,
      "getMint",
    );
    expect(solanaMintIdentity(c, {}).result).toBe("pass");
  });

  it("FAIL: camelCase usdcMint via new PublicKey(wrong address)", () => {
    const c = candidate(
      `import { PublicKey } from "@solana/web3.js";\n` +
        `const usdcMint = new PublicKey("${USDT}");\nexport function pay() { return usdcMint; }`,
      "pay",
    );
    expect(solanaMintIdentity(c, {}).result).toBe("fail");
  });

  it("FAIL: object-literal map { USDC: wrongAddress }", () => {
    const c = candidate(
      `const MINTS = { USDC: "${USDT}" };\nexport function pick() { return MINTS.USDC; }`,
      "pick",
    );
    expect(solanaMintIdentity(c, {}).result).toBe("fail");
  });

  it("PASS: object-literal map with the canonical address", () => {
    const c = candidate(
      `const MINTS = { USDC: "${USDC}" };\nexport function pick() { return MINTS.USDC; }`,
      "pick",
    );
    expect(solanaMintIdentity(c, {}).result).toBe("pass");
  });

  it("CANT_TELL: no constant named after a canonical symbol", () => {
    const c = candidate(
      `const SOME_MINT = "${USDT}";\nexport function go() { return SOME_MINT; }`,
      "go",
    );
    expect(solanaMintIdentity(c, {}).result).toBe("cant_tell");
  });

  it("CANT_TELL: symbol-named constant but value is not a base58 address", () => {
    const c = candidate(
      `const USDC_MINT = process.env.USDC_MINT!;\nexport function go() { return USDC_MINT; }`,
      "go",
    );
    expect(solanaMintIdentity(c, {}).result).toBe("cant_tell");
  });
});
