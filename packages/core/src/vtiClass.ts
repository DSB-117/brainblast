// Trap taxonomy for Verified Trap Instances — the `class` field buyers filter on
// and the coverage heatmap (Stage 3) is built from. Single source of truth shared
// by the seed generator (scripts/gen-vti.ts) and the contributor ingest pipeline
// (src/contrib/ingest.ts) so the taxonomy can never drift between the two.

import type { Rule } from "./types.ts";

export type TrapClass =
  | "silent-zero-revenue"
  | "immutable-after-deploy"
  | "unchecked-staleness"
  | "auth-bypass"
  | "wrong-constant"
  | "unconfirmed-state"
  | "missing-slippage-guard"
  | "missing-verification"
  | "other";

export const TRAP_CLASSES: readonly TrapClass[] = [
  "silent-zero-revenue",
  "immutable-after-deploy",
  "unchecked-staleness",
  "auth-bypass",
  "wrong-constant",
  "unconfirmed-state",
  "missing-slippage-guard",
  "missing-verification",
  "other",
];

// Explicit per-rule mapping for the bundled packs; the keyword fallback keeps
// future / contributed packs classified.
export const CLASS_BY_RULE: Record<string, TrapClass> = {
  "jito-bundle-zero-tip": "unconfirmed-state",
  "jupiter-quote-zero-slippage": "missing-slippage-guard",
  "metaplex-nft-royalty-zero": "silent-zero-revenue",
  "meteora-dlmm-zero-min-out": "missing-slippage-guard",
  "pyth-price-unchecked-staleness": "unchecked-staleness",
  "raydium-compute-zero-slippage": "missing-slippage-guard",
  "solana-sendtx-unconfirmed": "unconfirmed-state",
  "spl-transfer-not-checked-in-payout": "missing-verification",
  // Fleet-sourced (R7) — explicit so the keyword heuristic can't mis-bucket them
  // (e.g. "expiration" would otherwise read as unchecked-staleness).
  "jwt-verify-ignore-expiration": "auth-bypass",
  "cors-wildcard-origin": "auth-bypass",
  "https-reject-unauthorized-disabled": "auth-bypass",
  "jwt-verify-algorithm-none": "auth-bypass",
  "metaplex-ismutable-false-locks-metadata": "immutable-after-deploy",
  "express-session-saveuninitialized-true": "auth-bypass",
  "jwt-sign-algorithm-none": "auth-bypass",
  "cors-credentials-reflect-origin-true": "auth-bypass",
  "cookie-session-secure-false": "auth-bypass",
  "mongoose-tls-allow-invalid-certificates": "missing-verification",
  "solana-send-skip-preflight-true": "unconfirmed-state",
  "helmet-hsts-maxage-zero": "auth-bypass",
  "jwt-sign-allow-insecure-key-sizes-true": "auth-bypass",
  "res-cookie-httponly-false": "auth-bypass",
  "express-jwt-credentials-not-required": "auth-bypass",
  "puppeteer-ignore-https-errors-true": "missing-verification",
  "playwright-ignore-https-errors-true": "missing-verification",
  "stripe-connect-zero-application-fee": "silent-zero-revenue",
  "cookie-session-httponly-false": "auth-bypass",
  "aws-s3-public-read-acl": "auth-bypass",
  "passport-jwt-ignore-expiration": "auth-bypass",
  "https-agent-reject-unauthorized-false": "auth-bypass",
  "jose-sign-alg-none": "auth-bypass",
  "mongodb-client-tls-allow-invalid-certificates": "missing-verification",
  "ws-reject-unauthorized-false": "auth-bypass",
  "helmet-csp-disabled": "auth-bypass",
  "helmet-frameguard-disabled": "auth-bypass",
  "express-rate-limit-max-zero": "auth-bypass",
  "pg-pool-ssl-reject-unauthorized-false": "missing-verification",
  "nodemailer-tls-reject-unauthorized-false": "missing-verification",
  "mysql2-ssl-reject-unauthorized-false": "missing-verification",
  "ioredis-tls-reject-unauthorized-false": "missing-verification",
  "kafkajs-ssl-reject-unauthorized-false": "missing-verification",
  "express-session-cookie-secure-false": "auth-bypass",
  "mssql-trust-server-certificate-true": "missing-verification",
  "solana-confirm-processed-commitment": "unconfirmed-state",
  // Fleet-sourced (#50 run) — the keyword heuristic reads "auth"/"jwt"/"pkce" as
  // auth-bypass, but these are verification-step omissions and a silently-ignored
  // config flag, so pin them explicitly.
  "jwt-expressjwt-ignore-notbefore": "missing-verification",
  "stripe-betterauth-oidc-require-pkce-false": "missing-verification",
  "stripe-betterauth-oidc-allow-plain-pkce": "missing-verification",
  "jwt-node-react-ecom-mongoose-dropdups": "other",
  "solana-hive-sendtransaction-skippreflight": "unconfirmed-state",
  "solana-backpack-sendrawtransaction-skippreflight": "unconfirmed-state",
  "solana-quiknode-sendandconfirm-skippreflight": "unconfirmed-state",
  // Non-blockchain SDK breadth run — TLS bypass, cookie/session flags, CORS,
  // security headers, XXE, path traversal across HTTP clients, DBs/ORMs, caches,
  // message queues, and web frameworks.
  "got-https-reject-unauthorized-false": "missing-verification",
  "ldapjs-tls-reject-unauthorized-false": "missing-verification",
  "elasticsearch-tls-reject-unauthorized-false": "missing-verification",
  "aws-s3-v3-public-read-acl": "auth-bypass",
  "apollo-server-csrf-prevention-false": "auth-bypass",
  "socketio-cors-wildcard-origin": "auth-bypass",
  "iron-session-cookie-secure-false": "auth-bypass",
  "cookie-serialize-httponly-false": "auth-bypass",
  "fastify-cors-wildcard-origin": "auth-bypass",
  "libxmljs-noent-true": "other",
  "mqtt-reject-unauthorized-false": "missing-verification",
  "sequelize-dialectoptions-ssl-reject-unauthorized-false": "missing-verification",
  "knex-connection-ssl-reject-unauthorized-false": "missing-verification",
  "helmet-nosniff-disabled": "auth-bypass",
  "express-session-cookie-samesite-none": "auth-bypass",
  "undici-connect-reject-unauthorized-false": "missing-verification",
  "typeorm-ssl-reject-unauthorized-false": "missing-verification",
  "cassandra-ssloptions-reject-unauthorized-false": "missing-verification",
  "tedious-trust-server-certificate-true": "missing-verification",
  "express-fileupload-safe-file-names-false": "other",
  "amqplib-reject-unauthorized-false": "missing-verification",
  "redis-socket-reject-unauthorized-false": "missing-verification",
  "nats-tls-reject-unauthorized-false": "missing-verification",
  "helmet-hsts-disabled": "auth-bypass",
  "koa-session-secure-false": "auth-bypass",
  // Behavioral (differential-io) — proven by golden I/O, no static shape.
  "slippage-bps-wrong-divisor": "missing-slippage-guard",
  "token-decimals-off-by-one-scale": "wrong-constant",
  "bigint-lamports-precision-loss": "other",
  "payout-split-drops-remainder": "other",
};

export function classifyTrap(rule: Rule): TrapClass {
  if (CLASS_BY_RULE[rule.id]) return CLASS_BY_RULE[rule.id];
  const hay = `${rule.id} ${rule.title}`.toLowerCase();
  if (/royalt|fee|revenue|reward/.test(hay) && /zero|missing|0\b/.test(hay)) return "silent-zero-revenue";
  if (/immutable|after (deploy|mint)|cannot be changed/.test(hay)) return "immutable-after-deploy";
  if (/stale|freshness|expir/.test(hay)) return "unchecked-staleness";
  if (/slippage|min.?out|amount.?out/.test(hay)) return "missing-slippage-guard";
  if (/auth|jwt|verif|signature/.test(hay)) return "auth-bypass";
  if (/confirm|land|finali/.test(hay)) return "unconfirmed-state";
  if (/constant|lamports_per_sol|decimals|scal/.test(hay)) return "wrong-constant";
  return "other";
}
