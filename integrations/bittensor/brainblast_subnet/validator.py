"""Brainblast subnet validator neuron.

Each epoch: query miners for candidate VTIs, score every candidate with the
deterministic gate+quality function (scoring.score_candidate, proof gate =
proof.prove), aggregate per-miner scores, and set on-chain weights. Accepted VTIs
are forwarded to the Brainblast registry (`/api/vti`) so validated data flows into
the canonical corpus — the subnet is a decentralized fleet.

This is a reference skeleton: the bittensor wiring (wallet, dendrite, subtensor,
metagraph) follows the standard neuron pattern. The Brainblast-specific logic lives
in `_score_response` and `_forward_to_registry`, which reuse the pure modules.

Run: `python -m brainblast_subnet.validator --netuid <N> --wallet.name ... --logging.debug`
"""

from __future__ import annotations

import os
import time
from typing import Optional

from .protocol import VTISynapse
from .proof import prove, EngineUnavailable
from .scoring import Candidate, ValidatedIndex, ScoreBreakdown

REGISTRY_URL = os.environ.get("BRAINBLAST_REGISTRY_URL", "https://registry.brainblast.tech")
SCARCE_CLASSES = ["wrong-constant", "staleness", "immutable-misuse",
                  "silent-zero-revenue", "missing-slippage-guard"]


def _dict_to_candidate(d: dict) -> Optional[Candidate]:
    try:
        return Candidate(
            id=str(d["id"]),
            vti_class=str(d.get("class") or d.get("vti_class") or "other"),
            check_kind=str(d.get("check_kind")
                           or d.get("binding", {}).get("check", {}).get("kind", "unknown")),
            vulnerable=str(d.get("vulnerable")
                           or d.get("fixtures", {}).get("vulnerable", "")),
            fixed=str(d.get("fixed") or d.get("fixtures", {}).get("fixed", "")),
            source_ref=str(d.get("source_ref")
                           or d.get("provenance", {}).get("sourceRef", "")),
            evidence_line=str(d.get("evidence_line")
                              or d.get("provenance", {}).get("evidenceLine", "")),
            evidence_sha256=str(d.get("evidence_sha256")
                                or d.get("provenance", {}).get("evidenceSha256", "")),
            trap_target=str(d.get("trap_target") or ""),
            corroboration_count=int(d.get("corroboration_count")
                                    or d.get("corroborationCount") or 1),
        )
    except (KeyError, ValueError, TypeError):
        return None


class BrainblastValidator:
    def __init__(self, index: Optional[ValidatedIndex] = None):
        self.index = index or ValidatedIndex()
        # self.wallet / self.subtensor / self.metagraph / self.dendrite set up here
        # via the standard bittensor neuron bootstrap (omitted in the skeleton).

    # ── the Brainblast-specific core (chain-free, unit-testable) ──────────────────
    def score_candidate(self, d: dict) -> ScoreBreakdown:
        c = _dict_to_candidate(d)
        if c is None:
            return ScoreBreakdown(0.0, False, False, 0.0, 0.0, 0.0,
                                  "rejected: malformed candidate")
        try:
            sb = self.index.score(c, prove)
        except EngineUnavailable:
            # Fail closed: never reward a candidate we could not verify.
            return ScoreBreakdown(0.0, False, False, 0.0, 0.0, 0.0,
                                  "rejected: engine unavailable (cannot verify)")
        if sb.weight > 0:
            self.index.admit(c)
            self._forward_to_registry(c)
        return sb

    def score_response(self, candidates: list[dict]) -> float:
        """Aggregate one miner's response into a single scalar (sum of accepted
        candidate weights). Duplicates within a batch self-cancel via the index."""
        return float(sum(max(0.0, self.score_candidate(d).weight) for d in candidates))

    def _forward_to_registry(self, c: Candidate) -> None:
        """POST an accepted VTI to the Brainblast registry so validated subnet data
        enters the canonical corpus. Best-effort; a failure here never affects
        weights (the proof already happened on-chain-adjacent)."""
        try:
            import urllib.request
            import json as _json
            body = _json.dumps({
                "id": c.id, "class": c.vti_class,
                "binding": {"check": {"kind": c.check_kind}},
                "fixtures": {"vulnerable": c.vulnerable, "fixed": c.fixed},
                "provenance": {"sourceRef": c.source_ref,
                               "evidenceSha256": c.evidence_sha256},
                "source": "bittensor-subnet",
            }).encode()
            req = urllib.request.Request(
                f"{REGISTRY_URL}/api/vti", data=body,
                headers={"content-type": "application/json"}, method="POST")
            urllib.request.urlopen(req, timeout=15)
        except Exception:
            pass  # non-fatal

    # ── epoch loop (bittensor wiring sketched) ────────────────────────────────────
    def build_query(self) -> VTISynapse:
        return VTISynapse(
            want_classes=SCARCE_CLASSES,
            avoid_fingerprints=list(self.index.fingerprints),
            max_candidates=8,
        )

    def run_epoch(self) -> None:
        """One scoring round. Real impl: dendrite.query(axons, build_query()) ->
        responses; here we outline the shape."""
        query = self.build_query()  # noqa: F841  (sent to miners via self.dendrite)
        # responses = self.dendrite.query(self.metagraph.axons, query, timeout=30)
        # scores = [self.score_response(r.deserialize()) for r in responses]
        # weights = normalize(scores); self.subtensor.set_weights(..., weights)
        raise NotImplementedError(
            "wire self.dendrite/self.metagraph/self.subtensor per the bittensor "
            "neuron template; score_response() is the Brainblast-specific core.")


def main() -> None:
    v = BrainblastValidator()
    while True:
        try:
            v.run_epoch()
        except NotImplementedError as e:
            print(str(e))
            return
        except Exception as e:  # keep the neuron alive across transient errors
            print(f"epoch error: {e}")
        time.sleep(12)


if __name__ == "__main__":
    main()
