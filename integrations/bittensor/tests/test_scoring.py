"""Unit tests for the pure scoring core (no bittensor, no chain, no engine).

Run: `python -m pytest integrations/bittensor/tests/ -q`
  or: `python integrations/bittensor/tests/test_scoring.py` (falls back to asserts).
"""

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from brainblast_subnet.scoring import (  # noqa: E402
    Candidate, ValidatedIndex, score_candidate, check_provenance,
    novelty, balance_weight, corroboration_weight,
)

# Proof stubs: RED->GREEN pass = the vulnerable fixture carries the footgun marker.
PROVE_TRUE = lambda c: True
PROVE_FALSE = lambda c: False


def _cand(**kw) -> Candidate:
    base = dict(
        id="t", vti_class="missing-slippage-guard",
        check_kind="cst-struct-field-forbidden-literal",
        vulnerable="MintParams({ amount0Min: 0 })",
        fixed="MintParams({ amount0Min: minOut })",
    )
    base.update(kw)
    return Candidate(**base)


def test_proof_gate_rejects_unproven():
    sb = score_candidate(_cand(), PROVE_FALSE, set(), [])
    assert sb.weight == 0.0 and not sb.proof_ok
    assert "RED->GREEN" in sb.reason


def test_accepts_proven_novel():
    sb = score_candidate(_cand(), PROVE_TRUE, set(), [])
    assert sb.weight > 0 and sb.proof_ok and sb.provenance_ok
    assert sb.novelty == 1.0  # nothing seen yet


def test_provenance_target_mismatch_rejected():
    c = _cand(source_ref="o/r@sha:f.sol#L1",
              evidence_line="something unrelated",
              trap_target="amount0Min: 0")
    assert check_provenance(c) is False
    sb = score_candidate(c, PROVE_TRUE, set(), [])
    assert sb.weight == 0.0 and sb.proof_ok and not sb.provenance_ok


def test_provenance_sha_mismatch_rejected():
    c = _cand(source_ref="o/r@sha:f.sol#L1",
              evidence_line="amount0Min: 0",
              trap_target="amount0Min: 0",
              evidence_sha256="deadbeef")
    assert check_provenance(c) is False


def test_provenance_valid_passes():
    line = "amount0Min: 0,"
    c = _cand(source_ref="o/r@sha:f.sol#L1", evidence_line=line,
              trap_target="amount0Min: 0",
              evidence_sha256=hashlib.sha256(line.encode()).hexdigest())
    assert check_provenance(c) is True


def test_synthetic_owned_passes_provenance():
    # No source cited => authored/owned => provenance gate is a no-op pass.
    assert check_provenance(_cand(source_ref="", evidence_line="")) is True


def test_duplicate_rejected_after_admit():
    idx = ValidatedIndex()
    c = _cand()
    first = idx.score(c, PROVE_TRUE)
    assert first.weight > 0
    idx.admit(c)
    second = idx.score(c, PROVE_TRUE)
    assert second.weight == 0.0 and "duplicate" in second.reason


def test_novelty_decreases_with_similar_prior():
    prior = "MintParams({ amount0Min: 0, amount1Min: 0 })"
    c = _cand(vulnerable="MintParams({ amount0Min: 0, amount1Min: 0 })")
    n = novelty(c, [prior])
    assert n < 0.2  # nearly identical


def test_class_balance_scarce_beats_saturated():
    assert balance_weight("wrong-constant") > balance_weight("auth-bypass")


def test_corroboration_monotone():
    assert corroboration_weight(1) == 0.0
    assert corroboration_weight(3) > corroboration_weight(2)
    assert corroboration_weight(100) <= 1.0


def _run_all():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")


if __name__ == "__main__":
    _run_all()
