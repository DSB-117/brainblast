// Phase 1 — Solana-native component identification.
//
// The web2 "Component" already in the report schema asks "what SDK + version."
// On Solana that's not enough: the things you actually invoke are deployed
// programs identified by a 32-byte address, owned by a loader that may grant
// some other key the right to overwrite them. A trust graph names those keys
// and the artifacts (verified builds, audits, parity notes) that ground trust
// in evidence rather than reputation.

export type UpgradeAuthorityKind =
  | "renounced" // authority field is null → program is frozen forever
  | "single-key" // a single Ed25519 keypair holds upgrade rights
  | "multisig" // Squads / native multisig
  | "dao" // governance program (Realms, Jet) holds the authority
  | "unknown"; // we have an address but can't classify it

export type UpgradeAuthoritySource =
  | "directory" // came from the curated directory.yaml
  | "rpc" // probed live from a JSON-RPC at build time
  | "research"; // surfaced by the brainblast research skill

export interface UpgradeAuthority {
  kind: UpgradeAuthorityKind;
  address: string | null; // null only when kind="renounced"
  source: UpgradeAuthoritySource;
  // When this was last checked. Trust-graph entries grow stale: an authority
  // can change after we read it. The renderer should warn on entries older
  // than some threshold (e.g. 24h for RPC, never for renounced/directory).
  checkedAt?: string;
  // The program that OWNS the authority account — what lets us classify
  // single-key vs multisig vs DAO live (v0.7.4). System Program → single-key;
  // a known multisig program (Squads) → multisig; a governance program (SPL
  // Governance / Realms) → dao. Present only when the authority was classified
  // by reading its owner account; absent for directory/research entries.
  ownerProgram?: string;
}

export type VerifiedBuildState =
  // The on-chain bytecode matches a published source repo at a known commit.
  // The registry URL points to the verification record (e.g. OtterSec, Solana
  // verifiable-build registry).
  | { state: "verified"; registryUrl: string; commit?: string }
  // We checked and the program is not in any registry we trust.
  | { state: "unverified" }
  // We haven't checked yet — distinct from "unverified" on purpose.
  | { state: "unknown" };

export interface AuditRef {
  firm: string;
  date: string; // ISO date
  reportUrl: string;
  // Programs evolve; an audit is only valid for the bytecode that was
  // audited. If the audited commit ≠ current verified-build commit, the
  // renderer should downgrade the audit's weight in the report.
  auditedCommit?: string;
}

export interface ParityNote {
  // For each cluster, did we see this program deployed at the SAME address
  // with the SAME upgrade authority? "Mainnet-only" is a real failure mode
  // (we hit it with Bags) — devs test against devnet and ship into a void.
  mainnet: "present" | "absent" | "different" | "unknown";
  devnet: "present" | "absent" | "different" | "unknown";
  testnet?: "present" | "absent" | "different" | "unknown";
  notes?: string;
}

export interface OnChainProgram {
  // The 32-byte program address, base58. This is the program's identity.
  programId: string;
  // Human label (e.g. "SPL Token-2022"). Free text.
  name: string;
  // Short kind tag for the renderer ("token", "metadata", "amm", "loader",
  // "app"). Used for grouping, not for any safety decision.
  kind?: string;
  upgradeAuthority: UpgradeAuthority;
  verifiedBuild: VerifiedBuildState;
  audits: AuditRef[];
  parity: ParityNote;
  // CPI/composability edges. Each entry is another program this one is known
  // to invoke. Phase 1 ships the shape; populating from IDLs is Phase 2.
  invokes?: string[]; // programIds
  // Where the metadata came from, surfaced so a reader can audit our claims.
  provenance?: {
    directoryFile?: string;
    rpcUrl?: string;
    researchRun?: string;
    notes?: string;
  };
}

// The full graph returned by buildTrustGraph: every program we examined, in
// dependency order if we can compute it (roots first, leaves last), with any
// programs we *couldn't* resolve named explicitly rather than silently dropped.
export interface TrustGraph {
  programs: OnChainProgram[];
  unresolved: Array<{ programId: string; reason: string }>;
  generatedAt: string;
}
