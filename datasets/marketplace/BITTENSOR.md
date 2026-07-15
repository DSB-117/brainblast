# Bittensor — selling verified code-training data as a subnet

**Status:** design + runnable scaffold. **Not legal/financial advice** — subnet
economics touch token classification; see [BRAIN-UTILITY.md](BRAIN-UTILITY.md).

The one-line thesis: **Brainblast is the rare data source whose quality is
machine-checkable.** Every VTI ships a deterministic RED→GREEN receipt. That is
*exactly* the thing Bittensor subnets are starved for — an objective, cheap,
non-gameable validation function. Most subnets burn enormous effort approximating
"is this output good?" with embeddings, LLM judges, and reference sets. Brainblast
already answers it with a checker that either fails the vulnerable code and passes
the fixed code, or it doesn't. **The validator is already built.**

This doc covers (1) how Bittensor pays, (2) the honest cost reality, (3) the two
paths — contribute now vs. own-subnet later, (4) the subnet incentive design, and
(5) the scaffold in [`integrations/bittensor/`](../../integrations/bittensor/).

---

## 1. How Bittensor pays (dTAO era, 2026)

- A **subnet** defines a task. **Miners** produce a commodity; **validators** score
  it; the **subnet owner** defines the incentive mechanism (the scoring code).
- Per-block emissions on each subnet split **41% miners / 41% validators / 18%
  owner**. Emissions are denominated in the subnet's own **alpha token** (dTAO):
  each subnet has an alpha/TAO liquidity pool, and the network routes more TAO
  emission to subnets whose alpha is in demand (capital follows perceived value).
- As of 2026 there are ~128+ active subnets; combined subnet-token market cap is on
  the order of ~$1.4B. Data subnets exist and work (e.g. **SN24 / OMEGA Labs**, a
  multimodal video dataset where validators score miner submissions on relevance +
  novelty and periodically push validated batches to Hugging Face).
- **Where the money is for us:** owning a subnet means capturing the **18% owner
  emission** in perpetuity plus alpha-token appreciation if the subnet is valued.
  Running a validator earns a share of the 41% validator emission. Mining earns a
  share of the 41% miner emission. All three are ways to convert Brainblast's data +
  checker into TAO-denominated income — *if* the numbers work.

Sources: [Understanding Subnets](https://docs.learnbittensor.org/subnets/understanding-subnets),
[Validating in Bittensor](https://docs.learnbittensor.org/validators),
[How to build on Bittensor in 2026](https://avark.agency/learn/how-to-build-on-bittensor-in-2026-the-complete-guide-to-launching-on-the-decentralized-ai-network),
[OMEGA Labs subnet](https://github.com/omegalabsinc/omegalabs-bittensor-subnet),
[Code-generative subnets](https://matthewkaras.medium.com/code-generative-subnets-for-bittensor-fa3efdf5bf5a).

## 2. The cost reality (why we don't just launch a subnet tomorrow)

Registering a **new subnet** costs the dynamic **`lock_cost`** in TAO, which floats
with demand: historically ~1,500–3,420+ TAO. At 2026 TAO prices that is roughly
**$470k–$1.7M**, and it is burned/locked, not a deposit you keep. That is the single
hard gate. Everything below is designed around it: **prove the mechanism and the
income on rented surface first, buy the subnet slot only when the 18% owner emission
clears the lock cost on a modeled payback.**

## 3. Two paths (do Path A now, graduate to Path B on evidence)

### Path A — contribute to / validate on an existing data subnet (weeks, ~$1k–$10k)
The OMEGA/SN24 model is a data-collection subnet: miners submit data, validators
verify + score, validated batches get published. Brainblast fits as either side:

- **Mine:** run a Brainblast miner that submits VTIs (the fleet already produces
  them) to a data subnet that accepts code/security data, earning miner emission.
- **Validate-as-a-service:** offer Brainblast's checker as the *scoring oracle* for a
  code-focused subnet (e.g. code-generation subnets like the Ridges/SWE-style ones).
  Our deterministic RED→GREEN grade is a strictly better validator than an LLM judge.
- **Partner:** approach a data-subnet owner and propose a "verified-code" data class
  scored by our checker, in exchange for a cut of owner/validator emission.

Path A needs **no subnet lock**, proves demand for the data on a live network, and
generates the operating history that justifies Path B. Start here.

### Path B — the Brainblast subnet (own the 18%, when justified)
Register a subnet whose commodity **is** the VTI and whose validator **is** the
RED→GREEN checker. This is the ideal structural fit — see §4 — but only pull the
trigger when a spreadsheet shows the 18% owner emission (at a conservative alpha
price) repays the lock cost inside an acceptable window. The scaffold in this repo
is the deployable codebase for that day; it also runs today on **localnet** for
development and demos, and its scoring module is reused by Path A's validator role.

## 4. The Brainblast subnet — incentive design

**Commodity:** a candidate VTI — an authored `vulnerable`/`fixed` fixture pair, a
`class`, a checker `binding`, and provenance (a commit-pinned pointer + SHA-256 of
the matched upstream line; never the verbatim upstream code — see
[CLEANROOM-SPEC.md](CLEANROOM-SPEC.md)).

**Miner** (`miner.py`): serves candidate VTIs on request. A miner is really a fleet
scout wrapped in a neuron — it sources footguns from public code, authors the
minimal-repro fixtures, and returns them over the `VTISynapse`.

**Validator** (`validator.py` + `scoring.py`): the crux. For each submitted
candidate it computes an **objective score in [0,1]** from facts, not opinion:

1. **Proof gate (pass/fail, hard).** Run the candidate's own checker (the production
   `auditWithRule` engine). It must **FAIL the vulnerable fixture and PASS the fixed
   fixture** — RED→GREEN. Fail ⇒ score 0. No proof, no reward. This alone makes the
   subnet un-gameable: you cannot farm emission with garbage because the checker is
   deterministic and runs on the validator's own machine.
2. **Provenance gate (pass/fail, hard).** The cited evidence line must actually
   contain the trap target (the forbidden literal/prop/call), and the SHA-256 must
   match. Fabricated provenance ⇒ score 0.
3. **Novelty (continuous).** 1 − max-similarity to VTIs already in the validated set
   (by class + checker-kind + normalized fixture). Re-submitting a known trap earns
   ~0. This is the OMEGA "novelty vs. the index" idea, but over *proven* traps.
4. **Class-balance bonus (continuous).** Up-weight under-represented classes
   (wrong-constant, staleness, immutable, revenue, slippage) and down-weight
   saturated ones (auth-bypass). Encodes the corpus-value = class-balance principle
   ([memory: class-balance-over-count]).
5. **Corroboration (continuous).** Independent repos exhibiting the same pattern add
   a small weight (real-world prevalence = training value).

`weight = proof_gate · provenance_gate · (w_n·novelty + w_b·balance + w_c·corrob)`.
Validators set on-chain weights ∝ Σ weight over each miner's accepted submissions;
Yuma consensus turns that into emission. **Validated VTIs flow straight into the
Brainblast corpus** (same `/api/vti` ingest + reprove the fleet already uses), so the
subnet is a *decentralized, tokenized fleet*: TAO/alpha emission replaces the fixed
$BRAIN reward pool as the supply incentive.

**Why this is defensible:** the validation is cheap (static check, no GPU for most
classes — contrast OMEGA's 10–24GB VRAM requirement), fully deterministic
(validators agree, so consensus is tight and low-variance), and impossible to spoof
(the checker is the ground truth). Subnets live or die on validator quality;
Brainblast's is a solved problem.

### $BRAIN / securities boundary (read before shipping)
The subnet's native incentive is **alpha/TAO**, per Bittensor. $BRAIN stays the
Brainblast-side access + work-reward rail. Do **not** wire subnet emissions into
$BRAIN holder payouts, and do **not** market the subnet as an "investible" $BRAIN
yield — that is the bright line in [BRAIN-UTILITY.md](BRAIN-UTILITY.md). A subnet is
owner/validator/miner *work* income; keep it framed and accounted that way.

## 5. What's in the scaffold

[`integrations/bittensor/`](../../integrations/bittensor/) is a complete, deployable
subnet codebase (Python, `bittensor` SDK):

| File | Role |
|---|---|
| `brainblast_subnet/protocol.py` | `VTISynapse` — the miner↔validator wire type |
| `brainblast_subnet/scoring.py` | the objective scoring function (§4) — **the reusable core**, no chain deps |
| `brainblast_subnet/validator.py` | validator neuron: query miners → score → set weights |
| `brainblast_subnet/miner.py` | miner neuron: serve candidate VTIs (wraps a fleet scout / candidate queue) |
| `brainblast_subnet/proof.py` | RED→GREEN + provenance gate — shells to the production checker |
| `requirements.txt`, `min_compute.yml`, `.env.example` | deploy surface |
| `README.md` | localnet bring-up, mainnet registration checklist, cost gate |

`scoring.py` and `proof.py` are **pure** (no `bittensor` import) so they are unit-
testable and are exactly what Path A's validate-as-a-service role calls. You can run
`python -m brainblast_subnet.scoring --demo` to score a sample candidate with no
chain at all.

## 6. Do-now checklist

- [ ] Path A: identify 1–2 live data/code subnets that would accept verified-code
      data or our checker as an oracle; run a miner or pitch validate-as-a-service.
- [ ] Stand up the scaffold on **localnet**; wire `proof.py` to the real
      `packages/core` checker; demo miner→validator→weights end-to-end.
- [ ] Model the Path B payback: `lock_cost` in TAO vs. projected 18% owner emission
      at a conservative alpha price. Only register when payback is credible.
- [ ] Securities review of the subnet↔$BRAIN boundary before any public launch.
