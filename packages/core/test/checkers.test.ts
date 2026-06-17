import { describe, it, expect, afterEach } from "vitest";
import { Project } from "ts-morph";
import { positionalArgIdentity } from "../src/checkers/positionalArgIdentity.ts";
import { requiredCallWithOptions } from "../src/checkers/requiredCallWithOptions.ts";
import { feeAllocationShape } from "../src/checkers/feeAllocationShape.ts";
import { argEqualsConstantIdentifier } from "../src/checkers/argEqualsConstantIdentifier.ts";
import { objectArgPropertyLiteralEquals } from "../src/checkers/objectArgPropertyLiteralEquals.ts";
import { anchorInitIfNeededGuarded } from "../src/checkers/anchorInitIfNeededGuarded.ts";
import { envSecretsCommitted } from "../src/checkers/envSecretsCommitted.ts";
import { taintToSink } from "../src/checkers/taintToSink.ts";
import { literalMultiplierWrongConstant } from "../src/checkers/literalMultiplierWrongConstant.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Candidate, RustCandidate, ConfigCandidate } from "../src/types.ts";

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

const SPL_AMOUNT = {
  call: "createMintToInstruction",
  argIndex: 3,
  forbiddenIdentifiers: ["LAMPORTS_PER_SOL"],
  expectedIdentifiers: ["decimals"],
  failDetail: "lamports-per-sol-used: {got}",
  passDetail: "decimals-scaled",
  absentCallDetail: "no-createMintToInstruction",
  cantTellDetail: "unrecognized-amount-expression",
};

describe("literalMultiplierWrongConstant (SPL amount scaling)", () => {
  it("FAIL when the amount is scaled by LAMPORTS_PER_SOL", () => {
    const c = candidate(
      `import { createMintToInstruction } from "@solana/spl-token";
       import { LAMPORTS_PER_SOL } from "@solana/web3.js";
       export function h(opts: any) {
         return createMintToInstruction(opts.mint, opts.dest, opts.auth, opts.amount * LAMPORTS_PER_SOL, [], opts.programId);
       }`,
      "h",
    );
    const r = literalMultiplierWrongConstant(c, SPL_AMOUNT);
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("LAMPORTS_PER_SOL");
  });

  it("PASS when the amount is scaled by the mint's decimals", () => {
    const c = candidate(
      `import { createMintToInstruction } from "@solana/spl-token";
       export function h(opts: any) {
         return createMintToInstruction(opts.mint, opts.dest, opts.auth, opts.amount * (10 ** opts.decimals), [], opts.programId);
       }`,
      "h",
    );
    const r = literalMultiplierWrongConstant(c, SPL_AMOUNT);
    expect(r.result).toBe("pass");
  });

  it("CANT_TELL when the candidate doesn't call the target", () => {
    const c = candidate(
      `export function h(opts: any) { return opts.amount; }`,
      "h",
    );
    expect(literalMultiplierWrongConstant(c, SPL_AMOUNT).result).toBe("cant_tell");
  });

  it("CANT_TELL when the amount expression matches neither pattern", () => {
    const c = candidate(
      `import { createMintToInstruction } from "@solana/spl-token";
       export function h(opts: any) {
         return createMintToInstruction(opts.mint, opts.dest, opts.auth, opts.rawAmount, [], opts.programId);
       }`,
      "h",
    );
    expect(literalMultiplierWrongConstant(c, SPL_AMOUNT).result).toBe("cant_tell");
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

describe("envSecretsCommitted", () => {
  const params = {
    secretKeyPattern: "(SECRET|PRIVATE_KEY|API_KEY|ACCESS_KEY|TOKEN|PASSWORD|CREDENTIAL)",
    placeholderPattern:
      "^(your[_-]|xxx|changeme|change[_-]?me|replace|example|<|sk_test_|pk_test_|test[_-]|dummy|placeholder|\\*+$|\\.\\.\\.$)",
    ignoredDetail: "File is git-ignored and not committed to source control.",
    passDetail: "File is tracked but contains no secret-looking values (placeholders only).",
    failDetailPrefix: "This file is committed to source control and contains what look like real secret values.",
  };

  function configCandidate(content: string, tracked: boolean, filePath = ".env"): ConfigCandidate {
    return { filePath, content, tracked };
  }

  it("PASS when file is git-ignored, regardless of content", () => {
    const c = configCandidate("DATABASE_PASSWORD=Sup3rSecretPass!23\n", false);
    const r = envSecretsCommitted(c, params);
    expect(r.result).toBe("pass");
    expect(r.detail).toBe(params.ignoredDetail);
  });

  it("FAIL when tracked file has a secret-shaped key with a real-looking value", () => {
    const c = configCandidate("DATABASE_PASSWORD=Sup3rSecretPass!23\nNODE_ENV=production\n", true);
    const r = envSecretsCommitted(c, params);
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("DATABASE_PASSWORD");
    expect(r.detail).not.toContain("NODE_ENV");
  });

  it("PASS when tracked file only contains placeholder values", () => {
    const c = configCandidate(
      "DATABASE_PASSWORD=changeme\nAPI_KEY=your_api_key_here\nSTRIPE_SECRET_KEY=sk_test_123\n",
      true,
    );
    const r = envSecretsCommitted(c, params);
    expect(r.result).toBe("pass");
    expect(r.detail).toBe(params.passDetail);
  });

  it("ignores comments, blank lines, and non-secret keys", () => {
    const c = configCandidate("# comment\n\nNODE_ENV=production\nPORT=3000\n", true);
    const r = envSecretsCommitted(c, params);
    expect(r.result).toBe("pass");
  });

  it("FAIL lists multiple offending keys", () => {
    const c = configCandidate(
      "DATABASE_PASSWORD=Sup3rSecretPass!23\nSTRIPE_API_KEY=actual_live_value_here\n",
      true,
    );
    const r = envSecretsCommitted(c, params);
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("DATABASE_PASSWORD");
    expect(r.detail).toContain("STRIPE_API_KEY");
  });
});

describe("taintToSink", () => {
  const params = {
    sources: [
      { name: "env-secret", pattern: "process\\.env\\.[A-Za-z0-9_]*(SECRET|PRIVATE_KEY|API_KEY|ACCESS_KEY|TOKEN|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*" },
    ],
    sinkCalls: ["log", "error", "warn", "info", "debug", "json", "send", "write", "end"],
    maxHops: 2,
  };

  it("fails when process.env.X is logged directly", () => {
    const c = candidate(
      `export function h() {
        console.log("key", process.env.STRIPE_SECRET_KEY);
      }`,
      "h",
    );
    const r = taintToSink(c, params);
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("STRIPE_SECRET_KEY");
  });

  it("fails when a secret read into a local variable is logged", () => {
    const c = candidate(
      `export function h() {
        const apiKey = process.env.STRIPE_API_KEY;
        console.log("using key", apiKey);
      }`,
      "h",
    );
    const r = taintToSink(c, params);
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("apiKey");
  });

  it("fails on a one-hop leak through a same-file helper (forward)", () => {
    const c = candidate(
      `function logIt(x: string) {
        console.log("debug", x);
      }
      export function h() {
        const apiKey = process.env.STRIPE_API_KEY;
        logIt(apiKey);
      }`,
      "h",
    );
    const r = taintToSink(c, params);
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("logIt");
  });

  it("passes when no secret-shaped env value reaches a sink", () => {
    const c = candidate(
      `export function h() {
        const mode = process.env.NODE_ENV;
        console.log("mode", mode);
      }`,
      "h",
    );
    const r = taintToSink(c, params);
    expect(r.result).toBe("pass");
  });

  it("passes when a non-secret value is logged alongside an unrelated secret read", () => {
    const c = candidate(
      `export function h() {
        const apiKey = process.env.STRIPE_API_KEY;
        console.log("ready");
        return apiKey;
      }`,
      "h",
    );
    const r = taintToSink(c, params);
    expect(r.result).toBe("pass");
  });

  describe("cross-file analysis", () => {
    let dir: string;

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("fails on a forward leak through a cross-file helper", () => {
      dir = mkdtempSync(join(tmpdir(), "taint-fwd-"));
      writeFileSync(
        join(dir, "helper.ts"),
        `export function logIt(x: unknown) {
          console.log("debug:", x);
        }`,
      );
      writeFileSync(
        join(dir, "handler.ts"),
        `import { logIt } from "./helper.ts";
        export function h() {
          logIt(process.env.STRIPE_API_KEY);
        }`,
      );

      const project = new Project();
      project.addSourceFileAtPath(join(dir, "helper.ts"));
      const sf = project.addSourceFileAtPath(join(dir, "handler.ts"));
      const fn = sf.getFunctionOrThrow("h");
      const c: Candidate = { filePath: join(dir, "handler.ts"), fnName: "h", params: [], fn };

      const r = taintToSink(c, params);
      expect(r.result).toBe("fail");
      expect(r.detail).toContain("logIt");
    });

    it("fails on a backward leak when a tainted value is passed in from another file", () => {
      dir = mkdtempSync(join(tmpdir(), "taint-bwd-"));
      writeFileSync(
        join(dir, "helper.ts"),
        `export function logIt(value: unknown) {
          console.log("debug:", value);
        }`,
      );
      writeFileSync(
        join(dir, "handler.ts"),
        `import { logIt } from "./helper.ts";
        export function h() {
          logIt(process.env.STRIPE_API_KEY);
        }`,
      );

      const project = new Project();
      const handlerSf = project.addSourceFileAtPath(join(dir, "handler.ts"));
      const helperSf = project.addSourceFileAtPath(join(dir, "helper.ts"));
      void handlerSf;
      const fn = helperSf.getFunctionOrThrow("logIt");
      const c: Candidate = { filePath: join(dir, "helper.ts"), fnName: "logIt", params: ["value"], fn };

      const r = taintToSink(c, params);
      expect(r.result).toBe("fail");
      expect(r.detail).toContain("logIt");
    });

    it("passes when only a non-secret value crosses files", () => {
      dir = mkdtempSync(join(tmpdir(), "taint-ok-"));
      writeFileSync(
        join(dir, "helper.ts"),
        `export function logIt(value: unknown) {
          console.log("debug:", value);
        }`,
      );
      writeFileSync(
        join(dir, "handler.ts"),
        `import { logIt } from "./helper.ts";
        export function h() {
          logIt("handler called");
        }`,
      );

      const project = new Project();
      const handlerSf = project.addSourceFileAtPath(join(dir, "handler.ts"));
      const helperSf = project.addSourceFileAtPath(join(dir, "helper.ts"));
      void handlerSf;
      const fn = helperSf.getFunctionOrThrow("logIt");
      const c: Candidate = { filePath: join(dir, "helper.ts"), fnName: "logIt", params: ["value"], fn };

      const r = taintToSink(c, params);
      expect(r.result).toBe("pass");
    });
  });
});

// ── prisma-raw-injection rule (taint-to-sink) ────────────────────────────────

const PRISMA_PARAMS = {
  sources: [{ name: "request-input", pattern: "\\b(req|request)\\.(body|query|params|headers)\\b" }],
  sinkCalls: ["$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe"],
  maxHops: 2,
};

describe("prisma-raw-injection rule", () => {
  it("FAIL when req.body flows into $queryRaw", () => {
    const c = candidate(
      `export function h(req: any, prisma: any) {
        return prisma.$queryRaw(\`SELECT * FROM users WHERE id = \${req.body.id}\`);
      }`,
      "h",
    );
    expect(taintToSink(c, PRISMA_PARAMS).result).toBe("fail");
  });

  it("FAIL when req.query flows into $executeRawUnsafe", () => {
    const c = candidate(
      `export function h(req: any, prisma: any) {
        const q = req.query.search;
        return prisma.$executeRawUnsafe("SELECT * FROM posts WHERE title LIKE " + q);
      }`,
      "h",
    );
    expect(taintToSink(c, PRISMA_PARAMS).result).toBe("fail");
  });

  it("PASS when $queryRaw uses only a literal (safe tagged-template)", () => {
    const c = candidate(
      `export function h(id: number, prisma: any) {
        return prisma.$queryRaw\`SELECT * FROM users WHERE id = \${id}\`;
      }`,
      "h",
    );
    expect(taintToSink(c, PRISMA_PARAMS).result).toBe("pass");
  });
});

// ── open-redirect rule (taint-to-sink) ───────────────────────────────────────

const REDIRECT_PARAMS = {
  sources: [{ name: "request-input", pattern: "\\b(req|request)\\.(query|params|body|headers)\\b" }],
  sinkCalls: ["redirect", "setHeader"],
  maxHops: 2,
};

describe("open-redirect rule", () => {
  it("FAIL when req.query flows into res.redirect", () => {
    const c = candidate(
      `export function h(req: any, res: any) {
        res.redirect(req.query.returnUrl);
      }`,
      "h",
    );
    expect(taintToSink(c, REDIRECT_PARAMS).result).toBe("fail");
  });

  it("FAIL when req.params flows into redirect via variable", () => {
    const c = candidate(
      `export function h(req: any, res: any) {
        const dest = req.params.next;
        res.redirect(dest);
      }`,
      "h",
    );
    expect(taintToSink(c, REDIRECT_PARAMS).result).toBe("fail");
  });

  it("PASS when redirect destination is a literal", () => {
    const c = candidate(
      `export function h(req: any, res: any) {
        res.redirect("/dashboard");
      }`,
      "h",
    );
    expect(taintToSink(c, REDIRECT_PARAMS).result).toBe("pass");
  });
});

// ── jsonwebtoken-algorithm-pinned rule (required-call-with-options) ───────────

const JWT_ALGO_PARAMS = {
  verifyCalls: ["verify"],
  decodeCalls: ["decode"],
  requiredProps: [["algorithms"]],
  passDetail: "algorithms pinned",
  missingPropsDetail: "algorithms missing — algorithm confusion risk",
  decodeOnlyDetail: "decode-only, no signature verification",
};

describe("jsonwebtoken-algorithm-pinned rule", () => {
  it("PASS when jwt.verify includes algorithms option", () => {
    const c = candidate(
      `import jwt from "jsonwebtoken";
       export function verifyJwt(token: string, secret: string) {
         return jwt.verify(token, secret, { algorithms: ["HS256"] });
       }`,
      "verifyJwt",
    );
    expect(requiredCallWithOptions(c, JWT_ALGO_PARAMS).result).toBe("pass");
  });

  it("FAIL when jwt.verify has no algorithms option", () => {
    const c = candidate(
      `import jwt from "jsonwebtoken";
       export function verifyJwt(token: string, secret: string) {
         return jwt.verify(token, secret);
       }`,
      "verifyJwt",
    );
    const r = requiredCallWithOptions(c, JWT_ALGO_PARAMS);
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("algorithms");
  });

  it("FAIL when only jwt.decode is used (no signature verification)", () => {
    const c = candidate(
      `import jwt from "jsonwebtoken";
       export function verifyJwt(token: string) {
         return jwt.decode(token);
       }`,
      "verifyJwt",
    );
    expect(requiredCallWithOptions(c, JWT_ALGO_PARAMS).result).toBe("fail");
  });
});
