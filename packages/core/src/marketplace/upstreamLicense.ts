// Upstream-license detection for WILD-tier records — resolves the license of the
// repo a trap was found in, so sold lots can be filtered (e.g. exclude GPL/AGPL
// from Commercial AI License lots per datasets/marketplace/DATA-LICENSE.md).
//
// Uses the public GitHub licenses API (no auth needed for public repos; honors
// GITHUB_TOKEN if set to lift rate limits). Results cached per owner/repo.

import { parseSourceRef } from "./cleanroom.ts";

export type LicenseBucket = "permissive" | "weak-copyleft" | "strong-copyleft" | "none" | "unknown";

export interface UpstreamLicense {
  spdx: string; // e.g. "MIT", "GPL-3.0", "NOASSERTION", "unknown"
  bucket: LicenseBucket;
  commercialSafe: boolean; // ok to include in a Commercial AI License lot (conservative)
}

const PERMISSIVE = new Set(["MIT", "APACHE-2.0", "BSD-2-CLAUSE", "BSD-3-CLAUSE", "ISC", "0BSD", "UNLICENSE", "MPL-2.0", "CC0-1.0", "ZLIB"]);
const WEAK_COPYLEFT = new Set(["LGPL-2.1", "LGPL-3.0", "EPL-2.0", "CDDL-1.0"]);
const STRONG_COPYLEFT = new Set(["GPL-2.0", "GPL-3.0", "AGPL-3.0", "SSPL-1.0"]);

export function bucketOf(spdx: string): LicenseBucket {
  const u = (spdx ?? "").toUpperCase();
  if (PERMISSIVE.has(u)) return "permissive";
  if (WEAK_COPYLEFT.has(u)) return "weak-copyleft";
  if (STRONG_COPYLEFT.has(u)) return "strong-copyleft";
  if (u === "NOASSERTION" || u === "NONE" || u === "") return "none";
  return "unknown";
}

// Conservative: only clearly-permissive repos are commercial-safe by default.
// none/unknown/copyleft are held out of Commercial lots until manually cleared.
export function commercialSafe(bucket: LicenseBucket): boolean {
  return bucket === "permissive";
}

const cache = new Map<string, UpstreamLicense>();

export async function detectUpstreamLicense(sourceRef: string, fetchImpl: typeof fetch = fetch): Promise<UpstreamLicense> {
  const parsed = parseSourceRef(sourceRef);
  if ("error" in parsed) return { spdx: "unknown", bucket: "unknown", commercialSafe: false };
  const key = `${parsed.owner}/${parsed.repo}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let spdx = "unknown";
  try {
    const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "brainblast-cleanroom" };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetchImpl(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/license`, { headers });
    if (res.ok) {
      const j: any = await res.json();
      spdx = j?.license?.spdx_id ?? "NOASSERTION";
    } else if (res.status === 404) {
      spdx = "NONE"; // no LICENSE file
    }
  } catch {
    spdx = "unknown";
  }
  const bucket = bucketOf(spdx);
  const out: UpstreamLicense = { spdx, bucket, commercialSafe: commercialSafe(bucket) };
  cache.set(key, out);
  return out;
}
