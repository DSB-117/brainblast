"""VTISynapse — the miner<->validator wire type for the Brainblast subnet.

A validator sends a synapse describing what it wants (a class hint + the classes
already saturated so miners can aim at scarce ones); the miner fills `candidates`
with proposed VTIs; the validator scores them with scoring.score_candidate.

Depends on `bittensor`. Kept tiny and separate so the pure modules (scoring, proof)
stay chain-free and unit-testable.
"""

from __future__ import annotations

from typing import Optional

try:
    import bittensor as bt

    _Base = bt.Synapse
except Exception:  # bittensor not installed (dev box / CI running only pure tests)
    class _Base:  # minimal shim so the module imports without the SDK
        def __init__(self, **kw):
            for k, v in kw.items():
                setattr(self, k, v)


class VTISynapse(_Base):
    """One request/response round of VTI mining.

    Request fields (validator -> miner):
        want_classes:      classes the validator most wants (scarce ones)
        avoid_fingerprints: fingerprints already validated (skip duplicates)
        max_candidates:    how many to return

    Response field (miner -> validator):
        candidates: list of Candidate-shaped dicts (see scoring.Candidate)
    """

    want_classes: list[str] = []
    avoid_fingerprints: list[str] = []
    max_candidates: int = 8
    candidates: Optional[list[dict]] = None

    def deserialize(self) -> list[dict]:
        return self.candidates or []
