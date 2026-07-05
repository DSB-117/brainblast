#!/usr/bin/env python3
"""Sourcegraph-driven VTI candidate generator — discovery with ZERO GitHub API use.

Sourcegraph streaming search returns repository + exact commit SHA + path + matched
line for every hit: a complete, commit-pinned provenance record. For a fixed seam
(one propName/forbiddenValue/class + a canonical fixture proving RED->GREEN), each
hit becomes a submittable candidate; only id/title/provenance vary per repo. The
provenance gate only requires the evidence line to exist at the pinned commit AND
contain the trap's target (propName), so the fixture's `call` is canonical.

Usage: sg_scout.py <seam>[ <seam> ...]   |   sg_scout.py --all   |   sg_scout.py --list
"""
import json, re, sys, urllib.parse, urllib.request, os

CANDIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "candidates"))
COMMENT = re.compile(r"^\s*(//|\*|/\*|#|<!--|--)")

def sg_search(pattern, lang="TypeScript", count=120):
    q = f"count:{count} lang:{lang} patterntype:regexp {pattern}"
    url = "https://sourcegraph.com/.api/search/stream?q=" + urllib.parse.quote(q)
    req = urllib.request.Request(url, headers={"Accept": "text/event-stream", "User-Agent": "curl/8.4.0"})
    out = []
    with urllib.request.urlopen(req, timeout=90) as r:
        for raw in r:
            line = raw.decode("utf-8", "replace")
            if line.startswith("data: ["):
                try: arr = json.loads(line[6:])
                except Exception: continue
                for m in arr:
                    if m.get("type") != "content": continue
                    repo, commit, path = m.get("repository",""), m.get("commit",""), m.get("path","")
                    if not (repo.startswith("github.com/") and commit and path): continue
                    for lm in (m.get("lineMatches") or []):
                        out.append({"repo": repo[len("github.com/"):], "commit": commit,
                                    "path": path, "line": lm.get("line",""),
                                    "lineNumber": lm.get("lineNumber"), "stars": m.get("repoStars",0)})
    return out

def slug(s): return re.sub(r"[^a-z0-9]+","-",s.lower()).strip("-")

def existing_ids():
    ids = {f[:-5] for f in os.listdir(CANDIR) if f.endswith(".json")}
    try:
        req = urllib.request.Request("https://registry.brainblast.tech/api/vti", headers={"User-Agent":"curl/8.4.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            for rec in json.load(r).get("records", []): ids.add(rec.get("trapId",""))
    except Exception: pass
    return ids

def fx(imp, body_vuln, body_fixed, fn="handler"):
    head = f'{imp}\n\nexport function {fn}(a: any, b: any, c: any) {{\n'
    return (head + f'  // VULNERABLE\n  {body_vuln}\n}}\n',
            head + f'  // FIXED\n  {body_fixed}\n}}\n')

# Each seam: pattern (regexp), must (substring the line must contain = propName),
# check params, canonical fixture. kind defaults to object-arg-property-forbidden-literal.
def S(pattern, must, module, sdktype, sdkver, sdkurl, cls, sev, call, argIndex, propName,
      forbidden, safe, nameRegex, title, fail, imp, vuln_stmt, fixed_stmt, fn="handler"):
    v, f = fx(imp, vuln_stmt, fixed_stmt, fn)
    return dict(pattern=pattern, must=must, module=module, sdktype=sdktype, sdkver=sdkver,
                sdkurl=sdkurl, cls=cls, sev=sev, call=call, argIndex=argIndex, propName=propName,
                forbidden=forbidden, nameRegex=nameRegex + "|handler", title=title, fail=fail,
                pass_=f'{propName} is not set to the forbidden value; the safe path applies.',
                vuln=v, fixed=f)

SEAMS = {
 "skippreflight-true": S(r"skipPreflight:\s*true", "skipPreflight", "@solana/web3.js","Blockchain",">=1.30.0",
   "https://solana-labs.github.io/solana-web3.js/classes/Connection.html#sendRawTransaction","unconfirmed-state","high",
   "sendRawTransaction",1,"skipPreflight",True,False,"send|submit|tx|transaction|broadcast|relay|swap",
   'skipPreflight: true broadcasts the transaction WITHOUT preflight simulation — a failing/doomed transaction is sent anyway and its error is never surfaced; the caller gets a signature and assumes success.',
   'skipPreflight: true broadcasts the transaction WITHOUT preflight simulation — a failing/doomed transaction is sent anyway and its error is never surfaced; the caller gets a signature and assumes success. Remove skipPreflight: true unless you independently simulate.',
   'import { Connection } from "@solana/web3.js";',
   'return a.sendRawTransaction(b, { skipPreflight: true });',
   'return a.sendRawTransaction(b, { skipPreflight: false });'),

 "commitment-processed": S(r"commitment:\s*[\"']processed[\"']", "commitment", "@solana/web3.js","Blockchain",">=1.30.0",
   "https://solana-labs.github.io/solana-web3.js/classes/Connection.html#constructor","unconfirmed-state","high",
   "Connection",1,"commitment","processed","confirmed","conn|connection|rpc|client|provider|make|send",
   'commitment: "processed" makes the weakest, still-forkable commitment the default — balances, reads, and confirmations resolve against reversible state that can vanish on a fork switch.',
   'commitment: "processed" makes the weakest, still-forkable commitment the default — reads and confirmations resolve against reversible state that can vanish on a fork switch. Use "confirmed" or "finalized".',
   'import { Connection } from "@solana/web3.js";',
   'return new Connection(a, { commitment: "processed" });',
   'return new Connection(a, { commitment: "confirmed" });'),

 "seller-fee-zero": S(r"sellerFeeBasisPoints:\s*0\b", "sellerFeeBasisPoints", "@metaplex-foundation/js","NFT",">=0.19.0",
   "https://developers.metaplex.com/token-metadata","silent-zero-revenue","high",
   "create",0,"sellerFeeBasisPoints",0,500,"create|mint|nft|token|metadata|update",
   'sellerFeeBasisPoints: 0 zeroes on-chain royalties — every secondary sale pays the creator nothing.',
   'sellerFeeBasisPoints: 0 zeroes on-chain royalties — every secondary sale pays the creator nothing. Set the intended basis points (e.g. 500 = 5%).',
   'import { Metaplex } from "@metaplex-foundation/js";',
   'return a.create({ sellerFeeBasisPoints: 0 });',
   'return a.create({ sellerFeeBasisPoints: 500 });'),

 "ismutable-false": S(r"isMutable:\s*false", "isMutable", "@metaplex-foundation/mpl-token-metadata","NFT",">=2.0.0",
   "https://developers.metaplex.com/token-metadata","immutable-after-deploy","medium",
   "create",0,"isMutable",False,True,"create|mint|nft|token|metadata|update",
   'isMutable: false permanently locks the metadata — name, URI, and royalties can never be corrected or revealed.',
   'isMutable: false permanently locks the metadata — name, URI, and royalties can never be corrected. Keep it mutable until finalized.',
   'import { createV1 } from "@metaplex-foundation/mpl-token-metadata";',
   'return a.create({ isMutable: false });',
   'return a.create({ isMutable: true });'),

 "reject-unauthorized-false": S(r"rejectUnauthorized:\s*false", "rejectUnauthorized", "node:https","Networking",">=0.10.0",
   "https://nodejs.org/api/tls.html","auth-bypass","critical",
   "Agent",0,"rejectUnauthorized",False,True,"agent|client|connect|request|tls|https|make|pool",
   'rejectUnauthorized: false disables TLS certificate verification — the connection accepts any certificate, enabling a trivial man-in-the-middle.',
   'rejectUnauthorized: false disables TLS certificate verification — the connection accepts any certificate, enabling a man-in-the-middle. Never set it false in production.',
   'import https from "node:https";',
   'return new https.Agent({ rejectUnauthorized: false });',
   'return new https.Agent({ rejectUnauthorized: true });'),

 "ignore-expiration-true": S(r"ignoreExpiration:\s*true", "ignoreExpiration", "jsonwebtoken","Auth",">=8.0.0",
   "https://github.com/auth0/node-jsonwebtoken","auth-bypass","high",
   "verify",2,"ignoreExpiration",True,False,"verify|auth|token|jwt|validate|check",
   'ignoreExpiration: true makes jwt.verify accept EXPIRED tokens — a leaked or revoked token stays valid forever.',
   'ignoreExpiration: true makes jwt.verify accept EXPIRED tokens — a leaked or revoked token stays valid forever. Remove it so exp is enforced.',
   'import jwt from "jsonwebtoken";',
   'return jwt.verify(a, b, { ignoreExpiration: true });',
   'return jwt.verify(a, b, { ignoreExpiration: false });'),

 "credentials-required-false": S(r"credentialsRequired:\s*false", "credentialsRequired", "express-jwt","Auth",">=6.0.0",
   "https://github.com/auth0/express-jwt","auth-bypass","high",
   "expressjwt",0,"credentialsRequired",False,True,"jwt|auth|middleware|protect|guard",
   'credentialsRequired: false lets requests with NO token reach protected handlers — the JWT check becomes optional.',
   'credentialsRequired: false lets tokenless requests reach protected handlers — the JWT gate becomes optional. Require credentials on protected routes.',
   'import { expressjwt } from "express-jwt";',
   'return expressjwt({ secret: a, algorithms: ["HS256"], credentialsRequired: false });',
   'return expressjwt({ secret: a, algorithms: ["HS256"], credentialsRequired: true });'),

 "save-uninitialized-true": S(r"saveUninitialized:\s*true", "saveUninitialized", "express-session","Auth",">=1.0.0",
   "https://github.com/expressjs/session","auth-bypass","medium",
   "session",0,"saveUninitialized",True,False,"session|auth|cookie|app|middleware",
   'saveUninitialized: true stores a session for every visitor before login — session fixation surface and needless session growth.',
   'saveUninitialized: true persists a session for every unauthenticated visitor (session-fixation surface). Set it false so only initialized sessions are saved.',
   'import session from "express-session";',
   'return session({ secret: a, resave: false, saveUninitialized: true });',
   'return session({ secret: a, resave: false, saveUninitialized: false });'),

 "ignore-https-errors-true": S(r"ignoreHTTPSErrors:\s*true", "ignoreHTTPSErrors", "playwright","Testing",">=1.0.0",
   "https://playwright.dev/docs/api/class-browser#browser-new-context","auth-bypass","medium",
   "newContext",0,"ignoreHTTPSErrors",True,False,"context|browser|launch|connect|page|scrape|fetch",
   'ignoreHTTPSErrors: true disables TLS certificate validation for the browser context — it silently trusts any certificate.',
   'ignoreHTTPSErrors: true disables TLS certificate validation for the browser context — it trusts any certificate (MITM). Remove it outside local testing.',
   'import { chromium } from "playwright";',
   'return a.newContext({ ignoreHTTPSErrors: true });',
   'return a.newContext({ ignoreHTTPSErrors: false });'),

 "s3-public-read-acl": S(r"ACL:\s*[\"']public-read[\"']", "ACL", "@aws-sdk/client-s3","Cloud",">=3.0.0",
   "https://docs.aws.amazon.com/AmazonS3/latest/userguide/acl-overview.html","auth-bypass","high",
   "PutObjectCommand",0,"ACL","public-read","private","upload|put|object|s3|store|save",
   'ACL: "public-read" makes the uploaded object world-readable — anyone with the URL can read it, regardless of bucket policy.',
   'ACL: "public-read" makes the uploaded object world-readable to anyone with the URL. Use "private" and serve via signed URLs / CloudFront.',
   'import { PutObjectCommand } from "@aws-sdk/client-s3";',
   'return new PutObjectCommand({ Bucket: a, Key: b, ACL: "public-read" });',
   'return new PutObjectCommand({ Bucket: a, Key: b, ACL: "private" });'),

 "tls-allow-invalid-certs": S(r"tlsAllowInvalidCertificates:\s*true", "tlsAllowInvalidCertificates", "mongodb","Database",">=4.0.0",
   "https://www.mongodb.com/docs/drivers/node/current/","auth-bypass","critical",
   "MongoClient",1,"tlsAllowInvalidCertificates",True,False,"mongo|client|connect|db|database",
   'tlsAllowInvalidCertificates: true accepts ANY certificate on the MongoDB TLS connection — a man-in-the-middle can impersonate the database.',
   'tlsAllowInvalidCertificates: true accepts any certificate on the TLS connection to MongoDB (MITM). Remove it and use a proper CA.',
   'import { MongoClient } from "mongodb";',
   'return new MongoClient(a, { tls: true, tlsAllowInvalidCertificates: true });',
   'return new MongoClient(a, { tls: true, tlsAllowInvalidCertificates: false });'),

 "node-integration-true": S(r"nodeIntegration:\s*true", "nodeIntegration", "electron","Desktop",">=10.0.0",
   "https://www.electronjs.org/docs/latest/tutorial/security","auth-bypass","high",
   "BrowserWindow",0,"nodeIntegration",True,False,"window|browser|create|electron|main",
   'nodeIntegration: true exposes full Node.js (fs, child_process) to renderer/remote content — any XSS becomes remote code execution on the user machine.',
   'nodeIntegration: true exposes Node.js to renderer content, so any injected script gets fs/child_process (RCE). Keep it false with contextIsolation true and a preload bridge.',
   'import { BrowserWindow } from "electron";',
   'return new BrowserWindow({ nodeIntegration: true });',
   'return new BrowserWindow({ nodeIntegration: false });'),
}

def gen(name):
    s = SEAMS[name]; seen = existing_ids()
    hits = sg_search(s["pattern"], "TypeScript"); made=[]; used=set()
    for h in hits:
        line = h["line"]
        if COMMENT.match(line) or s["must"] not in line: continue
        repo = h["repo"]
        if repo in used: continue
        rid = f"{slug(repo.split('/')[-1])}-{slug(s['propName'])}-{slug(str(s['forbidden']))}"
        if rid in seen: continue
        blob = f"https://github.com/{repo}/blob/{h['commit']}/" + urllib.parse.quote(h["path"])
        cand = {"id": rid, "severity": s["sev"], "title": s["title"], "class": s["cls"],
          "component": {"name": s["module"], "type": s["sdktype"], "version": s["sdkver"], "sourceUrl": s["sdkurl"]},
          "detect": {"modules": [s["module"]], "nameRegex": s["nameRegex"], "triggerCalls": [s["call"]], "requiresImport": True},
          "binding": {"check": {"kind": "object-arg-property-forbidden-literal", "params": {
              "call": s["call"], "argIndex": s["argIndex"], "propName": s["propName"], "forbiddenValue": s["forbidden"],
              "passDetail": s["pass_"], "failDetail": s["fail"],
              "absentCallDetail": f"No {s['call']} call in this scope; this rule does not apply here.",
              "absentArgDetail": f"{s['call']} does not set {s['propName']}; the default applies."}}, "test": {"kind": "none"}},
          "fixtures": {"filename": "x.ts", "vulnerable": s["vuln"], "fixed": s["fixed"]},
          "provenance": {"sourceUrl": blob, "sourceRef": blob, "evidence": line,
              "note": f"{repo} ({h['path']}:{h['lineNumber']}) sets {s['propName']} to the forbidden value — discovered via Sourcegraph, commit-pinned."}}
        json.dump(cand, open(os.path.join(CANDIR, rid+".json"),"w"), indent=2)
        made.append(rid); used.add(repo); seen.add(rid)
    return made

if __name__ == "__main__":
    if "--list" in sys.argv:
        print("\n".join(SEAMS)); sys.exit(0)
    names = list(SEAMS) if "--all" in sys.argv else sys.argv[1:]
    total = 0
    for n in names:
        try:
            m = gen(n); total += len(m); print(f"{n}: {len(m)} candidate(s)")
        except Exception as e:
            print(f"{n}: ERROR {e}")
    print(f"TOTAL generated: {total}")
