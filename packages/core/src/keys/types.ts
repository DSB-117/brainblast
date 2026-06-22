// Keyguard (v0.8.0) — shared types for irreplaceable-secret detection.
//
// The mission: find every file an AI agent could delete that you can NEVER get
// back — Solana keypairs, upgrade-authority keys, seed phrases, private keys in
// .env — and rank each by what you actually lose (the "blast radius").

export type SecretKind =
  | "solana-keypair-64" // JSON array of 64 ints — the solana-keygen format
  | "solana-secret-32" // JSON array of 32 ints — a bare secret/seed
  | "base58-secret-key" // a 64-byte ed25519 key, base58-encoded
  | "bip39-mnemonic" // a 12/24-word seed phrase
  | "keypair-path-ref" // a config value pointing at a keypair file
  | "env-private-key"; // a secret-named env assignment with a real value

export type Confidence = "high" | "medium" | "low";

// Offline best-guess of "what do you lose if this is destroyed". The on-chain
// enrichment step (resolving whether a keypair is a live upgrade authority or
// holds funds) refines `funds`/`unknown` up to `terminal` or down to `trivial`.
export type BlastTier =
  | "terminal" // sole upgrade authority of a live program → bricked forever
  | "funds" // holds SOL/tokens, or an unscoped private key → assume funds
  | "rebuildable" // recreatable without permanent loss (e.g. post-deploy program key)
  | "trivial" // test/fixture material, no real-world footprint
  | "unknown"; // detected, blast radius not yet resolved

// A raw, fs-free detection produced by the pure classifier in detect.ts.
export interface RawDetection {
  kind: SecretKind;
  confidence: Confidence;
  reason: string; // human-readable "why we think this is a secret"
  pubkey?: string; // derivable offline for 64-byte keypairs (last 32 bytes)
  line?: number; // 1-based line for env-style detections
  match?: string; // the env var name, when applicable — never the secret value
}

// A detection located on disk, with recovery/leak context filled in by scan.ts.
export interface DetectedSecret extends RawDetection {
  path: string; // absolute path on disk
  rel: string; // path relative to the scan root, for display
  tier: BlastTier;
  needsOnchainCheck: boolean; // true until the chain confirms the blast radius
  gitTracked?: boolean; // committed → leak risk (the inverse accident)
  gitIgnored?: boolean; // gitignored → git CANNOT restore it if deleted
  vaulted?: boolean; // backed up by the Vault (filled in once the Vault ships)
  external?: boolean; // lives outside the scanned project tree (e.g. ~/.config/solana)
  inGitRepo?: boolean; // the scan root is a git work tree (so git context is meaningful)
}

export interface KeysSummary {
  terminal: number;
  funds: number;
  rebuildable: number;
  trivial: number;
  unknown: number;
  tracked: number; // accidentally git-committed (leak)
  recoverable: number; // safe in git or the Vault
  unrecoverable: number; // gitignored AND not vaulted — one rm from gone forever
}

export interface KeysReport {
  root: string;
  secrets: DetectedSecret[];
  summary: KeysSummary;
  // ok = nothing irreplaceable at risk · warn = exposed/unbacked secrets ·
  // exposed = a high-tier secret is git-tracked or unrecoverable.
  verdict: "ok" | "warn" | "exposed";
}
