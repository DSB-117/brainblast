import { describe, it, expect } from "vitest";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { findCandidates } from "../src/finder.ts";
import { rules } from "../rules/index.ts";

const stripeWebhookRawBody = rules.find((r) => r.id === "stripe-webhook-raw-body-verification")!;
const privyJwtVerification = rules.find((r) => r.id === "privy-jwt-verification")!;

const here = dirname(fileURLToPath(import.meta.url));
const fx = (p: string) => resolve(here, "..", "fixtures", p);

describe("findCandidates", () => {
  it("finds the Stripe webhook handler in the vulnerable fixture", () => {
    const cs = findCandidates(fx("stripe/vulnerable"), stripeWebhookRawBody);
    expect(cs.length).toBe(1);
    expect(cs[0].fnName).toBe("handleStripeWebhook");
    expect(cs[0].params[0]).toBe("rawBody");
  });

  it("does NOT match the Stripe rule against JWT code (no cross-detection)", () => {
    expect(findCandidates(fx("jwt/vulnerable"), stripeWebhookRawBody).length).toBe(0);
  });

  it("does NOT match the Privy rule against Stripe code", () => {
    expect(findCandidates(fx("stripe/fixed"), privyJwtVerification).length).toBe(0);
  });

  it("returns nothing for an unrelated file", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-find-"));
    writeFileSync(join(d, "util.ts"), "export function add(a: number, b: number) { return a + b; }");
    expect(findCandidates(d, stripeWebhookRawBody).length).toBe(0);
  });
});
