// Provenance / anti-fabrication gate — the check that replaces human eyes.
//
// The RED→GREEN proof can only tell us a submission REPRODUCES. It cannot tell
// invented-but-reproducing code from a real repo find: a scout can write a
// fixture whose forbidden literal was never in the cited repo, and it will prove
// green all day (this actually happened — an agentkit scout "synthesized" a
// footgun not present in the source). With PR review gone, something must verify
// the trap is REAL. This is that something.
//
// The check is deliberately lightweight and mechanical — no LLM, no trust:
//   1. The submission must cite a COMMIT-PINNED source (owner/repo@<sha>:path or a
//      GitHub blob/raw URL with a 7–40 hex SHA). A mutable branch ref is rejected —
//      you can't point at `main` of a repo you control and rewrite it later.
//   2. The server FETCHES that exact file at that exact commit.
//   3. The submission's declared `evidence` string must appear VERBATIM in the
//      fetched source, and must mention the trap's own forbidden property — so the
//      cited line can't be unrelated boilerplate.
//
// If the cited commit 404s, or the evidence isn't in it, the submission is
// rejected as unverifiable — exactly the fabrication case. `fetchImpl` is
// injectable so this is testable without network.

import type { Finding } from "../synth/types.ts";

export interface ProvenanceResult {
  ok: boolean;
  reasons: string[];
  /** The immutable raw URL the evidence was verified against (when ok). */
  resolvedUrl?: string;
}

const SHA_RE = /^[0-9a-f]{7,40}$/i;
// Branch/tag names that must NOT be accepted as a pin (mutable refs).
const MUTABLE_REF_RE = /^(main|master|develop|dev|trunk|head|latest|v?\d+(\.\d+)*|release.*)$/i;

interface SourceRef {
  rawUrl: string;
  sha: string;
}

// Resolve a citation into an immutable raw URL + the SHA it pins. Accepts:
//   - "owner/repo@<sha>:path/to/file.ts"
//   - "https://github.com/owner/repo/blob/<sha>/path/to/file.ts"
//   - "https://raw.githubusercontent.com/owner/repo/<sha>/path/to/file.ts"
// Returns null (with a reason) if it isn't commit-pinned.
export function resolveSourceRef(ref: string): { ref?: SourceRef; reason?: string } {
  if (typeof ref !== "string" || ref.length === 0) return { reason: "no sourceRef provided" };

  // owner/repo@sha:path
  const shorthand = ref.match(/^([^/\s]+)\/([^@\s]+)@([^:\s]+):(.+)$/);
  if (shorthand) {
    const [, owner, repo, sha, path] = shorthand;
    if (!SHA_RE.test(sha)) return { reason: `sourceRef must pin a commit SHA, got '${sha}'` };
    return { ref: { sha, rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}` } };
  }

  if (/^https?:\/\//.test(ref)) {
    // github.com/owner/repo/blob/<sha>/path  → raw
    const blob = ref.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
    if (blob) {
      const [, owner, repo, sha, path] = blob;
      if (!SHA_RE.test(sha) || MUTABLE_REF_RE.test(sha)) {
        return { reason: `GitHub blob URL must pin a commit SHA (not a branch/tag like '${sha}')` };
      }
      return { ref: { sha, rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}` } };
    }
    // raw.githubusercontent.com/owner/repo/<sha>/path
    const raw = ref.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    if (raw) {
      const sha = raw[3];
      if (!SHA_RE.test(sha) || MUTABLE_REF_RE.test(sha)) {
        return { reason: `raw URL must pin a commit SHA (not a branch/tag like '${sha}')` };
      }
      return { ref: { sha, rawUrl: ref } };
    }
    return { reason: "only github.com/raw.githubusercontent.com commit-pinned URLs are verifiable" };
  }

  return { reason: "sourceRef must be 'owner/repo@<sha>:path' or a commit-pinned GitHub URL" };
}

// The forbidden property this trap keys off — evidence must mention it so a
// citation can't point at an unrelated line in the file. Best-effort per checker.
function expectedToken(finding: Finding): string | undefined {
  const p = finding.binding?.check?.params ?? {};
  return (p.propName ?? p.call ?? undefined) as string | undefined;
}

export interface VerifyProvenanceOptions {
  fetchImpl?: typeof fetch;
  /** Cap the bytes we read from a cited file. */
  maxBytes?: number;
}

// Verify a submission is a REAL find: fetch the cited commit and confirm the
// vulnerable evidence is actually present there.
export async function verifyProvenance(finding: Finding, opts: VerifyProvenanceOptions = {}): Promise<ProvenanceResult> {
  const f = opts.fetchImpl ?? fetch;
  const maxBytes = opts.maxBytes ?? 512 * 1024;
  const prov = (finding.provenance ?? {}) as Record<string, any>;
  const reasons: string[] = [];

  const sourceRef: string = prov.sourceRef ?? "";
  const evidence: string = prov.evidence ?? "";

  if (!evidence || typeof evidence !== "string" || evidence.trim().length < 3) {
    reasons.push("provenance.evidence is required — a verbatim snippet of the vulnerable line from the cited source");
  }

  const resolved = resolveSourceRef(sourceRef);
  if (!resolved.ref) {
    reasons.push(`provenance: ${resolved.reason}`);
    return { ok: false, reasons };
  }
  if (reasons.length > 0) return { ok: false, reasons };

  // Evidence must mention the trap's own forbidden property/call — otherwise a
  // citation could point at any real line, unrelated to the submitted trap.
  // Nested/dotted propNames (e.g. `images.dangerouslyAllowSVG`, `ssl.rejectUnauthorized`)
  // never appear as a literal dotted string in real code — the property sits on its own
  // line under a parent object. Match on the LAST path segment (the real identifier at
  // the footgun site); this keeps the anti-fabrication guarantee (the cited line must
  // still contain the actual footgun property/call) while unlocking nested-config traps.
  const token = expectedToken(finding);
  const evidenceToken = token && token.includes(".") ? token.slice(token.lastIndexOf(".") + 1) : token;
  if (evidenceToken && !evidence.includes(evidenceToken)) {
    reasons.push(`provenance.evidence must contain the trap's target '${evidenceToken}' (the cited line must be the actual footgun)`);
  }

  // Fetch the exact file at the exact commit and confirm the evidence is in it.
  let body: string;
  try {
    const res = await f(resolved.ref.rawUrl);
    if (!res.ok) {
      reasons.push(`provenance: cited source not found (${res.status}) at ${resolved.ref.rawUrl}`);
      return { ok: false, reasons };
    }
    body = (await res.text()).slice(0, maxBytes);
  } catch (e: any) {
    reasons.push(`provenance: could not fetch cited source (${e?.message ?? e})`);
    return { ok: false, reasons };
  }

  // The core anti-fabrication assertion: the vulnerable evidence exists at the
  // pinned commit. Whitespace-tolerant so formatting differences don't false-fail.
  if (!containsFlexible(body, evidence)) {
    reasons.push("provenance: evidence not found in the cited source at that commit — cannot confirm this trap is real (fabrication check failed)");
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, reasons: [], resolvedUrl: resolved.ref.rawUrl };
}

// Substring match that tolerates differences in run-length whitespace (indent,
// line wrapping) but nothing else — we still require the exact tokens in order.
function containsFlexible(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return norm(haystack).includes(norm(needle));
}
