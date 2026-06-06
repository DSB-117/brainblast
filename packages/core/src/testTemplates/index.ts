import { stripeWebhookSignature } from "./stripeWebhookSignature.ts";
import { privyJwtClaims } from "./privyJwtClaims.ts";
import type { TestTemplate } from "../types.ts";

// Registry of human-vetted behavioral-contract templates. Rules bind by `kind`.
const registry: Record<string, TestTemplate> = {
  "stripe-webhook-signature": stripeWebhookSignature,
  "privy-jwt-claims": privyJwtClaims,
};

export function renderTest(
  kind: string,
  opts: { handlerImportPath: string; handlerExport: string; params?: any },
): string {
  const tpl = registry[kind];
  if (!tpl) throw new Error(`Unknown test template kind '${kind}'.`);
  return tpl(opts);
}

export const testKinds = Object.keys(registry);
