# Clean-room VTI record — the sellable artifact

**Status:** spec · **Purpose:** define the record we license/sell, so the product
is legally defensible on *any* channel (Brainblast, Opendatabay, Vana, Ocean)
without a copyright cloud over the title.

---

## The one problem this solves

A VTI has three kinds of content with **different rights status**:

| Field | Who authored it | Rights status |
|---|---|---|
| `vulnerable.snippet` / `fixed.snippet` (fixtures) | **us** (fleet / gen-vti) — minimal repros | ours to license |
| `detail`, `title`, `class`, `redGreenProof`, checker binding | **us** | ours to license |
| the *pattern / lesson* itself | nobody — it's a fact | uncopyrightable |
| `provenance.evidence` (a verbatim line from a real repo) | **a third party** (the scanned repo, under MIT/GPL/Apache/none) | **NOT ours** |

Everything except `provenance.evidence` is already clean-room authored — even for
fleet submissions, the fixtures are *our* minimal repros, not the repo's code.
**The verbatim third-party line is the only exposure.** So the clean-room record
is the full VTI **minus the embedded verbatim snippet, plus a pointer** the buyer
can verify against the public source themselves.

## Provenance-by-reference (the core move)

Instead of *redistributing* a third-party line, the sold record **cites** it:

```jsonc
// SOLD payload (clean-room) — provenance is a verifiable POINTER, not a copy
"provenance": {
  "class": "wild",                       // "wild" | "synthetic-owned"
  "sourceRef": "owner/repo@<40-hex-sha>:path/to/file.ts#L42",
  "sourceUrl": "https://github.com/owner/repo/blob/<sha>/path/to/file.ts#L42",
  "evidenceSha256": "9f2c…",             // hash of the verbatim line — lets a buyer
                                          //   confirm the exact line WE matched without
                                          //   us shipping it
  "evidenceLen": 61,                      // length, for the fetch-and-slice check
  "capturedAt": "2026-07-14T…Z"
  // NOTE: no `evidence` string field in the sold payload
}
```

The buyer (or an auditor) verifies authenticity by fetching the public commit and
checking `sha256(line) == evidenceSha256`. They get **cryptographic proof the trap
is real and was found in the wild** — a *stronger* trust story than shipping the
line — while we never redistribute third-party code.

For `provenance.class == "synthetic-owned"` (seed + gen-vti records: authored
snippets, docs-cited) there is no third-party content at all — those ship as-is
and are the cleanest tier.

## The sellable record schema (`vti.cleanroom.v1`)

```jsonc
{
  "schemaVersion": "cleanroom-1.0",
  "trapId": "…",
  "title": "…",
  "sdk": { "name": "viem", "version": ">=2.0.0", "type": "EVM" },
  "severity": "high",
  "class": "missing-slippage-guard",
  // --- the trainable pair (OURS) ---
  "vulnerable": { "lang": "typescript", "code": "<authored minimal repro>", "detail": "…" },
  "fixed":      { "lang": "typescript", "code": "<authored minimal repro>", "detail": "…" },
  "lesson": "<one-paragraph description of the footgun + fix — the fact, in our words>",
  "generatedTest": "<authored test, if any>",
  // --- the proof (OURS, the moat) ---
  "redGreenProof": { "red": true, "green": true, "method": "static-checker",
                     "checkKind": "object-arg-property-forbidden-literal",
                     "verifiedAt": "…Z", "engineVersion": "brainblast@1.0.0" },
  // --- provenance BY REFERENCE (pointer + hash, never verbatim third-party code) ---
  "provenance": { "class": "wild", "sourceRef": "…@sha:path#L42", "sourceUrl": "…",
                  "evidenceSha256": "…", "evidenceLen": 61, "capturedAt": "…Z" },
  // --- licensing/consent envelope ---
  "rights": { "artifactLicense": "brainblast-training-1.0",
              "provenanceClass": "wild",           // drives the warranty we can give
              "contributorConsent": "opt-in:train+eval" },
  "corroborationCount": 2
}
```

## The transform (existing corpus → clean-room)

Deterministic, one function — `toCleanroom(vti)`:

1. Copy `trapId, title, sdk, severity, class`.
2. `vulnerable/fixed` ← the existing authored `snippet` (rename `snippet`→`code`) + `detail`.
3. `lesson` ← `vulnerable.detail` (already a prose description of the footgun+fix).
4. `redGreenProof` ← as-is (+ stamp `engineVersion`).
5. **provenance:** if the source is a repo (`sourceRef`/`evidence` present):
   - emit `sourceRef`, `sourceUrl`, `evidenceSha256 = sha256(evidence)`, `evidenceLen`;
   - **drop the `evidence` string.** Set `class:"wild"`.
   else (docs-cited synthetic record): set `class:"synthetic-owned"`, keep `sourceUrls`.
6. `rights.provenanceClass` ← the class from step 5.

A record where step 5 can't produce a pinned SHA is **held back from the sold set**
(we only sell what we can prove is real by reference).

## Two product tiers fall straight out of `provenanceClass`

- **Owned tier** (`synthetic-owned`): authored fixtures, docs-cited, zero third-party
  content. **General + Commercial AI License, unrestricted.** This is what goes on
  external marketplaces first.
- **Wild tier** (`wild`): authored fixtures + verifiable pointer. Sold with the
  provenance-by-reference model; the buyer fetches source themselves. Slightly
  narrower warranty (see DATA-LICENSE.md) but higher value (real, corroborated,
  fresh). Sell on Brainblast direct + Ocean compute-to-data first; add to open
  marketplaces after counsel signs off on the by-reference model.

## Validator (ship with the exporter)

`cleanroom-validate` fails the record (never sold) if any of:
- a `provenance.evidence` **string** survived into a sold payload (leak of third-party code);
- `sourceRef` doesn't pin a 40-hex SHA;
- `evidenceSha256` doesn't match `sha256` of the line fetched at `sourceUrl` (dead/forged pointer);
- `redGreenProof.red && redGreenProof.green` is not both true;
- `vulnerable.code`/`fixed.code` contain a token-for-token span ≥ N chars matching
  the fetched source line (defensive: catches a fixture that accidentally copied the repo).

## Why this is the right call

- **Legal:** we license only what we author + facts; third-party code is referenced, not shipped.
- **Trust:** hash-pinned, buyer-verifiable provenance beats "trust our snippet."
- **Reuses everything:** the authored fixtures + RED→GREEN proof already exist for every VTI.
- **One flag** (`provenanceClass`) cleanly splits the unrestricted-license product from the by-reference one.
