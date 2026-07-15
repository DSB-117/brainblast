# Brainblast — The Roadmap

**Last updated:** 2026-07-15 · anchored at **v1.0.0** · single source of truth
(supersedes and replaces the former `GROWTH-ROADMAP.md` and
`ROADMAP-TRAINING-DATA.md`).

**North star:** Make AI-written code **correct-by-default** — and turn the proof of
every catch into the only **verifiable** code-security data asset in the world.

**The flywheel (why the lanes compound):** developers run the tool → it catches real
footguns → each catch is a **proven VTI** → the corpus deepens (the moat) → the corpus
(a) sharpens the tool, (b) sells as train/eval data, (c) pays contributors in $BRAIN →
more users + scouts → more catches. *A retrieval tool can't copy a proof.*

**State snapshot (2026-07-15):**
- **Engine:** live — research report + `report.json` + `--ci` gate + `/brainblast-verify`;
  deterministic auditor; **29 checkers**, multi-language, self-extending oracle gate.
- **Corpus:** **4,183 proven VTIs / 154 SDKs / 9 classes**, all RED→GREEN (class-skewed).
- **HiveMind:** shipped — federated second brain (sync, brief, enforce, experience,
  federation, `outbreak`, team + multi-machine hives).
- **Marketplace:** live self-serve (SOL/USDC/$BRAIN); public catalog/sample; signed-grant
  entitlement; metered usage; contributor rewards. Free sample live on Hugging Face.
- **$BRAIN/on-chain:** token live (access + rewards); Agent Wallet planned; Bittensor
  subnet designed (~$470k–$1.7M lock, not launched).

> Horizons are capability rungs, not a calendar: **Now** (this month) · **Next** (this
> quarter) · **Later** (the bets).

---

## Lane 1 — Engine & Tool  *(what developers touch)*
**Goal:** the default correctness layer for AI-written code — predict the silent failure,
prove it's gone, keep watching.

- **State:** Predict→Enforce shipped — 7-step research report, `report.json` (+ JSON
  Schema), `--ci` gate, `/brainblast-verify`, deterministic auditor, 29 checkers
  (multi-language, self-extending oracle gate). Watch/Compound partial.
- **Bet:** reposition from "pre-flight research" to **the guard layer for coding agents.**
  Measured this cycle: even a frontier model ships silent footguns a bare agent misses —
  Brainblast is the retrieved knowledge that closes it.
- **Now:** an **MCP / retrieval hook** so Cursor / Claude Code / Devin pull the relevant
  proven footgun *before* writing; package the eval harness as a repeatable
  **"score your model."**
- **Next:** **Watch** — re-research pinned dependencies on advisory/version change and
  reopen the gate; deepen checker coverage of the scarce classes (Lane 2).
- **Later:** **Compound** — every run auto-contributes its catches to the hive + corpus.
- **Working when:** wired into ≥1 agent IDE as a guard, and a third party reproduces the
  eval on their own model.

## Lane 2 — Corpus & Fleet  *(the data moat / supply)*
**Goal:** the deepest, best-balanced set of *proven* code footguns in existence.

- **State:** 4,183 proven VTIs / 154 SDKs / 9 classes, all RED→GREEN; turnkey fleet
  (scout → prove → git-less submit → reprove). Skewed: auth-bypass ~39%, wrong-constant a
  handful.
- **Bet:** value = proven-pairs × **class balance** × modality breadth — pour into the
  scarce, high-value classes the market pays for (oracle staleness, silent-revenue,
  slippage, wrong-constant), not more auth-bypass.
- **Now:** provision the **operator token** (lift the 60/hr submit ceiling); add a
  **class-budget gate** to the scout contract; run the new **staleness modality** wide.
- **Next:** new checker *shapes* via the oracle gate (behavioral / compiler-proven); more
  languages — **Python, Rust, Move**.
- **Later:** **10,000+ balanced** VTIs; corpus versioning + dated snapshots for buyers.
- **Working when:** no single class > 25% of the corpus, every bottom-5 class > 5%, and
  weekly net-new VTIs are climbing.

## Lane 3 — HiveMind  *(federation & community supply)*
**Goal:** make supply superlinear — every operator, agent, and team that runs Brainblast
feeds the corpus.

- **State:** shipped — shared second brain (sync, brief, enforce, experience, federation,
  **`outbreak`** propagation, team + multi-machine hives).
- **Bet:** the hive is a **supply network**, not just a cache. A footgun proven on one
  node should immunize every node — and land in the corpus.
- **Now:** open **community submission** (the work-weighted $BRAIN reward rail already
  exists); fire **`outbreak` alerts** when a new footgun is proven.
- **Next:** **team / enterprise hives** as a paid collaboration tier (private corpus +
  shared enforcement).
- **Later:** hive ⇄ Bittensor subnet = a permissionless global VTI supply.
- **Working when:** external contributors submit proven VTIs weekly and outbreak alerts
  fire across nodes.

## Lane 4 — Marketplace & GTM  *(demand / revenue)*
**Goal:** convert the moat into recurring revenue across channels.

- **State:** registry live (public catalog/sample, signed-grant entitlement, metered
  usage, contributor rewards); free sample live on Hugging Face; channel / Opendatabay /
  Ocean / Vana kits drafted; 4-model proof demo built.
- **Bet:** marketplaces (HF) = **funnel + credibility**; money is captured at the
  **license point** — registry self-serve for small deals, direct for commercial/
  enterprise. Lead every touch with the demo: *"the silent, money-losing footgun even a
  frontier model waves through."*
- **Now:** publish the **gated full-corpus** HF repo (turn downloads into leads); run the
  **first outreach wave** (web3/DeFi first, then AI-coding-assistants); stand up
  **eval-as-a-service** ("bring your model, get your number").
- **Next:** list the owned tier on **Opendatabay**; ship the **metered API**; open
  **enterprise pilots**.
- **Later:** **Ocean compute-to-data** for the wild tier (sell access without shipping
  bytes); multi-marketplace.
- **Working when:** first paid license closes and HF produces a steady flow of qualified,
  self-identified leads.

## Lane 5 — $BRAIN & On-chain  *(economy / incentives)*
**Goal:** a consumptive/work token economy that funds supply and access — without ever
looking like a security.

- **State:** $BRAIN live (access + standing discount + tier eligibility + contributor
  rewards); Agent Wallet planned (capped, Vault-recoverable); Bittensor subnet designed
  (checker = validator; ~$470k–$1.7M lock).
- **Bet:** **spend to use, earn for verifiable work.** No holder yield, no revenue-to-
  holders — rewards come from a fixed, sales-separated pool tied to *proven* work.
- **Now:** ship **contributor-reward payouts** on first-proof; keep the **sales and reward
  ledgers visibly separate**.
- **Next:** **curation bonds** — stake $BRAIN on a VTI's continued validity, slashable if
  it stops reproducing.
- **Later:** **Bittensor Path A** (mine/validate on an existing subnet) → own subnet when
  the 18% owner emission clears the lock on a modeled payback.
- **Working when:** contributors are paid for proven work and the spend↔earn loop runs
  without a human in the critical path.

---

## If we only do four things (cross-lane priorities, this month)

1. **Close first revenue** (Lane 4) — gated HF corpus + outreach + eval-as-a-service.
2. **Ship the agent-guard framing** (Lane 1) — the retrieval hook + public eval; it's the
   product the demo sells.
3. **Rebalance the corpus** (Lane 2) — operator token + class-budget; quality over count.
4. **Open community/hive supply** (Lane 3) — turn users into scouts.

**Next quarter:** Watch (Lane 1), metered API + Opendatabay (Lane 4), team/enterprise
tier (Lane 3), new checker modalities + languages (Lane 2), curation bonds (Lane 5).
**Later bets:** 10k balanced VTIs, Bittensor subnet, Ocean compute-to-data, multi-language.
