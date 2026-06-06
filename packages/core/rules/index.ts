import { stripeWebhookRawBody } from "./stripe-webhook-raw-body.ts";
import { privyJwtVerification } from "./privy-jwt-verification.ts";
import type { Rule } from "../src/types.ts";

// The bundled rule pack. The LLM researcher authors more of these as facts;
// the CLI ships them. Today: the two traps proven by the T1/T2 spikes.
export const rules: Rule[] = [stripeWebhookRawBody, privyJwtVerification];
