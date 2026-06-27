// The Agent Wallet — a small, capped, Vault-recoverable ops wallet an AI agent
// can generate and operate itself, so it can hold/move $BRAIN/$USDC/$SOL with
// near-zero friction. See WALLET-PLAN.md for the full design and the one rule
// everything hangs on: this is a SACRIFICIAL capped wallet, never the owner's
// principal. The caps + recipient allowlist (Signguard) — not the at-rest
// encryption — are what bound a compromised agent.
//
// P0 scope (this file): the key lifecycle — generate, store the secret ONLY in
// the encrypted Vault, recover it to memory by pubkey, and track the active
// wallet in a non-secret manifest. No network. A Solana secret key is just an
// ed25519 seed(32)‖pubkey(32) — the `solana-keypair-64` format Keyguard already
// models — so we generate it with node:crypto and add no new dependency here.

import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { backupBytes, readLatestByPubkey, listEntries } from "../keys/vault.ts";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// Encode-only base58 (Bitcoin alphabet) — enough to derive a Solana address from
// a public key. Vendored (rather than a dependency) to keep this security path's
// footprint minimal and auditable.
export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return out;
}

export type WalletTier = "local" | "delegated";

export interface WalletRecord {
  pubkey: string; // base58 Solana address — safe to share, for funding
  createdAt: string;
  label?: string;
  tier: WalletTier;
}

interface WalletManifest {
  version: string;
  active?: string; // pubkey of the active wallet
  wallets: WalletRecord[];
}

// A freshly generated keypair. `secretKeyArray` is the 64-int `solana-keypair-64`
// form — identical to a `solana-keygen` id.json — so the owner can re-import it
// into the Solana CLI directly. Surfaced to the caller ONCE; never persisted in
// plaintext (only the encrypted Vault copy survives).
export interface GeneratedWallet {
  pubkey: string;
  secretKeyArray: number[];
}

export function walletManifestPath(): string {
  return process.env.BRAINBLAST_WALLET_FILE
    ? resolve(process.env.BRAINBLAST_WALLET_FILE)
    : join(homedir(), ".brainblast", "wallet.json");
}

function loadManifest(): WalletManifest {
  const p = walletManifestPath();
  if (!existsSync(p)) return { version: "1", wallets: [] };
  try {
    const m = JSON.parse(readFileSync(p, "utf8")) as WalletManifest;
    return { version: m.version ?? "1", active: m.active, wallets: m.wallets ?? [] };
  } catch {
    return { version: "1", wallets: [] };
  }
}

function saveManifest(m: WalletManifest): void {
  const p = walletManifestPath();
  mkdirSync(dirname(p), { recursive: true });
  // 0600: the manifest holds no secrets, but it pins the active pubkey — keep it
  // owner-only by default, consistent with the rest of ~/.brainblast.
  writeFileSync(p, JSON.stringify(m, null, 2) + "\n", { mode: 0o600 });
}

// Generate an ed25519 keypair in Solana's secret-key format. node:crypto's `d`
// (jwk) is the 32-byte seed; `x` is the 32-byte public key; the secret key is
// their concatenation (verified byte-identical to @solana/web3.js Keypair).
export function generateKeypair(): GeneratedWallet {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string };
  const seed = Buffer.from(jwk.d, "base64url");
  const pub = Buffer.from(jwk.x, "base64url");
  if (seed.length !== 32 || pub.length !== 32) {
    throw new Error("agent-wallet: unexpected ed25519 key sizes");
  }
  const secret64 = Buffer.concat([seed, pub]);
  return { pubkey: base58Encode(pub), secretKeyArray: Array.from(secret64) };
}

// The bytes we store in the Vault: the JSON int-array text — so a `vault restore`
// yields a valid solana-keygen id.json the owner can use directly.
function secretToVaultBytes(secretKeyArray: number[]): Buffer {
  return Buffer.from(JSON.stringify(secretKeyArray), "utf8");
}

// Generate a wallet, encrypt its secret straight into the Vault (never a
// plaintext file), and record it as active in the manifest. Returns the secret
// ONCE for the caller to surface to the human for their own backup.
export function createWallet(opts: { label?: string; tier?: WalletTier } = {}): GeneratedWallet {
  const gen = generateKeypair();
  backupBytes(secretToVaultBytes(gen.secretKeyArray), `agent-wallet:${gen.pubkey}`, {
    pubkey: gen.pubkey,
    kind: "solana-keypair-64",
    tier: "funds",
  });
  const m = loadManifest();
  m.wallets = m.wallets.filter((w) => w.pubkey !== gen.pubkey);
  m.wallets.push({
    pubkey: gen.pubkey,
    createdAt: new Date().toISOString(),
    label: opts.label,
    tier: opts.tier ?? "local",
  });
  m.active = gen.pubkey;
  saveManifest(m);
  return gen;
}

export function getActiveWallet(): WalletRecord | undefined {
  const m = loadManifest();
  if (!m.active) return undefined;
  return m.wallets.find((w) => w.pubkey === m.active);
}

export function listWallets(): WalletRecord[] {
  return loadManifest().wallets.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function setActiveWallet(pubkey: string): void {
  const m = loadManifest();
  if (!m.wallets.some((w) => w.pubkey === pubkey)) {
    throw new Error(`agent-wallet: ${pubkey} is not a known wallet`);
  }
  m.active = pubkey;
  saveManifest(m);
}

// Reconstruct a wallet's 64-byte secret key from the Vault, in memory only — the
// plaintext never touches disk. Throws if the pubkey isn't recoverable (the
// signal that the Vault was lost and the wallet must be treated as gone).
export function loadSecretKey(pubkey: string): Uint8Array {
  const bytes = readLatestByPubkey(pubkey);
  const arr = JSON.parse(bytes.toString("utf8")) as number[];
  if (!Array.isArray(arr) || arr.length !== 64) {
    throw new Error(`agent-wallet: vaulted secret for ${pubkey} is malformed`);
  }
  return Uint8Array.from(arr);
}

// Is this wallet recoverable from the Vault right now? The honest "is my key
// safe" check — a wiped working tree is fine as long as the Vault has it.
export function isRecoverable(pubkey: string): boolean {
  return listEntries().some((e) => e.pubkey === pubkey && e.kind === "solana-keypair-64");
}

// Rotate the active wallet: generate a fresh key (the new active), returning the
// old + new so the caller can sweep old → new on-chain. The old wallet stays in
// the Vault and the manifest (recoverable) — rotation never destroys a key.
export function rotateWallet(opts: { label?: string } = {}): { oldPubkey: string; oldSecret: Uint8Array; newWallet: GeneratedWallet } {
  const prev = getActiveWallet();
  if (!prev) throw new Error("agent-wallet: no active wallet to rotate (run `wallet init`)");
  const oldSecret = loadSecretKey(prev.pubkey);
  const newWallet = createWallet({ label: opts.label ?? prev.label, tier: prev.tier });
  return { oldPubkey: prev.pubkey, oldSecret, newWallet };
}
