import { loadDirectory } from "./directory.ts";
import { probeUpgradeAuthority, type RpcOpts } from "./rpc.ts";
import type { OnChainProgram, TrustGraph, UpgradeAuthority } from "./types.ts";

export interface BuildOpts extends RpcOpts {
  // If false, skip live RPC probes entirely. Useful for offline runs and
  // tests; programs not in the directory will be marked unresolved with
  // reason="not_in_directory_and_rpc_disabled".
  probeRpc?: boolean;
  // Override the directory file (tests).
  directoryPath?: string;
}

// Compose a trust graph for a set of program IDs.
//
// Source-of-truth order:
//   1. Curated directory (programs/directory.yaml) — full record.
//   2. Live RPC probe (probeUpgradeAuthority) — fills in upgradeAuthority
//      only; everything else stays unknown until research enriches it.
//
// The function is deterministic given its inputs: same directory + same RPC
// responses = same TrustGraph (modulo generatedAt + checkedAt timestamps).
export async function buildTrustGraph(programIds: string[], opts: BuildOpts = {}): Promise<TrustGraph> {
  const dir = loadDirectory(opts.directoryPath);
  const programs: OnChainProgram[] = [];
  const unresolved: TrustGraph["unresolved"] = [];

  // Deduplicate and preserve caller order.
  const seen = new Set<string>();
  const ordered = programIds.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));

  for (const id of ordered) {
    const directoryHit = dir.get(id);
    if (directoryHit) {
      programs.push(directoryHit);
      continue;
    }

    if (opts.probeRpc === false) {
      unresolved.push({ programId: id, reason: "not_in_directory_and_rpc_disabled" });
      continue;
    }

    let authority: UpgradeAuthority;
    try {
      authority = await probeUpgradeAuthority(id, opts);
    } catch (e: any) {
      unresolved.push({ programId: id, reason: `rpc_error: ${e?.message ?? String(e)}` });
      continue;
    }

    programs.push({
      programId: id,
      name: `Unknown program (${id.slice(0, 8)}…)`,
      kind: "app",
      upgradeAuthority: authority,
      verifiedBuild: { state: "unknown" },
      audits: [],
      parity: { mainnet: "unknown", devnet: "unknown" },
      provenance: { rpcUrl: opts.rpcUrl, notes: "live-probed; not in curated directory" },
    });
  }

  return { programs, unresolved, generatedAt: new Date().toISOString() };
}
