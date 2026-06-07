import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { positionalArgIdentity } from "../src/checkers/positionalArgIdentity.ts";
import { requiredCallWithOptions } from "../src/checkers/requiredCallWithOptions.ts";
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
