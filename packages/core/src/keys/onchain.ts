// Keyguard — on-chain blast-radius enrichment.
//
// The offline scan can only say "this is a private key" and assume FUNDS. The
// chain is what turns that into the sentence that actually scares you:
//   "☠ this key is the SOLE UPGRADE AUTHORITY of program Bpf…9xQ — lose it and
//    the program can never be upgraded again."
//
// We resolve, for each detected keypair: does its account hold SOL? is its
// pubkey itself a deployed program (so the keypair is post-deploy rebuildable)?
// and — the headline — is it the upgrade authority of any program we know about?

import {
  getAccountInfo as realGetAccountInfo,
  probeUpgradeAuthority as realProbeUpgradeAuthority,
  BPF_UPGRADEABLE_LOADER,
  BPF_LOADER_2,
  type RpcOpts,
} from "../trustGraph/rpc.ts";
import { finalizeReport } from "./scan.ts";
import type { BlastTier, DetectedSecret, KeysReport, OnchainFacts } from "./types.ts";

const LAMPORTS_PER_SOL = 1_000_000_000;
const DEPLOY_KEYPAIR_RE = /(^|[\/\\])target[\/\\]deploy[\/\\]/;

// Injection point: tests pass fakes; production uses the real RPC layer.
export interface OnchainDeps {
  getAccountInfo: typeof realGetAccountInfo;
  probeUpgradeAuthority: typeof realProbeUpgradeAuthority;
}

const realDeps: OnchainDeps = {
  getAccountInfo: realGetAccountInfo,
  probeUpgradeAuthority: realProbeUpgradeAuthority,
};

export interface EnrichOpts extends RpcOpts {
  // Program IDs to test authority against, beyond those inferred from
  // target/deploy keypairs (e.g. parsed from Anchor.toml).
  programIds?: string[];
  deps?: OnchainDeps;
}

function resolveTier(facts: OnchainFacts): BlastTier {
  if (facts.upgradeAuthorityOf && facts.upgradeAuthorityOf.length > 0) return "terminal";
  if (facts.isDeployedProgram) return "rebuildable";
  if (facts.lamports && facts.lamports > 0) return "funds";
  return "unknown";
}

export async function enrichSecretsOnchain(report: KeysReport, opts: EnrichOpts = {}): Promise<KeysReport> {
  const deps = opts.deps ?? realDeps;
  const rpc: RpcOpts = { rpcUrl: opts.rpcUrl, timeoutMs: opts.timeoutMs, fetchImpl: opts.fetchImpl };

  // 1. Candidate program IDs: explicit + the pubkeys of any program keypairs
  //    found under target/deploy.
  const candidatePrograms = new Set<string>(opts.programIds ?? []);
  for (const s of report.secrets) {
    if (s.pubkey && DEPLOY_KEYPAIR_RE.test(s.rel)) candidatePrograms.add(s.pubkey);
  }

  // 2. Resolve each candidate program's upgrade authority once → authority→[programs].
  const authorityToPrograms = new Map<string, string[]>();
  const checkedProgramIds: string[] = [];
  for (const programId of candidatePrograms) {
    try {
      const auth = await deps.probeUpgradeAuthority(programId, rpc);
      checkedProgramIds.push(programId);
      if (auth.address) {
        const list = authorityToPrograms.get(auth.address) ?? [];
        list.push(programId);
        authorityToPrograms.set(auth.address, list);
      }
    } catch {
      // Not a deployed program (or RPC error) — skip; it just won't contribute.
    }
  }

  // 3. Enrich each keypair we have a pubkey for.
  const enriched: DetectedSecret[] = [];
  for (const s of report.secrets) {
    if (!s.pubkey || s.tier === "trivial" || !s.needsOnchainCheck) {
      enriched.push(s);
      continue;
    }
    try {
      const acct = await deps.getAccountInfo(s.pubkey, rpc);
      const lamports = acct?.lamports ?? 0;
      const isDeployedProgram = !!acct && acct.executable && (acct.owner === BPF_UPGRADEABLE_LOADER || acct.owner === BPF_LOADER_2);
      const upgradeAuthorityOf = authorityToPrograms.get(s.pubkey) ?? [];
      const facts: OnchainFacts = {
        lamports,
        sol: lamports / LAMPORTS_PER_SOL,
        isDeployedProgram,
        upgradeAuthorityOf,
        checkedProgramIds,
      };
      const tier = resolveTier(facts);
      enriched.push({ ...s, tier, needsOnchainCheck: false, onchain: facts, reason: reasonFor(s, facts, tier) });
    } catch {
      // RPC failure for this key — leave it as the offline best-guess.
      enriched.push(s);
    }
  }

  return finalizeReport(report.root, enriched);
}

function reasonFor(s: DetectedSecret, facts: OnchainFacts, tier: BlastTier): string {
  if (tier === "terminal") {
    const progs = facts.upgradeAuthorityOf!.join(", ");
    return `SOLE UPGRADE AUTHORITY of ${progs}. Lose this key and the program can never be upgraded again — no recovery exists.`;
  }
  if (tier === "rebuildable") {
    return `This key's pubkey is a deployed program. Post-deploy it only set the program's address; losing it does not block upgrades (those use the upgrade authority).`;
  }
  if (tier === "funds") {
    return `Holds ${facts.sol!.toFixed(4)} SOL. Lose this key and the funds are unrecoverable.`;
  }
  // unknown: no funds, not an authority on the programs we could check.
  const checked = facts.checkedProgramIds && facts.checkedProgramIds.length;
  return `No SOL and not an upgrade authority of ${checked ? `the ${checked} program(s) checked` : "any known program"} — but other programs couldn't be ruled out. ${s.reason}`;
}
