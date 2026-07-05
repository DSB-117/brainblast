#!/usr/bin/env python3
"""Batch-submit candidate Findings to the registry's open /api/vti.

Direct POST (no npm/tsx spawn per candidate) so a large batch lands fast. The
server verifies provenance synchronously and inserts proof_verified=false; run the
reprove workflow afterward to flip them. Args: glob-substrings; a candidate matches
if its filename contains ANY arg. No args => all *.json in candidates/.
"""
import json, os, sys, urllib.request, urllib.error

CANDIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "candidates"))
URL = "https://registry.brainblast.tech/api/vti"

def post(finding):
    body = json.dumps({"finding": finding, "consentScope": "opt-in:train+eval"}).encode()
    req = urllib.request.Request(URL, data=body, method="POST",
                                 headers={"content-type": "application/json", "User-Agent": "curl/8.4.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try: return e.code, json.load(e)
        except Exception: return e.code, {}

def main():
    subs = sys.argv[1:]
    files = sorted(f for f in os.listdir(CANDIR) if f.endswith(".json")
                   and (not subs or any(s in f for s in subs)))
    landed = dup = rej = 0
    for f in files:
        try:
            finding = json.load(open(os.path.join(CANDIR, f)))
        except Exception as e:
            print("  skip (bad json):", f, e); continue
        status, out = post(finding)
        if status == 201 and out.get("accepted"):
            landed += 1
        elif status == 200 and out.get("duplicate"):
            dup += 1
        else:
            rej += 1
            reasons = out.get("reasons") or [out.get("error", f"status {status}")]
            print(f"  REJECT {finding.get('id')}: {reasons[0][:140]}")
    print(f"\nSUBMIT: landed={landed}  duplicate={dup}  rejected={rej}  (of {len(files)})")

if __name__ == "__main__":
    main()
