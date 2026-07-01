# The scout fleet

The engine that sources Verified Trap Instances (VTIs) **continuously**.

## Autonomous mode (run the `brainblast-fleet` skill)

You don't have to hand-author candidates. Run the **`brainblast-fleet`** skill and
your agent drives the whole loop — discover → scout → prove → promote → submit →
log:

```
discover   npm run fleet:discover -- --sdk <pkg>   # GitHub+npm → popular dependent repos, ledger-filtered
scout      (the skill fans out a SUBAGENT per repo to find footguns → fleet/candidates/)
prove      npm run fleet                            # RED→GREEN gate → packs/ (only real traps land)
log        npm run fleet:ledger -- --record fleet/worklist.json   # shared Supabase ledger; siblings skip these repos
```

The reasoning model is **whatever agent runs Brainblast** (no API key asked); the
deterministic gate (`proveFinding`) guarantees only reproducing traps land; the
shared ledger prevents two fleets scouting the same repo. See the
`brainblast-fleet` skill for the orchestration.

**Sharing the ledger across fleets.** Zero setup: the fleet reads/writes the
**open** shared ledger at `registry.brainblast.tech/api/fleet-ledger` — **no token,
no key**. You just push what you scouted; the **server keeps it honest** without
gating anyone: per-IP rate limit, GitHub repo verification (a new repo must exist
+ clear a stars bar), non-destructive trap merge (a submission can't erase another
fleet's finds), and a freshness TTL (`--max-age-days`, default 30) so a bad row
suppresses a repo for at most the window and stale repos get re-scouted. The
Supabase key lives only on the registry server. Override the registry with
`FLEET_REGISTRY_URL`; if it's unreachable the fleet uses a local cache.

## Manual mode (drop a candidate)

The fleet also runs over hand-written candidates — useful for a specific trap you
already know. One command:

```bash
cd packages/core
npm run fleet                 # discover → prove → promote → intake → score
npm run fleet -- --dry-run    # prove + score only (no promote, no intake)
npm run fleet -- --candidate fleet/candidates/<id>.json   # just one
```

It runs every candidate in `fleet/candidates/` through the **same RED→GREEN
proof** the corpus SLA enforces, **auto-promotes** the proven ones into `packs/`,
regenerates the corpus + storefront (`gen:vti → pack:dataset → corpus → catalog`),
and prints a **scoreboard**: what landed, what drafted (and why), the corpus
delta, and the **work-orders** — the class×SDK gaps to scout next. See
[`REPORT.md`](REPORT.md) after a run.

> Only traps that genuinely fail on the vulnerable fixture and pass on the fixed
> one ever land. A candidate that doesn't reproduce is reported as a DRAFT and
> never enters the corpus.

## Add a candidate (this is how you expand the fleet)

Drop a `fleet/candidates/<id>.json` — a **Finding**. The fastest, proof-friendly
shape uses an already-vetted checker (no new checker code needed). Minimal
template:

```jsonc
{
  "id": "my-sdk-insecure-flag",
  "severity": "high",                 // critical | high | medium | low
  "title": "one line — what's silently wrong",
  "class": "auth-bypass",             // the trap taxonomy (see below)
  "component": { "name": "the-sdk", "type": "Auth", "version": ">=1.0.0", "sourceUrl": "https://docs…" },
  "detect": { "modules": ["the-sdk"], "nameRegex": "verify|auth|client", "triggerCalls": ["doThing"] },
  "binding": {
    "check": {
      "kind": "object-arg-property-forbidden-literal",
      "params": {
        "call": "doThing", "argIndex": 0,
        "propName": "rejectUnauthorized", "forbiddenValue": false,
        "passDetail": "…", "failDetail": "…", "absentCallDetail": "…", "absentArgDetail": "…"
      }
    },
    "test": { "kind": "none" }
  },
  "fixtures": {
    "filename": "x.ts",
    "vulnerable": "…code where the property HAS the forbidden value…",
    "fixed":      "…same code with a safe literal (must PASS the checker)…"
  },
  "provenance": { "sourceUrl": "https://docs…", "note": "why agents ship this" }
}
```

Rules of the road:

- **`check.kind` must be a vetted checker** (run `npm run fleet -- --dry-run`; an
  unvetted kind drafts immediately). `object-arg-property-forbidden-literal` flags
  an options-object property set to a forbidden **string / number / boolean**
  literal — the shape of most insecure-default footguns. Other vetted kinds live
  in `packages/core/src/checkers/`.
- **The fixed fixture must PASS** the checker (set the property to a safe literal,
  not just omit it — an absent property is `cant_tell`, not GREEN).
- **Set `class`** to one of: `silent-zero-revenue`, `immutable-after-deploy`,
  `unchecked-staleness`, `auth-bypass`, `wrong-constant`, `unconfirmed-state`,
  `missing-slippage-guard`, `missing-verification`, `other`. If the keyword
  heuristic would mis-bucket it (the scoreboard prints a ⚠ class-drift warning),
  add `<id>: <class>` to `CLASS_BY_RULE` in `packages/core/src/vtiClass.ts`.
- **Beyond static shapes — the gate runs the generalized oracle.** A candidate
  isn't limited to shape-matching. Its `check.kind` can bind:
  - `compiles-against-sdk` — proves the trap by **type-checking against the pinned
    SDK** (catches a hallucinated / moved API — no shape needed, no code run).
  - `differential-io` — proves it by **behavior**: the vulnerable fixture produces
    the wrong output and the fixed one the right output, executed in the sandbox
    (semantic; also the path to other languages).
  The gate (`proveWithBest`) auto-routes by kind and records the winning `method`
  (plus any corroborating backends) on the scoreboard. Use these when a footgun
  can't be expressed as a static shape.
- A trap needing a **brand-new static checker shape** (not just a new value)?
  Propose a checker (Move 2). Add `fleet/checker-proposals/<kind>/` with
  `checker.ts` (exports `const checker`, imports only `ts-morph`), `candidate.json`
  (a Finding with `check.kind = <kind>`), and `negative/*.ts` (safe code it must
  NOT flag). Then `npm run fleet:checker-gate -- --proposal fleet/checker-proposals/<kind>`
  vets it — purity, proves the trap RED→GREEN, **zero false positives across the
  known-good corpus**, determinism. `--wire` installs it into `src/checkers/`; a
  human reviews the diff and commits to ratify. See
  `fleet/checker-proposals/array-property-contains-forbidden-literal/` for a worked
  example.

## Autonomy

The `brainblast-scout` skill produces candidates aimed at the work-orders the
scoreboard prints (uncovered classes + thin cells); this engine proves and lands
them. The loop — *gaps → scout → candidates → fleet → corpus grows → new gaps* —
is the continuous fleet. Run `npm run fleet` on whatever cadence you like
(manually, a pre-release hook, or a schedule); it's idempotent (already-promoted
candidates re-verify but don't duplicate).
