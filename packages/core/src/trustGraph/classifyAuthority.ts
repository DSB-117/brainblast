import { getAccountInfo, type RpcOpts } from "./rpc.ts";
import type { UpgradeAuthority, UpgradeAuthorityKind } from "./types.ts";

// ── Live upgrade-authority classification (v0.7.4) ────────────────────────────
//
// probeUpgradeAuthority() resolves the authority *address* but can only mark it
// "unknown" — single-key vs multisig vs DAO is not visible from the address.
// The answer IS on-chain, though: the authority account's *owner program* tells
// you what kind of key it is.
//
//   - Owned by the System Program  → a plain Ed25519 wallet  → single-key
//   - Owned by a known multisig    (Squads)                  → multisig
//   - Owned by a known governance  (SPL Governance / Realms) → dao
//   - Owned by something else                                → unknown (recorded)
//
// This is the question Solana devs answer by hand on Solscan ("who can upgrade
// this, and is it a multisig?"). One extra getAccountInfo turns the trust-graph
// "Unclassified authority" line into a real verdict.

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";

// Known owner programs → authority kind. Extend as new multisig/governance
// programs gain adoption; a wrong/missing id degrades to "unknown" (never a
// false "single-key"), so the System-Program path stays the only hard claim.
interface KnownOwner {
  kind: Exclude<UpgradeAuthorityKind, "renounced">;
  label: string;
}

export const KNOWN_AUTHORITY_OWNERS: Record<string, KnownOwner> = {
  // Squads — the dominant Solana multisig. v3 ("SMPL") and v4 program ids.
  // https://docs.squads.so/main/development/sdk/program-ids
  SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu: { kind: "multisig", label: "Squads v3" },
  SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf: { kind: "multisig", label: "Squads v4" },
  // SPL Governance (Realms) — the standard on-chain governance program.
  // https://github.com/solana-labs/solana-program-library/tree/master/governance
  GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw: { kind: "dao", label: "SPL Governance (Realms)" },
};

export interface AuthorityClassification {
  kind: UpgradeAuthorityKind;
  ownerProgram?: string;
  ownerLabel?: string;
}

// Classify a resolved authority address by reading its owner account.
// Returns kind "single-key" | "multisig" | "dao" | "unknown".
export async function classifyUpgradeAuthority(
  address: string,
  opts: RpcOpts = {},
): Promise<AuthorityClassification> {
  const acct = await getAccountInfo(address, opts);
  if (!acct) {
    // The authority address has no account on this cluster — can't classify.
    return { kind: "unknown" };
  }
  if (acct.owner === SYSTEM_PROGRAM) {
    return { kind: "single-key", ownerProgram: SYSTEM_PROGRAM };
  }
  const known = KNOWN_AUTHORITY_OWNERS[acct.owner];
  if (known) {
    return { kind: known.kind, ownerProgram: acct.owner, ownerLabel: known.label };
  }
  return { kind: "unknown", ownerProgram: acct.owner };
}

// Enrich an UpgradeAuthority in place by classifying its address. No-op unless
// the authority is currently "unknown" with a non-null address (i.e. it was
// resolved by an RPC probe but not yet classified). Renounced/directory/already
// -classified authorities pass through untouched.
export async function enrichAuthorityClassification(
  authority: UpgradeAuthority,
  opts: RpcOpts = {},
): Promise<UpgradeAuthority> {
  if (authority.kind !== "unknown" || !authority.address) return authority;
  const c = await classifyUpgradeAuthority(authority.address, opts);
  return {
    ...authority,
    kind: c.kind,
    ...(c.ownerProgram ? { ownerProgram: c.ownerProgram } : {}),
  };
}
