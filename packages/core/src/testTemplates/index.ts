import { stripeWebhookSignature } from "./stripeWebhookSignature.ts";
import { privyJwtClaims } from "./privyJwtClaims.ts";
import { bagsFeeShare } from "./bagsFeeShare.ts";
import { tokenProgramConsistency } from "./tokenProgramConsistency.ts";
import { metaplexImmutableMetadata } from "./metaplexImmutableMetadata.ts";
import { anchorProgramTest } from "./anchorProgramTest.ts";
import { none } from "./none.ts";
import type { TestTemplate } from "../types.ts";

// Registry of human-vetted behavioral-contract templates. Rules bind by `kind`.
const registry: Record<string, TestTemplate> = {
  "stripe-webhook-signature": stripeWebhookSignature,
  "privy-jwt-claims": privyJwtClaims,
  "bags-fee-share": bagsFeeShare,
  "token-program-consistency": tokenProgramConsistency,
  "metaplex-immutable-metadata": metaplexImmutableMetadata,
  "anchor-program-test": anchorProgramTest,
  none,
};

// Defense-in-depth: the export name is interpolated raw into generated TS source.
// Today it always comes from ts-morph (a parser-bound identifier), but guard it
// so a future detection path can never inject code via a non-identifier name.
const JS_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function renderTest(
  kind: string,
  opts: { handlerImportPath: string; handlerExport: string; params?: any },
): string {
  const tpl = registry[kind];
  if (!tpl) throw new Error(`Unknown test template kind '${kind}'.`);
  if (!JS_IDENTIFIER.test(opts.handlerExport)) {
    throw new Error(`Unsafe handler export name '${opts.handlerExport}' (not a JS identifier).`);
  }
  return tpl(opts);
}

export const testKinds = Object.keys(registry);
