// HiveMind identity — who a hive is, across machines.
//
// An identity is an ed25519 keypair (the same seed(32)‖pub(32) base58 shape as
// the marketplace distributor and the agent wallet): the base58 public key IS
// the hive's address. It exists so federated experience events are ATTRIBUTABLE
// — a batch is signed by its author, so holding a space id lets you read and
// contribute, but never impersonate another member. No accounts, no server-side
// registration: the keypair is generated locally and only the address travels.

import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base58Encode } from "../base58.ts";

export interface HiveIdentity {
  schemaVersion: "1.0";
  address: string; // base58 ed25519 public key — the hive's public name
  secretKey: string; // base58 seed(32)‖pub(32) — never leaves this machine
  createdAt: string;
}

export function identityPath(root: string): string {
  return join(root, "identity.json");
}

export function loadIdentity(root: string): HiveIdentity | null {
  const p = identityPath(root);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    if (typeof parsed?.address === "string" && typeof parsed?.secretKey === "string") return parsed as HiveIdentity;
  } catch {
    // fall through — a corrupt identity is reported as absent, never thrown
  }
  return null;
}

export function loadOrCreateIdentity(root: string, now: string = new Date().toISOString()): HiveIdentity {
  const existing = loadIdentity(root);
  if (existing) return existing;
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string };
  const seed = Buffer.from(jwk.d, "base64url");
  const pub = Buffer.from(jwk.x, "base64url");
  const identity: HiveIdentity = {
    schemaVersion: "1.0",
    address: base58Encode(pub),
    secretKey: base58Encode(Buffer.concat([seed, pub])),
    createdAt: now,
  };
  mkdirSync(root, { recursive: true });
  writeFileSync(identityPath(root), JSON.stringify(identity, null, 2), { mode: 0o600 });
  return identity;
}
