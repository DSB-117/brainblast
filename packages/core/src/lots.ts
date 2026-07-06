// Lot & package taxonomy for GRANT SCOPING.
//
// A grant's `lots` scope names the curated lots a buyer receives; the hosted feed
// filters delivery to exactly those names. Packages are named bundles that expand
// to their member lots AT ISSUE TIME, so the grant itself only ever carries lot
// names (the server never needs to know about packages).
//
// These lot NAMES must match the registry's lib/lots.ts keys (that's the classifier
// + pricing source of truth). Kept in sync by hand — the registry vendors data,
// not this module.

export const LOT_KEYS = [
  "solana",
  "evm",
  "auth-sessions",
  "transport-tls",
  "web-hardening",
  "cloud-storage",
  "crypto",
  "browser-desktop",
  "other",
] as const;
export type LotKey = (typeof LOT_KEYS)[number];

/** The lots a customer can buy à la carte ("other" ships only inside Scale). */
export const SELLABLE_LOTS: LotKey[] = LOT_KEYS.filter((l) => l !== "other");

/** Named bundles → their member lots. */
export const PACKAGES: Record<string, LotKey[]> = {
  web3: ["solana", "evm"],
  appsec: ["auth-sessions", "transport-tls", "web-hardening", "cloud-storage", "crypto", "browser-desktop"],
  scale: [...LOT_KEYS], // everything, including "other"
};

/**
 * Resolve a grant's lot scope from explicit `--lot` names plus any `--package`
 * bundles, expanded and de-duplicated. Throws on an unknown package name.
 */
export function expandLots(lots: string[], packages: string[]): string[] {
  const out = new Set<string>();
  for (const l of lots) out.add(l);
  for (const p of packages) {
    const members = PACKAGES[p.toLowerCase()];
    if (!members) throw new Error(`unknown package '${p}' (expected: ${Object.keys(PACKAGES).join(", ")})`);
    for (const m of members) out.add(m);
  }
  return [...out];
}
