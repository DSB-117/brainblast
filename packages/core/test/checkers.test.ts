import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { positionalArgIdentity } from "../src/checkers/positionalArgIdentity.ts";
import { requiredCallWithOptions } from "../src/checkers/requiredCallWithOptions.ts";
import { feeAllocationShape } from "../src/checkers/feeAllocationShape.ts";
import { argEqualsConstantIdentifier } from "../src/checkers/argEqualsConstantIdentifier.ts";
import { objectArgPropertyLiteralEquals } from "../src/checkers/objectArgPropertyLiteralEquals.ts";
import { anchorInitIfNeededGuarded } from "../src/checkers/anchorInitIfNeededGuarded.ts";
import type { Candidate, RustCandidate } from "../src/types.ts";

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

const MPL = {
  call: "createV1",
  argIndex: 1,
  propName: "isMutable",
  expectedValue: false,
  passDetail: "sealed",
  failAbsentDetail: "absent-defaults-true",
  failWrongDetail: "explicit-true",
  failArgDetail: "not-object-literal",
  failDynamicDetail: "dynamic-value",
  absentCallDetail: "no-createV1",
};

describe("objectArgPropertyLiteralEquals (Metaplex isMutable)", () => {
  it("PASS when createV1 passes isMutable: false", () => {
    const c = candidate(
      `import { createV1 } from "@metaplex-foundation/mpl-token-metadata";
       export async function h(umi: any) {
         await createV1(umi, { name: "T", isMutable: false });
       }`,
      "h",
    );
    const r = objectArgPropertyLiteralEquals(c, MPL);
    expect(r.result).toBe("pass");
    expect(r.detail).toContain("sealed");
  });

  it("FAIL when isMutable is absent (defaults to true)", () => {
    const c = candidate(
      `import { createV1 } from "@metaplex-foundation/mpl-token-metadata";
       export async function h(umi: any) {
         await createV1(umi, { name: "T" });
       }`,
      "h",
    );
    const r = objectArgPropertyLiteralEquals(c, MPL);
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("absent");
  });

  it("FAIL when isMutable is explicitly true", () => {
    const c = candidate(
      `import { createV1 } from "@metaplex-foundation/mpl-token-metadata";
       export async function h(umi: any) {
         await createV1(umi, { name: "T", isMutable: true });
       }`,
      "h",
    );
    const r = objectArgPropertyLiteralEquals(c, MPL);
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("explicit-true");
  });

  it("CANT_TELL when isMutable is a variable", () => {
    const c = candidate(
      `import { createV1 } from "@metaplex-foundation/mpl-token-metadata";
       export async function h(umi: any, lock: boolean) {
         await createV1(umi, { name: "T", isMutable: lock });
       }`,
      "h",
    );
    const r = objectArgPropertyLiteralEquals(c, MPL);
    expect(r.result).toBe("cant_tell");
    expect(r.detail).toContain("dynamic");
  });

  it("CANT_TELL when the options arg is a variable, not an inline literal", () => {
    const c = candidate(
      `import { createV1 } from "@metaplex-foundation/mpl-token-metadata";
       export async function h(umi: any) {
         const opts = { name: "T", isMutable: false };
         await createV1(umi, opts);
       }`,
      "h",
    );
    const r = objectArgPropertyLiteralEquals(c, MPL);
    expect(r.result).toBe("cant_tell");
    expect(r.detail).toContain("not-object-literal");
  });

  it("CANT_TELL when createV1 is not called", () => {
    const c = candidate(
      `import { createV1 } from "@metaplex-foundation/mpl-token-metadata";
       export function h(umi: any) { return umi; }`,
      "h",
    );
    const r = objectArgPropertyLiteralEquals(c, MPL);
    expect(r.result).toBe("cant_tell");
    expect(r.detail).toContain("no-createV1");
  });

  it("FAIL when the options arg (index 1) is missing entirely", () => {
    const c = candidate(
      `import { createV1 } from "@metaplex-foundation/mpl-token-metadata";
       export async function h(umi: any) {
         await createV1(umi);
       }`,
      "h",
    );
    const r = objectArgPropertyLiteralEquals(c, MPL);
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("absent");
  });
});

// ── anchorInitIfNeededGuarded ──────────────────────────────────────────────
// These tests build RustCandidate objects directly (no tree-sitter at test
// time) to keep the unit tests fast and hermetic.

function rustCandidate(
  fnName: string,
  accountFields: RustCandidate["accountFields"],
  fnBodyText: string,
): RustCandidate {
  return {
    filePath: "test.rs",
    fnName,
    accountStructName: "TestAccounts",
    accountFields,
    fnBodyText,
    fnBodyNode: null,
  };
}

describe("anchorInitIfNeededGuarded (Anchor init_if_needed reinit)", () => {
  it("PASS when init_if_needed account has a require! guard", () => {
    const c = rustCandidate(
      "initialize",
      [{ name: "counter", typeName: "Account<'info, Counter>", attrText: "#[account(init_if_needed, payer = payer, space = 8+8)]", hasInitIfNeeded: true }],
      "{ require!(ctx.accounts.counter.count == 0, CounterError::AlreadyInitialized); ctx.accounts.counter.count = start; Ok(()) }",
    );
    const r = anchorInitIfNeededGuarded(c, {});
    expect(r.result).toBe("pass");
    expect(r.detail).toContain("counter");
  });

  it("PASS when init_if_needed account uses data_is_empty() check", () => {
    const c = rustCandidate(
      "initialize",
      [{ name: "data", typeName: "AccountInfo<'info>", attrText: "#[account(init_if_needed)]", hasInitIfNeeded: true }],
      "{ if ctx.accounts.data.data_is_empty() { return err!(MyError::Done); } *ctx.accounts.data.try_borrow_mut_data()? = &[1]; Ok(()) }",
    );
    expect(anchorInitIfNeededGuarded(c, {}).result).toBe("pass");
  });

  it("FAIL when init_if_needed account has no guard", () => {
    const c = rustCandidate(
      "initialize",
      [{ name: "counter", typeName: "Account<'info, Counter>", attrText: "#[account(init_if_needed, payer = payer, space = 8+8)]", hasInitIfNeeded: true }],
      "{ ctx.accounts.counter.count = start; Ok(()) }",
    );
    const r = anchorInitIfNeededGuarded(c, {});
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("counter");
    expect(r.detail).toContain("require!");
  });

  it("CANT_TELL when no account has init_if_needed", () => {
    const c = rustCandidate(
      "update",
      [{ name: "counter", typeName: "Account<'info, Counter>", attrText: "#[account(mut)]", hasInitIfNeeded: false }],
      "{ ctx.accounts.counter.count += 1; Ok(()) }",
    );
    const r = anchorInitIfNeededGuarded(c, {});
    expect(r.result).toBe("cant_tell");
  });

  it("PASS when is_initialized flag is checked", () => {
    const c = rustCandidate(
      "initialize",
      [{ name: "state", typeName: "Account<'info, State>", attrText: "#[account(init_if_needed, payer = payer, space = 64)]", hasInitIfNeeded: true }],
      "{ if ctx.accounts.state.is_initialized { return err!(MyError::AlreadyInit); } ctx.accounts.state.is_initialized = true; Ok(()) }",
    );
    expect(anchorInitIfNeededGuarded(c, {}).result).toBe("pass");
  });

  it("FAIL respects custom failAbsentDetail message param", () => {
    const c = rustCandidate(
      "setup",
      [{ name: "vault", typeName: "Account<'info, Vault>", attrText: "#[account(init_if_needed)]", hasInitIfNeeded: true }],
      "{ ctx.accounts.vault.amount = 0; Ok(()) }",
    );
    const r = anchorInitIfNeededGuarded(c, { failAbsentDetail: "CUSTOM_FAIL_MSG" });
    expect(r.result).toBe("fail");
    expect(r.detail).toBe("CUSTOM_FAIL_MSG");
  });
});
