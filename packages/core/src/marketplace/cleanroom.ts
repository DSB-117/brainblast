// Clean-room export — turn a corpus VTI (or a registry/fleet record) into the
// SELLABLE artifact defined in datasets/marketplace/CLEANROOM-SPEC.md.
//
// The one rule: the sold payload ships our authored fixtures + the RED→GREEN
// proof + PROVENANCE BY REFERENCE (a commit-pinned pointer + sha256 of the
// matched line) — and NEVER a verbatim third-party `evidence` string. Owned-tier
// records (authored snippets, docs-cited) carry no third-party content at all.

import { createHash } from "node:crypto";

export type ProvenanceClass = "synthetic-owned" | "wild";

export interface CleanroomProvenance {
  class: ProvenanceClass;
  // wild:
  sourceRef?: string; // owner/repo@<40-hex-sha>:path
  sourceUrl?: string; // commit-pinned blob URL (+ #Lnn if known)
  evidenceSha256?: string; // sha256 of the verbatim matched line (NOT the line)
  evidenceLen?: number;
  upstreamLicense?: string; // set by the license-detection pass (mit|apache-2.0|gpl-*|…|unknown)
  // owned:
  docUrls?: string[];
  capturedAt?: string;
}

export interface CleanroomRecord {
  schemaVersion: "cleanroom-1.0";
  trapId: string;
  title: string;
  sdk: { name: string; version?: string; type?: string };
  severity: string;
  class: string;
  vulnerable: { lang: string; code: string; detail?: string | null };
  fixed: { lang: string; code: string; detail?: string | null };
  lesson: string;
  generatedTest: string | null;
  redGreenProof: Record<string, unknown>;
  provenance: CleanroomProvenance;
  rights: { artifactLicense: string; provenanceClass: ProvenanceClass; contributorConsent?: string };
  corroborationCount: number;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

const SHA40 = /^[0-9a-f]{40}$/i;
const MUTABLE = /^(head|main|master|develop|latest|v?\d+(\.\d+)*)$/i;

export interface ParsedRef {
  sha: string;
  owner: string;
  repo: string;
  path: string;
  line?: number;
  rawUrl: string; // raw.githubusercontent commit-pinned
  blobUrl: string; // github.com blob commit-pinned (+#Lnn)
  sourceRef: string; // normalized owner/repo@sha:path
}

// Accepts `owner/repo@<sha>:path[#Lnn]` or a commit-pinned github blob/raw URL.
export function parseSourceRef(ref: string): ParsedRef | { error: string } {
  if (typeof ref !== "string" || !ref) return { error: "empty sourceRef" };
  let owner = "", repo = "", sha = "", path = "", line: number | undefined;

  const short = ref.match(/^([^/]+)\/([^/@]+)@([^:]+):(.+)$/);
  const blob = ref.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  const raw = ref.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  const m = short ?? blob ?? raw;
  if (!m) return { error: "sourceRef must be 'owner/repo@<sha>:path' or a commit-pinned GitHub URL" };
  owner = m[1]; repo = m[2]; sha = m[3];
  let rest = m[4];
  const hash = rest.match(/#L(\d+)$/);
  if (hash) { line = Number(hash[1]); rest = rest.replace(/#L\d+$/, ""); }
  path = rest;

  if (!SHA40.test(sha) || MUTABLE.test(sha)) return { error: `sourceRef must pin a 40-hex commit SHA, got '${sha}'` };
  return {
    sha, owner, repo, path, line,
    rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`,
    blobUrl: `https://github.com/${owner}/${repo}/blob/${sha}/${path}${line ? `#L${line}` : ""}`,
    sourceRef: `${owner}/${repo}@${sha}:${path}${line ? `#L${line}` : ""}`,
  };
}

// Normalize the many input shapes (published corpus VTI schema 1.1, the registry
// ingest `record`, a raw fleet Finding) to the fields we need.
function readInput(v: any): {
  trapId: string; title: string; sdk: any; severity: string; class: string;
  vulnCode: string; vulnLang: string; vulnDetail: string | null;
  fixedCode: string; fixedLang: string; fixedDetail: string | null;
  lesson: string; test: string | null; proof: any;
  sourceRef?: string; sourceUrl?: string; evidence?: string; docUrls?: string[];
  consent?: string; corroboration: number;
} {
  const vuln = v.vulnerable ?? v.fixtures ?? {};
  const fixd = v.fixed ?? {};
  const vulnCode = vuln.code ?? vuln.snippet ?? v.fixtures?.vulnerable ?? "";
  const fixedCode = fixd.code ?? fixd.snippet ?? v.fixtures?.fixed ?? "";
  const prov = v.provenance ?? {};
  const detect = v.detect ?? {};
  const lang = vuln.lang ?? detect.lang ?? "typescript";
  return {
    trapId: v.trapId ?? v.trap_id ?? v.id,
    title: v.title ?? v.trapId ?? v.id,
    sdk: v.sdk ?? (v.component ? { name: v.component.name, version: v.component.version, type: v.component.type } : { name: "sdk" }),
    severity: v.severity ?? "medium",
    class: v.class ?? "other",
    vulnCode, vulnLang: lang, vulnDetail: vuln.detail ?? null,
    fixedCode, fixedLang: fixd.lang ?? lang, fixedDetail: fixd.detail ?? null,
    lesson: v.lesson ?? vuln.detail ?? v.title ?? "",
    test: v.generatedTest ?? null,
    proof: v.redGreenProof ?? (v.binding ? { checkKind: v.binding.check?.kind, method: "static-checker" } : {}),
    sourceRef: prov.sourceRef,
    sourceUrl: prov.sourceUrl,
    evidence: prov.evidence,
    docUrls: prov.sourceUrls,
    consent: v.consentScope ?? v.rights?.contributorConsent,
    corroboration: v.corroborationCount ?? 0,
  };
}

export interface ToCleanroomResult {
  record?: CleanroomRecord;
  error?: string;
  strippedEvidence?: string; // the verbatim line we removed (for the validator's span check; never persisted)
}

export const ARTIFACT_LICENSE = "brainblast-training-1.0";
export const ENGINE_VERSION_FALLBACK = "brainblast@1.0.0";

export function toCleanroom(input: any, engineVersion = ENGINE_VERSION_FALLBACK): ToCleanroomResult {
  const v = readInput(input);
  if (!v.trapId) return { error: "missing trapId/id" };
  if (!v.vulnCode || !v.fixedCode) return { error: `${v.trapId}: missing vulnerable/fixed code` };

  const isWild = !!(v.sourceRef || v.evidence);
  let provenance: CleanroomProvenance;

  if (isWild) {
    if (!v.sourceRef) return { error: `${v.trapId}: wild record has evidence but no sourceRef — cannot ship by reference` };
    const parsed = parseSourceRef(v.sourceRef);
    if ("error" in parsed) return { error: `${v.trapId}: ${parsed.error}` };
    if (!v.evidence) return { error: `${v.trapId}: wild record missing evidence to hash` };
    provenance = {
      class: "wild",
      sourceRef: parsed.sourceRef,
      sourceUrl: v.sourceUrl ?? parsed.blobUrl,
      evidenceSha256: sha256(v.evidence),
      evidenceLen: v.evidence.length,
      upstreamLicense: input.provenance?.upstreamLicense, // may be filled by the license pass
      capturedAt: input.capturedAt ?? input.provenance?.capturedAt,
    };
  } else {
    provenance = {
      class: "synthetic-owned",
      docUrls: v.docUrls ?? [],
      capturedAt: input.capturedAt,
    };
  }

  const proof = { ...v.proof, engineVersion };
  const record: CleanroomRecord = {
    schemaVersion: "cleanroom-1.0",
    trapId: v.trapId,
    title: v.title,
    sdk: v.sdk,
    severity: v.severity,
    class: v.class,
    vulnerable: { lang: v.vulnLang, code: v.vulnCode, detail: v.vulnDetail },
    fixed: { lang: v.fixedLang, code: v.fixedCode, detail: v.fixedDetail },
    lesson: v.lesson,
    generatedTest: v.test,
    redGreenProof: proof,
    provenance,
    rights: { artifactLicense: ARTIFACT_LICENSE, provenanceClass: provenance.class, contributorConsent: v.consent },
    corroborationCount: v.corroboration,
  };
  return { record, strippedEvidence: v.evidence };
}

// ── validator (the sold-set gate) ───────────────────────────────────────────────

export interface ValidateOptions {
  fetchedLine?: string | null; // the line fetched from sourceUrl, for the hash + span check (opt-in / network)
  minSpan?: number; // token-span guard length (default 40)
}
export interface ValidationIssue { code: string; detail: string }

export function validateCleanroom(record: CleanroomRecord, strippedEvidence?: string, opts: ValidateOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const minSpan = opts.minSpan ?? 40;

  // 1. no verbatim third-party evidence string in the sold payload
  if ((record.provenance as any).evidence) issues.push({ code: "evidence-leak", detail: "provenance.evidence must not exist in a sold record" });
  if (JSON.stringify(record).includes('"evidence"')) issues.push({ code: "evidence-leak", detail: "an `evidence` field survived into the sold JSON" });

  // 2. proof must be genuine RED→GREEN
  const p: any = record.redGreenProof;
  if (!(p?.red === true && p?.green === true)) issues.push({ code: "not-proven", detail: "redGreenProof.red && green must both be true" });

  // 3. wild-tier: pinned SHA + hash present
  if (record.provenance.class === "wild") {
    const parsed = record.provenance.sourceRef ? parseSourceRef(record.provenance.sourceRef) : { error: "no sourceRef" };
    if ("error" in parsed) issues.push({ code: "bad-sourceref", detail: parsed.error });
    if (!record.provenance.evidenceSha256) issues.push({ code: "no-hash", detail: "wild record needs evidenceSha256" });
    // 3b. optional: the pointer resolves to the exact hashed line
    if (opts.fetchedLine != null && record.provenance.evidenceSha256 && sha256(opts.fetchedLine) !== record.provenance.evidenceSha256) {
      issues.push({ code: "dead-pointer", detail: "fetched line's sha256 does not match evidenceSha256 (moved/forged pointer)" });
    }
  }

  // 4. defensive: an authored fixture must not embed a long verbatim span of the upstream line
  const upstream = opts.fetchedLine ?? strippedEvidence;
  if (upstream && upstream.trim().length >= minSpan) {
    const needle = upstream.trim();
    if (record.vulnerable.code.includes(needle) || record.fixed.code.includes(needle)) {
      issues.push({ code: "verbatim-span", detail: `a fixture contains a ${needle.length}-char verbatim span of the upstream line` });
    }
  }
  return issues;
}
