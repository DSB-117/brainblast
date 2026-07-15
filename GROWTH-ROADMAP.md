# Brainblast growth roadmap — to 10,000+ high-quality VTIs

**Baseline (2026-07-15, from `/api/catalog`):** 4,125 VTIs, all proven, 149 SDKs, 9
classes. **Gap to target: ~5,900 VTIs.** But "high-quality" ≠ "more of the same" —
the corpus is class-skewed and that, not raw count, is the real constraint.

```
class distribution today          target shape (balanced, high-value)
  auth-bypass          1624  39%    ← OVERSUPPLIED. stop feeding it.
  missing-verification  971  24%
  other                 743  18%
  unconfirmed-state     339
  missing-slippage-guard 237
  silent-zero-revenue    83        ← scarce, high training value
  unchecked-staleness    78        ← scarce
  immutable-after-deploy 47        ← scarce
  wrong-constant          3        ← nearly EMPTY. highest marginal value.
```

**The thesis:** value = proven pairs × class balance × modality breadth. We hit 10k
by (A) pouring supply into the bottom-5 classes and new modalities, not auth-bypass;
(B) automating the fleet + federating HiveMind so supply scales without linear human
effort; (C) turning buyers and contributors into a flywheel. Reaching 10k of *these*
is worth far more than 10k more tx.origin traps.

---

## Three growth engines

### Engine 1 — Supply: fleet automation + new checker modalities
The fleet already produces proven VTIs from public code. The two ceilings are
GitHub code-search rate limits (~10/min shared) and the `/api/vti` cap (60/hr per IP).

- **Lift the throughput ceiling.** Provision an **operator token** for `/api/vti`
  (removes 60/hr cap) and rotate GitHub tokens / use `git clone` discovery (already
  proven to bypass the code-search limit). Target: 200–400 proven VTIs/week.
- **Rebalance, don't refill.** Enforce a **class budget** in the scout contract:
  refuse to submit auth-bypass unless the batch also lands ≥2 bottom-5-class VTIs.
  ([memory: class-balance-over-count] — never run `sg_scout --all`.)
- **New modalities = new supply that doesn't saturate.** Every new checker shape
  opens a fresh, unsaturated seam:
  - `wrong-constant` (chain IDs, decimals, fee bps, magic addresses) — corpus has 3.
  - `unchecked-staleness` (oracle `updatedAt`, TWAP windows, deadline misuse).
  - `immutable-after-deploy` (constructor-set criticals, missing setters).
  - behavioral/compiler-proven traps via the generalized proof gate
    ([memory: fleet-generalize-proof-gate-plan]) — unlocks multi-language + runtime
    footguns the static checker can't reach.
  - more languages: Python (web3.py, boto3), Rust (non-Anchor), Go (already live),
    Move/Sui, Vyper.
- **Coverage math:** 149 SDKs today. The top-200 SDKs × ~5 distinct footgun classes
  each × real corroboration = a 10k+ ceiling on supply alone, *if* balanced.

### Engine 2 — Scale: HiveMind federation + community contribution
Supply that depends only on our own fleet is linear. Federation makes it superlinear.

- **HiveMind as a supply network.** The hive (`~/.brainblast/hive`, sync/brief/
  enforce/experience/stats — [memory: brainblast-hivemind-v0100]) lets multiple
  operators/agents scout in parallel and pool proven VTIs. Each new node adds supply
  without central effort; `enforce` keeps quality uniform.
- **Community contribution rail (already built).** The contributor-reward emitter
  pays work-weighted $BRAIN on first proof + survive-reprove
  ([BRAIN-UTILITY.md](datasets/marketplace/BRAIN-UTILITY.md)). Open submission via
  `/api/vti` + `prove-one.ts` so anyone can contribute and get paid for *proven*
  work only. This turns the corpus into a public good with a paid supply side.
- **Bittensor subnet = federation with TAO incentives.** The same submit→prove→
  reward loop, but emission-funded and permissionless
  ([BITTENSOR.md](datasets/marketplace/BITTENSOR.md)). Miners scout, the checker
  validates, validated VTIs flow into the corpus. This is the largest potential
  supply multiplier — a global crowd mining VTIs for alpha.
- **Quality bar holds automatically.** Every path — fleet, community, hive, subnet —
  goes through the *same* RED→GREEN + provenance gate. Scale never dilutes quality
  because junk scores 0 everywhere.

### Engine 3 — Demand & users: the flywheel that funds supply
Supply needs a reason to grow; demand + contributors are it.

- **Lead with the eval number.** `bench/footgun-eval` produces the one metric that
  sells: how much training on the corpus cuts a model's footgun rate. Publish it;
  put it on every channel card ([CHANNELS.md](datasets/marketplace/CHANNELS.md)).
- **Free sample → paid funnel.** HF/Kaggle receipt-only sample (reach) → registry
  self-serve (revenue) → direct enterprise/lab (margin). Each buyer validates the
  data's worth and funds more scouting.
- **Buyers become contributors.** A lab that buys a lot has footguns we don't cover;
  a "sponsor a class/SDK" bounty (paid from the reward pool) turns demand into
  targeted supply for exactly the classes/SDKs the market wants.
- **Users via HiveMind + the tool.** Brainblast's `/brainblast` research skill and
  the checker CLI are the top-of-funnel: developers adopt the tool → run it on their
  code → surface + contribute footguns → grow both users and corpus.

---

## Milestones (count + balance + channels move together)

| Phase | VTIs | What ships | Balance goal | Channel |
|---|---|---|---|---|
| **P0 — now** | 4,125 | operator token; class budget in scout contract | freeze auth-bypass growth | registry live; HF sample |
| **P1** | ~5,500 | `wrong-constant` + `staleness` + `immutable` checkers; rebalance waves | bottom-5 classes → ~25% of corpus | Opendatabay (owned) + eval published |
| **P2** | ~7,000 | generalized proof gate (behavioral/compiler); Python + Rust supply | ≥3 languages, ≥200 SDKs | metered API + eval-as-benchmark |
| **P3** | ~8,500 | HiveMind federation on; community submission open + paid | no class > 25% of corpus | Ocean C2D (wild tier) + direct enterprise |
| **P4 — 10k+** | **10,000+** | Bittensor Path A (oracle/miner) feeding corpus | balanced across 9+ classes, 300+ SDKs | subnet supply; token-native channels (gated) |

## The single highest-leverage move

**Provision the operator token + enforce the class budget, this week.** It
simultaneously (a) removes the submit-rate ceiling that currently paces every wave
and (b) redirects that lifted throughput into the scarce classes instead of
auth-bypass. Everything else compounds on top of a fleet that can finally run at
speed *and* in the right direction.

## What to build next (concrete, in priority order)

1. Operator token for `/api/vti`; class-budget gate in `SCOUT-ANY.md` /
   `fleet-checker-gate.ts` (refuse auth-bypass-heavy batches).
2. `wrong-constant` + `unchecked-staleness` + `immutable-after-deploy` checker
   shapes (highest marginal corpus value — currently 3/78/47).
3. Wire the generalized proof gate (`proveFinding → proveWithBest`) to admit
   compiler/behavioral traps ([memory: fleet-generalize-proof-gate-plan]).
4. Publish the eval number + HF sample; list owned tier on Opendatabay.
5. Turn on HiveMind federation + open community submission (reward rail is built).
6. Bittensor Path A: run the scaffold as an oracle/miner on an existing subnet.
