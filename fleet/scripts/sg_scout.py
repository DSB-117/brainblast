#!/usr/bin/env python3
"""Sourcegraph-driven VTI candidate generator — discovery with ZERO GitHub API use.

Sourcegraph streaming search returns repository + exact commit SHA + path + matched
line: a complete, commit-pinned provenance record. Each hit becomes a submittable
candidate deterministically. Supports five check kinds:
  objarg      object-arg-property-forbidden-literal   (options-object property literal)
  positional  positional-arg-forbidden-literal        (positional arg literal)
  absence     required-followup-call-missing          (trigger present, follow-up missing)
  cstgo       cst-struct-field-forbidden-literal      (Go struct field literal)
  cstsol      cst-member-access-forbidden             (Solidity member access)

The registry provenance gate requires the evidence line to (a) exist verbatim at the
pinned commit and (b) contain the trap target `propName ?? call` (undefined for
absence/cst → fabrication check only). `absence` additionally scope-checks the real
file so we only cite genuine missing-follow-up instances.

Usage: sg_scout.py <seam>[ ...] | --all | --list
"""
import json, re, sys, urllib.parse, urllib.request, os

CANDIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "candidates"))
COMMENT = re.compile(r"^\s*(//|\*|/\*|#|<!--|--)")
UA = {"User-Agent": "curl/8.4.0"}

def sg_search(pattern, lang, count=120):
    q = f"count:{count} lang:{lang} patterntype:regexp {pattern}"
    url = "https://sourcegraph.com/.api/search/stream?q=" + urllib.parse.quote(q)
    req = urllib.request.Request(url, headers={"Accept": "text/event-stream", **UA})
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

def raw_file(repo, commit, path):
    url = f"https://raw.githubusercontent.com/{repo}/{commit}/" + urllib.parse.quote(path)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode("utf-8", "replace")

def slug(s): return re.sub(r"[^a-z0-9]+","-",s.lower()).strip("-")

def existing_ids():
    ids = {f[:-5] for f in os.listdir(CANDIR) if f.endswith(".json")}
    try:
        with urllib.request.urlopen(urllib.request.Request("https://registry.brainblast.tech/api/vti", headers=UA), timeout=30) as r:
            for rec in json.load(r).get("records", []): ids.add(rec.get("trapId",""))
    except Exception: pass
    return ids

def ts_fx(imp, vuln_stmt, fixed_stmt):
    head = f'{imp}\n\nexport function handler(a: any, b: any, c: any) {{\n'
    return (head + f'  // VULNERABLE\n  {vuln_stmt}\n}}\n',
            head + f'  // FIXED\n  {fixed_stmt}\n}}\n')

# ---- seam constructors (each returns a dict consumed by gen) -----------------
def OBJ(pattern, module, sdktype, sdkver, sdkurl, cls, sev, call, argIndex, propName,
        forbidden, safe, nameRegex, title, fail, imp, vuln, fixed):
    v, f = ts_fx(imp, vuln, fixed)
    return dict(kind="objarg", lang="TypeScript", pattern=pattern, must=propName, module=module,
        sdktype=sdktype, sdkver=sdkver, sdkurl=sdkurl, cls=cls, sev=sev, call=call, argIndex=argIndex,
        propName=propName, forbidden=forbidden, nameRegex=nameRegex+"|handler", title=title, fail=fail,
        pass_=f"{propName} is not set to the forbidden value; the safe path applies.", vuln=v, fixed=f)

def POS(pattern, module, sdktype, sdkver, sdkurl, cls, sev, call, argIndex, forbidden, safe,
        nameRegex, title, fail, imp, vuln, fixed):
    v, f = ts_fx(imp, vuln, fixed)
    return dict(kind="positional", lang="TypeScript", pattern=pattern, must=call, module=module,
        sdktype=sdktype, sdkver=sdkver, sdkurl=sdkurl, cls=cls, sev=sev, call=call, argIndex=argIndex,
        forbidden=forbidden, nameRegex=nameRegex+"|handler", title=title, fail=fail,
        pass_=f"{call} arg[{argIndex}] is not the forbidden {forbidden!r}.", vuln=v, fixed=f, idkey=f"{call}-{forbidden}")

def ABS(pattern, module, sdkurl, cls, sev, trigger, required, nameRegex, title, fail, imp, vuln, fixed):
    v, f = ts_fx(imp, vuln, fixed)
    return dict(kind="absence", lang="TypeScript", pattern=pattern, must=trigger, module=module,
        sdktype="Blockchain", sdkver=">=1.0.0", sdkurl=sdkurl, cls=cls, sev=sev, trigger=trigger,
        required=required, nameRegex=nameRegex+"|handler", title=title, fail=fail,
        pass_=f"{trigger} is followed by {required[0]} in the same scope.", vuln=v, fixed=f, idkey=f"{trigger}-missing-{slug(required[0])}")

def GO(pattern, module, sdkurl, cls, sev, typeName, field, forbidden, safe, nameRegex, title, fail):
    pkg = "client"
    vuln = f'package {pkg}\n\nimport "{module}"\n\nfunc handler() *{typeName} {{\n\treturn &{typeName}{{{field}: {str(forbidden).lower()}}}\n}}\n'
    fixed = f'package {pkg}\n\nimport "{module}"\n\nfunc handler() *{typeName} {{\n\treturn &{typeName}{{{field}: {str(safe).lower()}}}\n}}\n'
    return dict(kind="cstgo", lang="Go", pattern=pattern, must=field, module=module, sdktype="Networking",
        sdkver=">=1.0.0", sdkurl=sdkurl, cls=cls, sev=sev, typeName=typeName, field=field, forbidden=forbidden,
        nameRegex=nameRegex, title=title, fail=fail, pass_=f"{typeName} sets {field} to a safe value.",
        vuln=vuln, fixed=fixed, idkey=f"{slug(typeName)}-{slug(field)}")

def SOL(pattern, cls, sev, obj, prop, nameRegex, title, fail, passd):
    vuln = ('// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\n\ncontract C {\n    address owner;\n'
            '    function handler() public view returns (bool) {\n'
            f'        return {obj}.{prop} == owner;\n    }}\n}}\n')
    fixed = ('// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\n\ncontract C {\n    address owner;\n'
             '    function handler() public view returns (bool) {\n'
             '        return msg.sender == owner;\n    }\n}\n')
    return dict(kind="cstsol", lang="Solidity", pattern=pattern, must=f"{obj}.{prop}", module="solidity",
        sdktype="SmartContract", sdkver=">=0.4.0", sdkurl="https://docs.soliditylang.org", cls=cls, sev=sev,
        obj=obj, prop=prop, nameRegex=nameRegex, title=title, fail=fail, pass_=passd,
        vuln=vuln, fixed=fixed, idkey=f"{obj}-{prop}")

SEAMS = {
 # ---- NEW object-arg seams: more SDKs / DeFi-EVM / classes ----
 "uniswap-v3-amount-out-min-zero": OBJ(r"amountOutMinimum:\s*0\b", "@uniswap/v3-sdk","DeFi",">=3.0.0",
   "https://docs.uniswap.org/sdk/v3/reference/overview","missing-slippage-guard","high",
   "exactInputSingle",0,"amountOutMinimum",0,1,"swap|exact|route|trade|execute",
   "amountOutMinimum: 0 on a Uniswap V3 swap sets zero minimum output — the trade accepts ANY amount out, so a sandwich/MEV bot can extract nearly the whole trade.",
   "amountOutMinimum: 0 on a Uniswap V3 swap accepts any output amount — zero slippage protection. A sandwich attack can move the price and take almost the entire trade. Compute a real minimum from a quote and tolerance.",
   'import { SwapRouter } from "@uniswap/v3-sdk";',
   'return a.exactInputSingle({ amountOutMinimum: 0 });', 'return a.exactInputSingle({ amountOutMinimum: 1 });'),

 "cookie-httponly-false": OBJ(r"httpOnly:\s*false", "express","Auth",">=4.0.0",
   "https://expressjs.com/en/api.html#res.cookie","auth-bypass","medium",
   "cookie",2,"httpOnly",False,True,"cookie|session|auth|res|set",
   "httpOnly: false lets client-side JavaScript read the cookie via document.cookie — an XSS can then steal the session token.",
   "httpOnly: false exposes the cookie to document.cookie, so any XSS can exfiltrate the session token. Set httpOnly: true for auth/session cookies.",
   'import express from "express";',
   'return a.cookie("session", b, { httpOnly: false });', 'return a.cookie("session", b, { httpOnly: true });'),

 "apollo-csrf-prevention-false": OBJ(r"csrfPrevention:\s*false", "@apollo/server","API",">=4.0.0",
   "https://www.apollographql.com/docs/apollo-server/security/cors","auth-bypass","medium",
   "ApolloServer",0,"csrfPrevention",False,True,"apollo|server|graphql|new|make",
   "csrfPrevention: false turns off Apollo's CSRF protection — a cross-site form/simple request can invoke mutations using the victim's cookies.",
   "csrfPrevention: false disables Apollo Server's CSRF protection, allowing cross-site simple requests to trigger authenticated mutations. Leave it enabled (default true).",
   'import { ApolloServer } from "@apollo/server";',
   'return new ApolloServer({ csrfPrevention: false });', 'return new ApolloServer({ csrfPrevention: true });'),

 "apollo-introspection-prod-true": OBJ(r"introspection:\s*true", "@apollo/server","API",">=4.0.0",
   "https://www.apollographql.com/docs/apollo-server/api/apollo-server","other","low",
   "ApolloServer",0,"introspection",True,False,"apollo|server|graphql|new|make",
   "introspection: true exposes the full GraphQL schema in production — attackers map every type, query, and mutation to find sensitive fields.",
   "introspection: true leaves the entire schema queryable in production, handing attackers a complete map of your API. Disable it outside development.",
   'import { ApolloServer } from "@apollo/server";',
   'return new ApolloServer({ introspection: true });', 'return new ApolloServer({ introspection: false });'),

 "jwt-allow-insecure-key-sizes-true": OBJ(r"allowInsecureKeySizes:\s*true", "jsonwebtoken","Auth",">=9.0.0",
   "https://github.com/auth0/node-jsonwebtoken","auth-bypass","high",
   "sign",2,"allowInsecureKeySizes",True,False,"sign|token|jwt|issue|auth",
   "allowInsecureKeySizes: true lets jwt.sign use an RSA key shorter than 2048 bits — a weak key that can be brute-forced to forge tokens.",
   "allowInsecureKeySizes: true permits sub-2048-bit RSA keys for signing, which are brute-forceable and let an attacker forge valid tokens. Remove it and use a 2048-bit+ key.",
   'import jwt from "jsonwebtoken";',
   'return a.sign(b, c, { allowInsecureKeySizes: true });', 'return a.sign(b, c, { allowInsecureKeySizes: false });'),

 "helmet-csp-false": OBJ(r"contentSecurityPolicy:\s*false", "helmet","Security",">=4.0.0",
   "https://helmetjs.github.io/","auth-bypass","medium",
   "helmet",0,"contentSecurityPolicy",False,True,"helmet|app|use|security|middleware",
   "contentSecurityPolicy: false disables the CSP header — the app loses its primary defense-in-depth against XSS and injected scripts.",
   "contentSecurityPolicy: false turns off the Content-Security-Policy header, removing the main mitigation for XSS/script injection. Configure a policy instead of disabling it.",
   'import helmet from "helmet";',
   'return a.use(helmet({ contentSecurityPolicy: false }));', 'return a.use(helmet({ contentSecurityPolicy: true }));'),

 "request-strict-ssl-false": OBJ(r"strictSSL:\s*false", "request","Networking",">=2.0.0",
   "https://github.com/request/request","auth-bypass","critical",
   "request",0,"strictSSL",False,True,"request|client|http|get|post|fetch",
   "strictSSL: false disables TLS certificate validation — the HTTP client accepts any certificate, enabling a man-in-the-middle.",
   "strictSSL: false turns off TLS certificate validation, so any certificate (including a MITM's) is accepted. Never disable it in production.",
   'import request from "request";',
   'return a.request({ url: b, strictSSL: false });', 'return a.request({ url: b, strictSSL: true });'),

 "electron-web-security-false": OBJ(r"webSecurity:\s*false", "electron","Desktop",">=10.0.0",
   "https://www.electronjs.org/docs/latest/tutorial/security","auth-bypass","high",
   "BrowserWindow",0,"webSecurity",False,True,"window|browser|create|electron|main",
   "webSecurity: false disables the same-origin policy in the renderer — remote content can read cross-origin data and load anything.",
   "webSecurity: false turns off the same-origin policy for the window, letting loaded content bypass CORS and read cross-origin resources. Keep it true.",
   'import { BrowserWindow } from "electron";',
   'return new BrowserWindow({ webSecurity: false });', 'return new BrowserWindow({ webSecurity: true });'),

 "http-insecure-parser-true": OBJ(r"insecureHTTPParser:\s*true", "node:http","Networking",">=13.0.0",
   "https://nodejs.org/api/http.html","auth-bypass","high",
   "request",0,"insecureHTTPParser",True,False,"request|client|http|proxy|server|get",
   "insecureHTTPParser: true accepts malformed headers — it re-enables lenient parsing that permits HTTP request smuggling past front-end proxies.",
   "insecureHTTPParser: true tolerates invalid/duplicate headers, opening the door to HTTP request smuggling and cache poisoning. Remove it.",
   'import http from "node:http";',
   'return a.request({ host: b, insecureHTTPParser: true });', 'return a.request({ host: b, insecureHTTPParser: false });'),

 "1inch-slippage-tolerance-zero": OBJ(r"slippageTolerance:\s*0\b", "@1inch/limit-order-protocol","DeFi",">=3.0.0",
   "https://docs.1inch.io/","missing-slippage-guard","high",
   "swap",0,"slippageTolerance",0,1,"swap|trade|route|execute|order",
   "slippageTolerance: 0 gives the swap no price-move tolerance — it reverts on any movement, or (worse, if enforced as min-out) fills with zero protection.",
   "slippageTolerance: 0 leaves the swap with no tolerance; depending on the SDK it either always reverts or provides zero MEV protection. Set a real tolerance from a quote.",
   'import { OrderBuilder } from "@1inch/limit-order-protocol";',
   'return a.swap({ slippageTolerance: 0 });', 'return a.swap({ slippageTolerance: 1 });'),

 # ---- positional-arg seams ----
 "crypto-md5": POS(r"createHash\(\s*[\"']md5[\"']\s*\)", "node:crypto","Crypto",">=0.10.0",
   "https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options","missing-verification","high",
   "createHash",0,"md5","sha256","hash|digest|sign|checksum|token|password",
   "createHash('md5') uses a broken hash — MD5 is collision-prone and unfit for integrity, signatures, or password/token derivation.",
   "createHash('md5') selects MD5, which is cryptographically broken (practical collisions). Any integrity check, signature, or token built on it can be forged. Use sha256 or stronger.",
   'import { createHash } from "node:crypto";',
   'return createHash("md5").update(a).digest("hex");', 'return createHash("sha256").update(a).digest("hex");'),

 "crypto-sha1": POS(r"createHash\(\s*[\"']sha1[\"']\s*\)", "node:crypto","Crypto",">=0.10.0",
   "https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options","missing-verification","high",
   "createHash",0,"sha1","sha256","hash|digest|sign|checksum|token|password",
   "createHash('sha1') uses SHA-1 — a broken hash with practical collisions, unfit for signatures or integrity.",
   "createHash('sha1') selects SHA-1, which has practical collision attacks and must not be used for signatures or integrity. Use sha256 or stronger.",
   'import { createHash } from "node:crypto";',
   'return createHash("sha1").update(a).digest("hex");', 'return createHash("sha256").update(a).digest("hex");'),

 # ---- absence-modality seams (viem) ----
 "viem-send-tx-no-receipt": ABS(r"\.sendTransaction\(", "viem",
   "https://viem.sh/docs/actions/wallet/sendTransaction","unconfirmed-state","high",
   "sendTransaction",["waitForTransactionReceipt"],"send|transfer|submit|execute|swap|mint|pay|withdraw|deposit",
   "sendTransaction result used without waitForTransactionReceipt — the hash is returned as if the transaction were mined.",
   "sendTransaction resolves to a transaction HASH at broadcast time, not at inclusion. This scope never calls waitForTransactionReceipt, so the hash is treated as a settled transfer. If the tx is dropped, reverts, or is replaced, downstream logic acts on a transaction that never landed. Await waitForTransactionReceipt({ hash }) and check receipt.status.",
   'import { createWalletClient } from "viem";',
   'const hash = await a.sendTransaction(b);\n  return hash;',
   'const hash = await a.sendTransaction(b);\n  return await c.waitForTransactionReceipt({ hash });'),

 "viem-write-contract-no-receipt": ABS(r"\.writeContract\(", "viem",
   "https://viem.sh/docs/contract/writeContract","unconfirmed-state","high",
   "writeContract",["waitForTransactionReceipt"],"write|call|execute|send|mint|approve|swap|stake|claim",
   "writeContract result used without waitForTransactionReceipt — the hash is treated as a confirmed state change.",
   "writeContract resolves to a transaction HASH the instant it is broadcast, not when it is mined. This scope never calls waitForTransactionReceipt, so a contract write is treated as applied when it may revert or be dropped. Await waitForTransactionReceipt({ hash }) and check receipt.status before acting on it.",
   'import { createWalletClient } from "viem";',
   'const hash = await a.writeContract(b);\n  return hash;',
   'const hash = await a.writeContract(b);\n  return await c.waitForTransactionReceipt({ hash });'),

 # ---- CST Go ----
 "go-insecure-skip-verify": GO(r"InsecureSkipVerify:\s*true", "crypto/tls",
   "https://pkg.go.dev/crypto/tls#Config","auth-bypass","critical",
   "tls.Config","InsecureSkipVerify",True,False,"client|tls|transport|dial|new|config|http",
   "tls.Config{InsecureSkipVerify: true} disables TLS certificate + host verification (MITM).",
   "tls.Config sets InsecureSkipVerify: true, turning OFF certificate and host-name verification. Any machine on the path can present a self-signed cert and silently MITM the connection. Remove it; for a private CA set RootCAs."),

 # ---- CST Solidity ----
 "sol-tx-origin-auth": SOL(r"tx\.origin", "auth-bypass","high","tx","origin",
   "withdraw|owner|only|auth|transfer|admin|require",
   "Authorization via tx.origin — a relaying contract the owner is tricked into calling passes the check (phishing).",
   "Authorization uses tx.origin, the ORIGINAL external account. If the owner is tricked into calling a malicious contract, that contract relays the call and this check passes. Use msg.sender.",
   "Authorization does not rely on tx.origin — msg.sender (the immediate caller) is the correct identity."),
}

def objarg_binding(s):
    return {"kind": "object-arg-property-forbidden-literal", "params": {
        "call": s["call"], "argIndex": s["argIndex"], "propName": s["propName"], "forbiddenValue": s["forbidden"],
        "passDetail": s["pass_"], "failDetail": s["fail"],
        "absentCallDetail": f"No {s['call']} call in this scope; this rule does not apply here.",
        "absentArgDetail": f"{s['call']} does not set {s['propName']}; the default applies."}}

def positional_binding(s):
    return {"kind": "positional-arg-forbidden-literal", "params": {
        "call": s["call"], "argIndex": s["argIndex"], "forbiddenValue": s["forbidden"],
        "passDetail": s["pass_"], "failDetail": s["fail"],
        "absentCallDetail": f"No {s['call']} call in this scope; this rule does not apply here.",
        "absentArgDetail": f"{s['call']} does not pass arg[{s['argIndex']}] as a literal."}}

def absence_binding(s):
    return {"kind": "required-followup-call-missing", "params": {
        "triggerCall": s["trigger"], "requiredCalls": s["required"],
        "passDetail": s["pass_"], "failDetail": s["fail"],
        "absentTriggerDetail": f"No {s['trigger']} call in this scope; this rule does not apply here."}}

def cstgo_binding(s):
    return {"kind": "cst-struct-field-forbidden-literal", "params": {
        "typeName": s["typeName"], "field": s["field"], "forbiddenValue": s["forbidden"],
        "passDetail": s["pass_"], "failDetail": s["fail"],
        "absentDetail": f"No {s['typeName']}{{ {s['field']}: ... }} literal in this scope; the secure default applies."}}

def cstsol_binding(s):
    return {"kind": "cst-member-access-forbidden", "params": {
        "object": s["obj"], "property": s["prop"], "failDetail": s["fail"], "passDetail": s["pass_"]}}

BINDING = {"objarg": objarg_binding, "positional": positional_binding, "absence": absence_binding,
           "cstgo": cstgo_binding, "cstsol": cstsol_binding}
TRIGGERS = {"objarg": lambda s: [s["call"]], "positional": lambda s: [s["call"]],
            "absence": lambda s: [s["trigger"]], "cstgo": lambda s: [s["typeName"]],
            "cstsol": lambda s: [f"{s['obj']}.{s['prop']}"]}
FILENAME = {"objarg": "x.ts", "positional": "x.ts", "absence": "x.ts", "cstgo": "x.go", "cstsol": "C.sol"}

def idkey(s):
    if s["kind"] == "objarg": return f"{slug(s['propName'])}-{slug(str(s['forbidden']))}"
    return slug(s["idkey"])

def gen(name):
    s = SEAMS[name]; seen = existing_ids()
    hits = sg_search(s["pattern"], s["lang"]); made=[]; used=set()
    for h in hits:
        line = h["line"]
        if COMMENT.match(line) or s["must"] not in line: continue
        repo = h["repo"]
        if repo in used: continue
        # absence: only cite lines where the required follow-up is genuinely absent nearby.
        if s["kind"] == "absence":
            try:
                lines = raw_file(repo, h["commit"], h["path"]).splitlines()
            except Exception:
                continue
            i = (h["lineNumber"] or 1) - 1
            window = "\n".join(lines[max(0, i-45): i+45])
            if any(rc in window for rc in s["required"]): continue
        rid = f"{slug(repo.split('/')[-1])}-{idkey(s)}"
        if rid in seen: continue
        detect = {"modules": [s["module"]], "nameRegex": s["nameRegex"], "triggerCalls": TRIGGERS[s["kind"]](s)}
        if s["kind"] in ("cstgo", "cstsol"): detect["lang"] = "go" if s["kind"]=="cstgo" else "solidity"
        if s["kind"] in ("objarg", "absence"): detect["requiresImport"] = True
        blob = f"https://github.com/{repo}/blob/{h['commit']}/" + urllib.parse.quote(h["path"])
        cand = {"id": rid, "severity": s["sev"], "title": s["title"], "class": s["cls"],
          "component": {"name": s["module"], "type": s["sdktype"], "version": s["sdkver"], "sourceUrl": s["sdkurl"]},
          "detect": detect, "binding": {"check": BINDING[s["kind"]](s), "test": {"kind": "none"}},
          "fixtures": {"filename": FILENAME[s["kind"]], "vulnerable": s["vuln"], "fixed": s["fixed"]},
          "provenance": {"sourceUrl": blob, "sourceRef": blob, "evidence": line,
              "note": f"{repo} ({h['path']}:{h['lineNumber']}) — {s['kind']} footgun, discovered via Sourcegraph, commit-pinned."}}
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
