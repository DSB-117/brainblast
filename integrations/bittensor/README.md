# Brainblast subnet (Bittensor)

Deployable subnet codebase where the **commodity is a verified VTI** and the
**validator is Brainblast's deterministic RED→GREEN checker**. Design, economics, and
the cost gate: [`datasets/marketplace/BITTENSOR.md`](../../datasets/marketplace/BITTENSOR.md).

Why this is a strong subnet: validation is objective, cheap (static check, **no
GPU**), and un-gameable — the checker is the ground truth, so validators agree and
consensus is tight. That is the hard part of running a subnet, already solved.

## Layout

```
brainblast_subnet/
  scoring.py     # PURE core: proof gate + provenance gate + novelty/balance/corrob → weight
  proof.py       # RED→GREEN gate — shells to packages/core (the production checker)
  protocol.py    # VTISynapse — miner↔validator wire type (needs bittensor)
  validator.py   # validator neuron: query miners → score → set weights → forward to registry
  miner.py       # miner neuron: serve locally-proven candidate VTIs (wraps a fleet scout)
tests/
  test_scoring.py  # 10 tests, stdlib-only, no chain/engine needed
requirements.txt · min_compute.yml · .env.example
```

`scoring.py` and `proof.py` are **chain-free** — importable without `bittensor`, so
they're unit-testable and reusable as a "validate-as-a-service" oracle for an
existing code/data subnet (Path A in BITTENSOR.md).

## Try the core with no chain

```bash
cd integrations/bittensor
python3 tests/test_scoring.py          # → 10 passed
python3 -m brainblast_subnet.scoring --demo   # scores a fresh vs duplicate vs saturated candidate
```

## Wire the real proof gate

`proof.prove()` shells to the production engine:

```bash
export BRAINBLAST_CORE_DIR=../../packages/core   # has scripts/prove-one.ts
# validator now grades every candidate with the same checker the fleet + registry use
```

If the engine isn't present the validator **fails closed** (score 0, never a false
accept).

## Localnet bring-up (development)

Follow the standard Bittensor localnet guide
([mine + validate on localnet](https://docs.learnbittensor.org/local-build/mine-validate)):
run a local `subtensor`, create wallets, register a localnet subnet, then start:

```bash
python -m brainblast_subnet.miner     --netuid <N> --subtensor.network local --wallet.name miner
python -m brainblast_subnet.validator --netuid <N> --subtensor.network local --wallet.name validator
```

The neuron files are reference skeletons: the Brainblast-specific logic
(`score_response`, `harvest`) is complete and tested; the bittensor wiring
(`dendrite`/`metagraph`/`subtensor`/`axon` bootstrap) follows the SDK's standard
neuron template and is marked with `NotImplementedError` where an operator plugs in
their wallet + network config.

## Mainnet — the cost gate (read first)

Registering a subnet burns the dynamic `lock_cost` (~1,500–3,420+ TAO, ≈$470k–$1.7M
in 2026). **Do not register until a payback model shows the 18% owner emission
repays the lock at a conservative alpha price.** Until then: run the core as an
oracle / miner on an existing data subnet (Path A), and use localnet for demos.

## Securities boundary

The subnet's incentive token is alpha/TAO (Bittensor's), not $BRAIN. Do **not** route
subnet emissions to $BRAIN holders or market it as $BRAIN yield — see
[`BRAIN-UTILITY.md`](../../datasets/marketplace/BRAIN-UTILITY.md).
