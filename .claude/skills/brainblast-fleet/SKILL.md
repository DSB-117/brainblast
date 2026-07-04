---
name: brainblast-fleet
version: 0.1.0
description: Autonomous VTI sourcing. Discovers popular repositories that depend on a target SDK, fans out a fleet of subagents to scout each one for silent footguns, proves every candidate RED→GREEN, auto-promotes the proven ones into the corpus, logs results to the shared ledger so other fleets skip them, and reports. Run it instead of hand-authoring candidates.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Agent
  - WebFetch
  - WebSearch
triggers:
  - run the fleet
  - brainblast fleet
  - scout repositories
  - source new VTIs
  - grow the corpus
---

# Brainblast Fleet

The autonomous successor to hand-dropping candidates. You (the orchestrating
agent) run this skill; it **fans out a fleet of subagents** — one per repository —
to do the scouting, then the deterministic engine proves, promotes, submits, and
logs. The model doing the reasoning is **whatever agent is running Brainblast**
(this one) — no API key is requested.

The non-negotiable invariant: **only traps that prove RED→GREEN through the
existing checkers ever land.** Subagents propose; `proveFinding` disposes.

Run from `packages/core/`. Five phases.

## Phase 0 — Pick targets

If the user named SDKs/protocols, use them. Otherwise read the work-orders the
last run left — `cat ../../fleet/REPORT.md` or `datasets/COVERAGE.md` — and target
the **uncovered classes** and **thin cells**, freshness-first (recently-shipped
or high-download SDKs, where models are most stale).

## Phase 1 — Discover (deterministic)

For each target SDK:

```bash
npm run fleet:discover -- --sdk <pkg> --limit 10 --min-stars 200
```

Writes `fleet/worklist.json` (popular dependent repos, ranked by stars, already
filtered against the shared ledger so you don't re-scout what another fleet did).
Read it. If it's empty, the ledger says everything popular here is already done —
pick another SDK.

## Phase 2 — Scout (fan out the subagent fleet)

For each repo in the worklist, **spawn a subagent** (the `Agent` tool,
`general-purpose`). Launch them in parallel batches (e.g. 3–5 at a time). Give
each subagent EXACTLY this contract:

> Scout `<owner/repo>` for a **silent integration footgun** in its use of
> `<sdk>`: code where the happy path compiles and runs but does the wrong thing
> (an insecure-default flag, a zeroed fee/amount, a skipped verification, a wrong
> constant). Shallow-clone read-only (`git clone --depth 1`) into a temp dir.
> For each real footgun you find that fits an existing brainblast checker
> (`object-arg-property-forbidden-literal` is the workhorse — an options-object
> property set to a forbidden string/number/boolean literal), write a candidate
> Finding to `fleet/candidates/<id>.json` following `fleet/README.md`. The
> `vulnerable` fixture must contain the forbidden value; the `fixed` fixture must
> set a safe literal (so it PASSES). Set `class`. **Capture provenance from the
> real code** — the registry requires it: record the exact `git rev-parse HEAD` of
> the shallow clone and, in the candidate's `provenance`, set `sourceRef` to
> `github.com/<owner>/<repo>/blob/<that-sha>/<path>` and `evidence` to the verbatim
> vulnerable line as it appears in the file. Without a real, fetchable sourceRef +
> evidence the finding can only enter the repo seed corpus, never the registry.
> **Do not fabricate** — if the repo has no provable footgun, write nothing and
> report "clean". Return: repo, the candidate ids you wrote (or "clean"), and a
> one-line note per finding.

Collect each subagent's report (repo → candidate ids / clean).

## Phase 3 — Prove + promote (deterministic gate)

```bash
npm run fleet
```

This proves every candidate RED→GREEN, **auto-promotes the proven** into `packs/`,
regenerates the corpus + storefront, and prints the scoreboard. Candidates that
don't reproduce are reported DRAFT and never land — that is the safety rail that
makes autonomous sourcing safe. Then confirm integrity:

```bash
npm run sla   # must be green (100% reproduce) before anything is submitted
```

## Phase 4 — Submit + log

**Submit via the git-less API (the standard default). No push, no branch, no PR.**
The corpus is grown by POSTing each proven candidate to the registry's `/api/vti`
ingest, which **re-proves it RED→GREEN server-side** and inserts it into the corpus
database. The client is never trusted; a non-reproducing or secret-bearing
submission is rejected with reasons. Ingest is **idempotent** — resubmitting an
existing trap returns `duplicate: true` and no-ops, so it is safe to re-run.

**The registry requires verified provenance — it only accepts REAL finds.** Each
submission must include `provenance.sourceRef` (a commit-pinned GitHub URL, e.g.
`github.com/owner/repo/blob/<40-hex-sha>/path` — a branch ref is rejected) and
`provenance.evidence` (a verbatim snippet of the vulnerable line). The server
fetches that exact file at that exact commit and confirms the evidence is present;
if it 404s or the line isn't there, the submission is rejected. **This means the
Phase 2 scouts MUST capture the commit SHA + the exact vulnerable line** when they
find a footgun — a candidate without real, fetchable provenance cannot enter the
registry (only the repo seed corpus below accepts un-sourced/authored traps).

First check what the registry already has (so you only send new ones), then submit
each newly-promoted candidate:

```bash
# what's already in the registry
curl -s "${FLEET_REGISTRY_URL:-https://registry.brainblast.tech}/api/vti" | jq '.count, [.records[].id]'

# dry-run the SAME gate locally first (nothing sent), then submit for real
npm run submit:vti -- --candidate fleet/candidates/<id>.json --dry-run
npm run submit:vti -- --candidate fleet/candidates/<id>.json
```

Loop over the candidates promoted this run. `FLEET_REGISTRY_URL` overrides the
endpoint; `BRAINBLAST_INGEST_TOKEN` supplies the Bearer token if the registry
requires one. If any submission is rejected, **stop and report** its reasons — do
not hand-edit a fixture to force it through.

**Optional — repo seed corpus (only when explicitly asked).** Committing the
generated `packs/` + `datasets/` and opening a PR changes the *bundled* corpus
that ships in the repo. This is a heavier, separate destination from the registry
and is **not** part of the default flow. Do it only when the operator explicitly
wants the seed corpus updated (e.g. a release); otherwise the API submission above
is all that's needed and **no git push is required**.

**Log to the shared ledger** so sibling fleets skip these repos:

```bash
npm run fleet:ledger -- --record fleet/worklist.json
```

Writes the registry's **open** `/api/fleet-ledger` (default
`registry.brainblast.tech` — no token, no key; the server validates the payload),
falling back to the local `fleet/ledger-cache.json` that discovery reads. Record
every scouted repo — clean ones too, so they're not re-scouted.

## Phase 5 — Report

Summarize: targets, repos scouted, candidates proven vs drafted, corpus delta,
newly-covered classes, and the next work-orders (from the scoreboard) for the
following run. Per-repo detail lives in `fleet/REPORT.md`.

---

**Honesty & safety**
- The proof gate is absolute: never promote or submit a VTI that didn't go
  RED→GREEN, and never hand-edit a fixture to force it. A non-reproducing
  candidate is a DRAFT, full stop.
- Subagents read code; they don't run untrusted code. Clone `--depth 1`,
  read-only, and never execute a scouted repo's scripts.
- The ledger prevents redundant work across fleets — always record at the end.
