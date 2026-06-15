#!/bin/sh
# Security-advisory cross-check (OSV) — Rung 3 of ROADMAP.md.
#
#   scripts/osv-check.sh <ecosystem> <package> <version>
#
# Queries the public OSV.dev API (https://osv.dev — no account, no key) for
# known advisories affecting <package>@<version> in <ecosystem>, and prints a
# JSON array of findings on stdout:
#
#   [
#     {
#       "id": "GHSA-xxxx-xxxx-xxxx",
#       "severity": "critical|high|medium|low",
#       "summary": "...",
#       "url": "https://osv.dev/vulnerability/GHSA-xxxx-xxxx-xxxx"
#     },
#     ...
#   ]
#
# An empty array (`[]`) means no known advisories — NOT "safe", just nothing
# found in OSV's corpus for this exact version.
#
# <ecosystem> is an OSV ecosystem name: npm, PyPI, crates.io, Go, RubyGems,
# Packagist, Maven, NuGet, Pub, etc. See https://ossf.github.io/osv-schema/#ecosystems.
#
# Exit codes:
#   0  query succeeded (regardless of whether any advisories were found)
#   1  bad usage
#   2  network/API error, or curl/python3 missing
#
# Used by the /brainblast research skill (Step 4b) to fold real CVEs,
# deprecations, and yanked-version notices into report.json risks.

set -e

ECOSYSTEM="$1"
PACKAGE="$2"
VERSION="$3"

if [ -z "$ECOSYSTEM" ] || [ -z "$PACKAGE" ] || [ -z "$VERSION" ]; then
  echo "usage: osv-check.sh <ecosystem> <package> <version>" >&2
  echo "  e.g.: osv-check.sh npm lodash 4.17.20" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "osv-check.sh: curl is required" >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "osv-check.sh: python3 is required" >&2
  exit 2
fi

BODY=$(python3 -c '
import json, sys
print(json.dumps({"version": sys.argv[1], "package": {"name": sys.argv[2], "ecosystem": sys.argv[3]}}))
' "$VERSION" "$PACKAGE" "$ECOSYSTEM")

RESPONSE=$(curl -fsS -m 15 -X POST "https://api.osv.dev/v1/query" \
  -H "Content-Type: application/json" \
  -d "$BODY") || {
    echo "osv-check.sh: OSV API request failed" >&2
    exit 2
  }

echo "$RESPONSE" | python3 -c '
import json, sys

# Maps an OSV severity signal to brainblast risk severity. OSV does not
# always provide CVSS; database_specific.severity (GHSA convention) is the
# most common fallback. Anything unrecognized or absent defaults to "high" —
# err toward surfacing a known advisory loudly rather than burying it.
def map_severity(vuln):
    for sev in vuln.get("severity", []):
        if sev.get("type") == "CVSS_V3":
            try:
                score = float(sev["score"].split("/")[0]) if "/" not in sev["score"] else None
            except (KeyError, ValueError, AttributeError):
                score = None
            # CVSS_V3 score field is sometimes a vector string, not a number;
            # fall through to database_specific in that case.
            if score is not None:
                if score >= 9.0:
                    return "critical"
                if score >= 7.0:
                    return "high"
                if score >= 4.0:
                    return "medium"
                return "low"
    ghsa = (vuln.get("database_specific") or {}).get("severity", "").upper()
    return {
        "CRITICAL": "critical",
        "HIGH": "high",
        "MODERATE": "medium",
        "LOW": "low",
    }.get(ghsa, "high")

data = json.loads(sys.stdin.read(), strict=False)
out = []
for v in data.get("vulns", []):
    vuln_id = v["id"]
    out.append({
        "id": vuln_id,
        "severity": map_severity(v),
        "summary": v.get("summary") or (v.get("details") or "")[:200],
        "url": "https://osv.dev/vulnerability/" + vuln_id,
    })
print(json.dumps(out, indent=2))
'
