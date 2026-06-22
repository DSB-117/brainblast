// Keyguard — the pure secret classifier.
//
// Detection is by CONTENT, not filename: a renamed `id.json` is still a keypair,
// and a `notes.txt` holding a seed phrase is still catastrophic. No filesystem
// access lives here, so every branch is unit-testable from a string.

import { base58Decode, base58Encode } from "../trustGraph/base58.ts";
import type { Confidence, RawDetection, SecretKind } from "./types.ts";

// A Solana keypair file is a JSON array of bytes. solana-keygen writes 64 (the
// 32-byte secret scalar followed by the 32-byte public key); some tools write a
// bare 32-byte secret/seed.
function asByteArray(text: string): number[] | null {
  const t = text.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  if (!parsed.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255)) {
    return null;
  }
  return parsed as number[];
}

// Heuristic BIP39 check. We deliberately do not (yet) bundle the 2048-word list,
// so this stays MEDIUM confidence: 12 or 24 lowercase alphabetic words, each a
// plausible mnemonic length. Callers gate it to whole-file or secret-named-value
// context to keep false positives near zero. (Bundling the wordlist to promote
// this to HIGH confidence is a tracked follow-up.)
function looksLikeMnemonic(text: string): boolean {
  const words = text.trim().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) return false;
  return words.every((w) => /^[a-z]{3,8}$/.test(w));
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

function isBase58SecretKey(value: string): boolean {
  if (!BASE58_RE.test(value)) return false;
  try {
    return base58Decode(value).length === 64;
  } catch {
    return false;
  }
}

// Obvious non-secrets that show up next to secret-shaped env keys.
const PLACEHOLDER_RE = /^(|<.*>|\$\{.*\}|x{3,}|\.{3,}|change[-_ ]?me|your[-_ ].*|todo|placeholder|none|null|undefined|example)$/i;

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function detectionFromBytes(bytes: number[]): RawDetection | null {
  if (bytes.length === 64) {
    let pubkey: string | undefined;
    try {
      pubkey = base58Encode(Uint8Array.from(bytes.slice(32)));
    } catch {
      pubkey = undefined;
    }
    return {
      kind: "solana-keypair-64",
      confidence: "high",
      reason: "64-byte ed25519 keypair array — the solana-keygen file format.",
      pubkey,
    };
  }
  if (bytes.length === 32) {
    return {
      kind: "solana-secret-32",
      confidence: "medium",
      reason: "32-byte array — likely a Solana secret key or seed (pubkey not derivable offline).",
    };
  }
  return null;
}

// Classify a single value (an env assignment's RHS, or a quoted string). Returns
// null when the value isn't secret-shaped. Exported so scan.ts and tests reuse it.
export function classifySecretValue(rawValue: string): RawDetection | null {
  const value = unquote(rawValue);
  if (!value || PLACEHOLDER_RE.test(value)) return null;

  const bytes = asByteArray(value);
  if (bytes) return detectionFromBytes(bytes);

  if (isBase58SecretKey(value)) {
    let pubkey: string | undefined;
    try {
      pubkey = base58Encode(base58Decode(value).slice(32)); // last 32 bytes = pubkey
    } catch {
      pubkey = undefined;
    }
    return {
      kind: "base58-secret-key",
      confidence: "high",
      reason: "Base58 string that decodes to a 64-byte ed25519 secret key.",
      pubkey,
    };
  }

  if (looksLikeMnemonic(value)) {
    return {
      kind: "bip39-mnemonic",
      confidence: "medium",
      reason: "Looks like a 12/24-word BIP39 seed phrase — verify before trusting.",
    };
  }

  return null;
}

// Env var names whose VALUE we should treat as a real secret even if its shape is
// unfamiliar (e.g. a custom encoding). The name alone is a strong signal.
const SECRET_NAME_RE = /(PRIVATE_?KEY|SECRET_?KEY|KEYPAIR|MNEMONIC|SEED_?PHRASE|WALLET_?KEY|SOLANA_?KEY)/i;
// Names that reference a keypair *file path* rather than inlining the secret.
const PATH_NAME_RE = /(ANCHOR_WALLET|KEYPAIR_?PATH|WALLET_?PATH|KEY_?PATH)/i;

function detectEnvSecrets(content: string): RawDetection[] {
  const out: RawDetection[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const name = m[1];
    const value = m[2];

    // A value that is itself secret-shaped (inline key/phrase).
    const valueDetection = classifySecretValue(value);
    if (valueDetection) {
      out.push({ ...valueDetection, line: i + 1, match: name });
      continue;
    }

    // A path reference to a keypair file (the secret lives elsewhere, but losing
    // the pointer + the file is still worth surfacing).
    const v = unquote(value);
    if (PATH_NAME_RE.test(name) && /\.json('|")?$/.test(v)) {
      out.push({
        kind: "keypair-path-ref",
        confidence: "medium",
        reason: `${name} points at a keypair file (${v}).`,
        line: i + 1,
        match: name,
      });
      continue;
    }

    // A secret-NAMED variable with a non-placeholder value we couldn't shape-match.
    if (SECRET_NAME_RE.test(name) && !PLACEHOLDER_RE.test(unquote(value))) {
      out.push({
        kind: "env-private-key",
        confidence: "low",
        reason: `${name} is named like a private key and holds a non-placeholder value.`,
        line: i + 1,
        match: name,
      });
    }
  }
  return out;
}

// Main entry: every secret detectable in a single file's content.
//
// Order matters: a whole-file keypair/mnemonic is the strongest signal, so we try
// those first and only fall back to line-by-line env scanning for structured
// config files.
export function detectFileSecrets(content: string): RawDetection[] {
  // Whole-file Solana keypair (id.json, *-keypair.json, …).
  const wholeBytes = asByteArray(content);
  if (wholeBytes) {
    const d = detectionFromBytes(wholeBytes);
    return d ? [d] : [];
  }

  // Whole-file seed phrase (a notes file that is *only* a mnemonic).
  if (looksLikeMnemonic(content)) {
    return [
      {
        kind: "bip39-mnemonic",
        confidence: "medium",
        reason: "File contents are a 12/24-word BIP39-style seed phrase.",
      },
    ];
  }

  // Otherwise scan for env/config-style secret assignments.
  return detectEnvSecrets(content);
}

// Exposed for reuse/testing.
export const _internals = { asByteArray, looksLikeMnemonic, isBase58SecretKey };
export type { SecretKind, Confidence };
