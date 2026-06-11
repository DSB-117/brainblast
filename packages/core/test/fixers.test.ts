import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { fixPositionalArgIdentity } from "../src/fixers/positionalArgIdentity.ts";
import { fixRequiredCallWithOptions } from "../src/fixers/requiredCallWithOptions.ts";
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

const PRIVY = {
  verifyCalls: ["jwtVerify", "verify"],
  decodeCalls: ["decodeJwt", "decode"],
  requiredProps: [
    ["audience", "aud"],
    ["issuer", "iss"],
  ],
  passDetail: "ok",
  missingPropsDetail: "missing aud/iss",
  decodeOnlyDetail: "decode only",
};

describe("fixPositionalArgIdentity (Stripe rule template)", () => {
  it("produces a diff swapping a parsed value for the raw param", () => {
    const c = candidate(
      `import Stripe from "stripe"; const s = new Stripe("x");
       export function h(rawBody: string, sig: string) {
         return s.webhooks.constructEvent(JSON.parse(rawBody), sig, "sec");
       }`,
      "h",
    );
    const fix = fixPositionalArgIdentity(c, STRIPE, { result: "fail", detail: "parsed" });
    expect(fix?.diff).toBeTruthy();
    expect(fix?.diff).toContain("-         return s.webhooks.constructEvent(JSON.parse(rawBody), sig, \"sec\");");
    expect(fix?.diff).toContain("+         return s.webhooks.constructEvent(rawBody, sig, \"sec\");");
  });

  it("returns guidance only when constructEvent is absent", () => {
    const c = candidate(`export function h(rawBody: string) { return JSON.parse(rawBody); }`, "h");
    const fix = fixPositionalArgIdentity(c, STRIPE, { result: "fail", detail: "absent" });
    expect(fix?.diff).toBeUndefined();
    expect(fix?.suggestion).toContain("rawBody");
    expect(fix?.suggestion).toContain("constructEvent");
  });

  it("returns undefined for a non-fail outcome", () => {
    const c = candidate(`export function h(rawBody: string) { return JSON.parse(rawBody); }`, "h");
    expect(fixPositionalArgIdentity(c, STRIPE, { result: "pass", detail: "ok" })).toBeUndefined();
  });
});

describe("fixRequiredCallWithOptions (Privy rule template)", () => {
  it("merges audience/issuer into an existing options object", () => {
    const c = candidate(
      `import { jwtVerify } from "jose";
       export async function verifyPrivyToken(token: string) {
         const { payload } = await jwtVerify(token, JWKS, { algorithms: ["RS256"] });
         return payload;
       }`,
      "verifyPrivyToken",
    );
    const fix = fixRequiredCallWithOptions(c, PRIVY, { result: "fail", detail: "missing aud/iss" });
    expect(fix?.diff).toBeTruthy();
    expect(fix?.diff).toContain("audience: process.env.PRIVY_APP_ID");
    expect(fix?.diff).toContain("issuer: \"https://privy.io\"");
    expect(fix?.diff).toContain("algorithms");
  });

  it("appends a new options object when none exists", () => {
    const c = candidate(
      `import { jwtVerify } from "jose";
       export async function verifyPrivyToken(token: string) {
         const { payload } = await jwtVerify(token, JWKS);
         return payload;
       }`,
      "verifyPrivyToken",
    );
    const fix = fixRequiredCallWithOptions(c, PRIVY, { result: "fail", detail: "missing aud/iss" });
    expect(fix?.diff).toBeTruthy();
    expect(fix?.diff).toContain("jwtVerify(token, JWKS, { audience: process.env.PRIVY_APP_ID, issuer: \"https://privy.io\" })");
  });

  it("returns guidance only for decode-only findings", () => {
    const c = candidate(
      `import { decodeJwt } from "jose";
       export function verifyPrivyToken(token: string) {
         return decodeJwt(token);
       }`,
      "verifyPrivyToken",
    );
    const fix = fixRequiredCallWithOptions(c, PRIVY, { result: "fail", detail: "decode only" });
    expect(fix?.diff).toBeUndefined();
    expect(fix?.suggestion).toContain("jwtVerify");
  });
});
