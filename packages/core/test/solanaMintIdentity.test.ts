import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { solanaMintIdentity } from "../src/checkers/solanaMintIdentity.ts";
import type { Candidate } from "../src/types.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const JUP  = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

function candidate(source: string, fnName = "handler"): Candidate {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("file.ts", source);
  const fn = sf.getFunction(fnName) ?? sf.getFunctions()[0];
  if (!fn) throw new Error(`No function found in source`);
  return { filePath: "file.ts", fnName, params: [], fn };
}

function run(source: string, fnName?: string) {
  return solanaMintIdentity(candidate(source, fnName), {});
}

describe("solanaMintIdentity checker", () => {
  it("FAILs on a bare string literal with wrong address", () => {
    const r = run(`
      const USDC_MINT = "${USDT}";
      export function getPaymentMint() { return USDC_MINT; }
    `);
    expect(r.result).toBe("fail");
  });

  it("PASSes on the canonical address for that symbol", () => {
    const r = run(`
      const USDC_MINT = "${USDC}";
      export function getPaymentMint() { return USDC_MINT; }
    `);
    expect(r.result).toBe("pass");
  });

  it("FAILs on camelCase name with new PublicKey and wrong address", () => {
    const r = run(`
      import { PublicKey } from "@solana/web3.js";
      const usdcMint = new PublicKey("${USDT}");
      export function handler() { return usdcMint; }
    `);
    expect(r.result).toBe("fail");
  });

  it("FAILs on object-literal property with wrong address", () => {
    const r = run(`
      const MINTS = { USDC: "${USDT}" };
      export function handler() { return MINTS; }
    `);
    expect(r.result).toBe("fail");
  });

  it("PASSes on object-literal property with correct address", () => {
    const r = run(`
      const MINTS = { USDC: "${USDC}" };
      export function handler() { return MINTS; }
    `);
    expect(r.result).toBe("pass");
  });

  it("CANT_TELL when no symbol-named constant present", () => {
    const r = run(`
      const foo = "bar";
      export function handler() { return foo; }
    `);
    expect(r.result).toBe("cant_tell");
  });

  it("CANT_TELL when initializer is not a base58 address", () => {
    const r = run(`
      const USDC_MINT = process.env.USDC_MINT;
      export function handler() { return USDC_MINT; }
    `);
    expect(r.result).toBe("cant_tell");
  });

  it("PASSes on JUP canonical address", () => {
    const r = run(`
      import { PublicKey } from "@solana/web3.js";
      const JUP_MINT = new PublicKey("${JUP}");
      export function handler() { return JUP_MINT; }
    `);
    expect(r.result).toBe("pass");
  });
});
