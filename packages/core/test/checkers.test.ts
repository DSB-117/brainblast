import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { positionalArgIdentity } from "../src/checkers/positionalArgIdentity.ts";
import { requiredCallWithOptions } from "../src/checkers/requiredCallWithOptions.ts";
import { feeAllocationShape } from "../src/checkers/feeAllocationShape.ts";
import { argEqualsConstantIdentifier } from "../src/checkers/argEqualsConstantIdentifier.ts";
import type { Candidate } from "../src/types.ts";

function candidate(code: string, fnName: string): Candidate {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("t.ts", code);
  const fn = sf.getFunctionOrThrow(fnName);
  return { filePath: "t.ts", fnName, params: fn.getParameters().map((p) => p.getName()), fn };
}

const STRIPE = {
  call: "constructEvent",
  argIndex: 0,
  paramIndex: 0,
  absentDetail: "absent",
  parsedDetail: "parsed",
  passDetail: "verified {param}",
};

describe("positionalArgIdentity (Stripe rule template)", () => {
  it("PASS when constructEvent verifies the raw body param", () => {
    const c = candidate(
      `import Stripe from "stripe"; const s = new Stripe("x");
       export function h(rawBody: string, sig: string) { return s.webhooks.constructEvent(rawBody, sig, "sec"); }`,
      "h",
    );
    const r = positionalArgIdentity(c, STRIPE);
    expect(r.result).toBe("pass");
    expect(r.detail).toContain("rawBody");
  });

  it("FAIL when constructEvent is absent", () => {
    const c = candidate(`export function h(rawBody: string) { return JSON.parse(rawBody); }`, "h");
    expect(positionalArgIdentity(c, STRIPE).result).toBe("fail");
  });

  it("FAIL when verifying a parsed value, not the raw body", () => {
    const c = candidate(
      `import Stripe from "stripe"; const s = new Stripe("x");
       export function h(rawBody: string, sig: string) { return s.webhooks.constructEvent(JSON.parse(rawBody), sig, "sec"); }`,
      "h",
    );
    expect(positionalArgIdentity(c, STRIPE).result).toBe("fail");
  });

  it("CANT_TELL when the first arg is some other identifier", () => {
    const c = candidate(
      `import Stripe from "stripe"; const s = new Stripe("x");
       export function h(rawBody: string, sig: string) { const other = "z"; return s.webhooks.constructEvent(other, sig, "sec"); }`,
      "h",
    );
    expect(positionalArgIdentity(c, STRIPE).result).toBe("cant_tell");
  });
});

const JWT = {
  verifyCalls: ["jwtVerify", "verify"],
  decodeCalls: ["decodeJwt", "decode"],
  requiredProps: [["audience", "aud"], ["issuer", "iss"]],
  passDetail: "ok",
  missingPropsDetail: "missing",
  decodeOnlyDetail: "decode-only",
};

describe("requiredCallWithOptions (Privy/JWT rule template)", () => {
  it("PASS when jwtVerify asserts issuer + audience", () => {
    const c = candidate(
      `import { jwtVerify } from "jose";
       export async function h(token: string, key: any) { return jwtVerify(token, key, { issuer: "privy.io", audience: "app" }); }`,
      "h",
    );
    expect(requiredCallWithOptions(c, JWT).result).toBe("pass");
  });

  it("PASS with shorthand { issuer, audience }", () => {
    const c = candidate(
      `import { jwtVerify } from "jose";
       export async function h(token: string, key: any) { const issuer = "privy.io"; const audience = "app"; return jwtVerify(token, key, { issuer, audience }); }`,
      "h",
    );
    expect(requiredCallWithOptions(c, JWT).result).toBe("pass");
  });

  it("FAIL when verify is missing aud/iss", () => {
    const c = candidate(
      `import { jwtVerify } from "jose";
       export async function h(token: string, key: any) { return jwtVerify(token, key, { audience: "app" }); }`,
      "h",
    );
    expect(requiredCallWithOptions(c, JWT).result).toBe("fail");
  });

  it("FAIL when the token is only decoded (auth bypass)", () => {
    const c = candidate(
      `import { decodeJwt } from "jose";
       export function h(token: string) { return decodeJwt(token); }`,
      "h",
    );
    expect(requiredCallWithOptions(c, JWT).result).toBe("fail");
  });

  it("CANT_TELL when neither verify nor decode is present", () => {
    const c = candidate(
      `export function h(token: string) { return resolve(token); }
       function resolve(t: string) { return { sub: t }; }`,
      "h",
    );
    expect(requiredCallWithOptions(c, JWT).result).toBe("cant_tell");
  });
});

const BAGS = {
  configCall: "createBagsFeeShareConfig",
  arrayProp: "feeClaimers",
  walletProp: "user",
  bpsProp: "userBps",
  bpsTotal: 10000,
  creatorParamRegex: "creator",
  absentDetail: "absent",
  dynamicDetail: "dynamic",
  creatorMissingDetail: "creator-missing",
  bpsSumDetail: "sum {sum}",
  passDetail: "ok {param}",
};

describe("feeAllocationShape (Bags fee-share rule template)", () => {
  it("PASS when the creator is an explicit entry and userBps sum to 10000", () => {
    const c = candidate(
      `import { createBagsFeeShareConfig } from "@bagsfm/bags-sdk";
       export function h(creatorWallet: string) {
         const feeClaimers = [{ user: creatorWallet, userBps: 6000 }, { user: "P", userBps: 4000 }];
         return createBagsFeeShareConfig({ feeClaimers });
       }`,
      "h",
    );
    const r = feeAllocationShape(c, BAGS);
    expect(r.result).toBe("pass");
    expect(r.detail).toContain("creatorWallet");
  });

  it("FAIL when the creator wallet is omitted from feeClaimers", () => {
    const c = candidate(
      `import { createBagsFeeShareConfig } from "@bagsfm/bags-sdk";
       export function h(creatorWallet: string) {
         const feeClaimers = [{ user: "A", userBps: 6000 }, { user: "B", userBps: 4000 }];
         return createBagsFeeShareConfig({ feeClaimers });
       }`,
      "h",
    );
    expect(feeAllocationShape(c, BAGS).result).toBe("fail");
  });

  it("FAIL when userBps do not sum to 10000", () => {
    const c = candidate(
      `import { createBagsFeeShareConfig } from "@bagsfm/bags-sdk";
       export function h(creatorWallet: string) {
         const feeClaimers = [{ user: creatorWallet, userBps: 5000 }, { user: "P", userBps: 4000 }];
         return createBagsFeeShareConfig({ feeClaimers });
       }`,
      "h",
    );
    const r = feeAllocationShape(c, BAGS);
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("9000");
  });

  it("FAIL when createBagsFeeShareConfig is absent", () => {
    const c = candidate(
      `export function h(creatorWallet: string) { return { feeClaimers: [] }; }`,
      "h",
    );
    expect(feeAllocationShape(c, BAGS).result).toBe("fail");
  });

  it("CANT_TELL when feeClaimers is built dynamically (.map)", () => {
    const c = candidate(
      `import { createBagsFeeShareConfig } from "@bagsfm/bags-sdk";
       export function h(creatorWallet: string, partners: any[]) {
         const feeClaimers = partners.map((p) => ({ user: p.w, userBps: p.b }));
         return createBagsFeeShareConfig({ feeClaimers });
       }`,
      "h",
    );
    expect(feeAllocationShape(c, BAGS).result).toBe("cant_tell");
  });

  it("CANT_TELL when an entry's userBps is non-literal", () => {
    const c = candidate(
      `import { createBagsFeeShareConfig } from "@bagsfm/bags-sdk";
       export function h(creatorWallet: string, share: number) {
         const feeClaimers = [{ user: creatorWallet, userBps: share }, { user: "P", userBps: 4000 }];
         return createBagsFeeShareConfig({ feeClaimers });
       }`,
      "h",
    );
    expect(feeAllocationShape(c, BAGS).result).toBe("cant_tell");
  });
});

const T22 = {
  call: "createMint",
  argIndex: 7,
  expectedIdentifier: "TOKEN_2022_PROGRAM_ID",
  forbiddenIdentifiers: ["TOKEN_PROGRAM_ID"],
  requireImport: "TOKEN_2022_PROGRAM_ID",
  passDetail: "ok {expected}",
  failForbiddenDetail: "named-bad {got} (expected {expected})",
  failMissingDetail: "missing {expected}",
  failOtherDetail: "other {got} (expected {expected})",
  absentCallDetail: "no createMint",
  scopeNotMetDetail: "no TOKEN_2022 import",
};

describe("argEqualsConstantIdentifier (Token-2022 program-ID pin)", () => {
  it("PASS when createMint's programId arg is the expected constant", () => {
    const c = candidate(
      `import { createMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
       export function h(opts: any) {
         return createMint(opts.c, opts.p, opts.m, opts.f, opts.d, undefined, undefined, TOKEN_2022_PROGRAM_ID);
       }`,
      "h",
    );
    const r = argEqualsConstantIdentifier(c, T22);
    expect(r.result).toBe("pass");
    expect(r.detail).toContain("TOKEN_2022_PROGRAM_ID");
  });

  it("FAIL when createMint passes a forbidden constant (legacy)", () => {
    const c = candidate(
      `import { createMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
       export function h(opts: any) {
         return createMint(opts.c, opts.p, opts.m, opts.f, opts.d, undefined, undefined, TOKEN_PROGRAM_ID);
       }`,
      "h",
    );
    const r = argEqualsConstantIdentifier(c, T22);
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("TOKEN_PROGRAM_ID");
  });

  it("CANT_TELL when the file does not import TOKEN_2022_PROGRAM_ID (scope predicate)", () => {
    const c = candidate(
      `import { createMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
       export function h(opts: any) {
         return createMint(opts.c, opts.p, opts.m, opts.f, opts.d, undefined, undefined, TOKEN_PROGRAM_ID);
       }`,
      "h",
    );
    const r = argEqualsConstantIdentifier(c, T22);
    expect(r.result).toBe("cant_tell");
    expect(r.detail).toContain("TOKEN_2022");
  });

  it("CANT_TELL when the candidate doesn't call the target", () => {
    const c = candidate(
      `import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
       export function h() { return TOKEN_2022_PROGRAM_ID; }`,
      "h",
    );
    expect(argEqualsConstantIdentifier(c, T22).result).toBe("cant_tell");
  });

  it("FAIL when the programId arg is missing entirely (defaults to legacy)", () => {
    const c = candidate(
      `import { createMint, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
       export function h(opts: any) {
         return createMint(opts.c, opts.p, opts.m, opts.f, opts.d);
       }`,
      "h",
    );
    const r = argEqualsConstantIdentifier(c, T22);
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("TOKEN_2022_PROGRAM_ID");
  });
});
