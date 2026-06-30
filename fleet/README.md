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
no key**. You just push what you scouted and the **server validates** it
(well-formed `owner/repo`, trap-id shape, capped size). The Supabase key lives
only on the registry server. Point at a different registry with
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
- A trap needing a **new checker shape** is a larger task (add a checker in
  `src/checkers/`, register it, test it) — out of scope for a one-file candidate.

## Autonomy

The `brainblast-scout` skill produces candidates aimed at the work-orders the
scoreboard prints (uncovered classes + thin cells); this engine proves and lands
them. The loop — *gaps → scout → candidates → fleet → corpus grows → new gaps* —
is the continuous fleet. Run `npm run fleet` on whatever cadence you like
(manually, a pre-release hook, or a schedule); it's idempotent (already-promoted
candidates re-verify but don't duplicate).
