// Program trust score / security oracle.
//
// A single queryable score for any deployed Solana program: how much should you
// trust code at this address? It composes the existing trust graph (upgrade
// authority, verified build, audits, curation, cross-cluster parity) into a
// weighted 0–100 score and an A–F grade that other tools, protocols, and
// frontends can consume as a contract.

import { buildTrustGraph, type BuildOpts } from "./trustGraph/build.ts";
import type { OnChainProgram, UpgradeAuthority, VerifiedBuildState, ParityNote, AuditRef } from "./trustGraph/types.ts";

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface ScoreFactor {
  name: string;
  weight: number; // max points this factor can contribute
  points: number; // points actually awarded
  detail: string;
}

export interface TrustScore {
  programId: string;
  resolved: boolean;
  score: number | null; // null when unresolved
  grade: Grade | "unrated";
  factors: ScoreFactor[];
  summary: string;
  program?: OnChainProgram;
  unresolvedReason?: string;
}

// ── Factor scorers (pure) ────────────────────────────────────────────────────
const W_AUTHORITY = 35;
const W_VERIFIED = 25;
const W_AUDITS = 20;
const W_CURATION = 10;
const W_PARITY = 10;

function scoreAuthority(ua: UpgradeAuthority): ScoreFactor {
  let points: number;
  let detail: string;
  switch (ua.kind) {
    case "renounced":
      points = W_AUTHORITY;
      detail = "Upgrade authority renounced — program code is frozen forever.";
      break;
    case "dao":
      points = 30;
      detail = "Upgrade authority held by a governance program (DAO).";
      break;
    case "multisig":
      points = 26;
      detail = "Upgrade authority held by a multisig.";
      break;
    case "unknown":
      if (ua.address) {
        points = 12;
        detail = `Upgrade authority present but unclassified (${ua.address}). Could be a single hot key.`;
      } else {
        points = 10;
        detail = "Upgrade authority could not be determined.";
      }
      break;
    case "single-key":
    default:
      points = 8;
      detail = "Upgrade authority is a single key — it can replace the program's code at any time.";
      break;
  }
  return { name: "Upgrade authority", weight: W_AUTHORITY, points, detail };
}

function scoreVerified(vb: VerifiedBuildState): ScoreFactor {
  let points: number;
  let detail: string;
  switch (vb.state) {
    case "verified":
      points = W_VERIFIED;
      detail = `On-chain bytecode matches a published source build (${vb.registryUrl}).`;
      break;
    case "unverified":
      points = 2;
      detail = "Not present in any verified-build registry we trust.";
      break;
    case "unknown":
    default:
      points = 8;
      detail = "Verified-build status not checked.";
      break;
  }
  return { name: "Verified build", weight: W_VERIFIED, points, detail };
}

function scoreAudits(audits: AuditRef[]): ScoreFactor {
  let points = 0;
  let detail = "No audits on record.";
  if (audits.length >= 2) {
    points = W_AUDITS;
    detail = `${audits.length} audits on record (${audits.map((a) => a.firm).join(", ")}).`;
  } else if (audits.length === 1) {
    points = 16;
    detail = `One audit on record (${audits[0].firm}, ${audits[0].date}).`;
  }
  return { name: "Audits", weight: W_AUDITS, points, detail };
}

function scoreCuration(program: OnChainProgram): ScoreFactor {
  const curated = program.upgradeAuthority.source === "directory" || !!program.provenance?.directoryFile;
  return {
    name: "Curation",
    weight: W_CURATION,
    points: curated ? W_CURATION : 0,
    detail: curated
      ? "Listed in the curated program directory (known entity)."
      : "Not in the curated directory — identity is not independently corroborated.",
  };
}

function scoreParity(parity: ParityNote): ScoreFactor {
  let points: number;
  let detail: string;
  switch (parity.mainnet) {
    case "present":
      points = W_PARITY;
      detail = "Deployed on mainnet as expected.";
      break;
    case "unknown":
      points = 5;
      detail = "Cross-cluster parity not checked.";
      break;
    default:
      points = 0;
      detail = `Mainnet deployment is '${parity.mainnet}' — possible devnet-only or address mismatch.`;
      break;
  }
  return { name: "Cluster parity", weight: W_PARITY, points, detail };
}

export function gradeForScore(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function scoreFromProgram(program: OnChainProgram): TrustScore {
  const factors = [
    scoreAuthority(program.upgradeAuthority),
    scoreVerified(program.verifiedBuild),
    scoreAudits(program.audits ?? []),
    scoreCuration(program),
    scoreParity(program.parity ?? { mainnet: "unknown", devnet: "unknown" }),
  ];
  const score = factors.reduce((s, f) => s + f.points, 0);
  const grade = gradeForScore(score);
  return {
    programId: program.programId,
    resolved: true,
    score,
    grade,
    factors,
    program,
    summary: `${program.name} — grade ${grade} (${score}/100). ` + factors.find((f) => f.name === "Upgrade authority")!.detail,
  };
}

// ── Orchestration ────────────────────────────────────────────────────────────
export async function scoreProgram(programId: string, opts: BuildOpts = {}): Promise<TrustScore> {
  const graph = await buildTrustGraph([programId], opts);
  const program = graph.programs.find((p) => p.programId === programId);
  if (!program) {
    const reason = graph.unresolved.find((u) => u.programId === programId)?.reason ?? "not resolved";
    return {
      programId,
      resolved: false,
      score: null,
      grade: "unrated",
      factors: [],
      summary: `Could not resolve program ${programId}: ${reason}`,
      unresolvedReason: reason,
    };
  }
  return scoreFromProgram(program);
}

// ── Rendering ────────────────────────────────────────────────────────────────
export function renderScoreText(s: TrustScore): string {
  if (!s.resolved) {
    return `Trust score  [unrated]\n  ${s.summary}`;
  }
  const lines: string[] = [];
  lines.push(`Trust score  [${s.grade}]  ${s.score}/100`);
  lines.push(`  Program: ${s.program?.name ?? s.programId}`);
  lines.push(`  Address: ${s.programId}`);
  lines.push("");
  lines.push("  Factors:");
  for (const f of s.factors) {
    lines.push(`    ${f.points}/${f.weight}  ${f.name} — ${f.detail}`);
  }
  return lines.join("\n");
}

export function gradeAtLeast(grade: Grade | "unrated", min: Grade): boolean {
  const order: Record<Grade, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };
  if (grade === "unrated") return false;
  return order[grade] >= order[min];
}
