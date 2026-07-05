#!/usr/bin/env python3
"""Dry-run one candidate per seam suffix to confirm the fixture proves RED->GREEN
(local, no network). Prints PASS/FAIL per seam so a broken fixture is caught
before mass-submit."""
import os, subprocess, sys, glob

CAND = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "candidates"))
CORE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "packages", "core"))
SUFFIXES = ["skippreflight-true","commitment-processed","seller-fee zero","sellerfeebasispoints-0",
  "ismutable-false","rejectunauthorized-false","ignoreexpiration-true","credentialsrequired-false",
  "saveuninitialized-true","ignorehttpserrors-true","acl-public-read","tlsallowinvalidcertificates-true",
  "nodeintegration-true"]

def one(suffix):
    hits = sorted(glob.glob(os.path.join(CAND, f"*{suffix}.json")))
    return hits[0] if hits else None

for suf in SUFFIXES:
    f = one(suf)
    if not f:
        print(f"  --  {suf}: no candidate on disk"); continue
    try:
        r = subprocess.run(["npm","run","--silent","submit:vti","--","--candidate",f,"--dry-run"],
                           cwd=CORE, capture_output=True, text=True, timeout=120)
        out = r.stdout + r.stderr
    except Exception as e:
        print(f"  ??  {suf}: {e}"); continue
    ok = "would ACCEPT" in out
    tag = "PASS" if ok else "FAIL"
    detail = "" if ok else " :: " + (out.strip().splitlines() or ["<no output>"])[-1][:160]
    print(f"  {tag}  {suf}  ({os.path.basename(f)}){detail}")
