"""Brainblast subnet miner neuron.

A miner produces candidate VTIs and serves them when a validator queries. In
practice a miner is a *fleet scout* wrapped in a neuron: it sources footguns from
public code, authors minimal-repro fixtures, and proves them RED->GREEN locally
before serving (never serve what won't pass — the validator will score it 0).

This skeleton reads pre-built candidates from a local queue directory (the fleet's
`fleet/candidates/*.json`), which lets an operator plug the existing scouting
pipeline straight in. Replace `harvest()` with a live scout to mine continuously.

Run: `python -m brainblast_subnet.miner --netuid <N> --wallet.name ... --candidates ./queue`
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Optional

from .protocol import VTISynapse
from .proof import prove, EngineUnavailable
from .scoring import Candidate

QUEUE_DIR = Path(os.environ.get("BRAINBLAST_CANDIDATE_QUEUE", "./queue"))


def _load_candidate(path: Path) -> Optional[Candidate]:
    try:
        d = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    fx = d.get("fixtures", {})
    prov = d.get("provenance", {})
    try:
        return Candidate(
            id=str(d["id"]),
            vti_class=str(d.get("class", "other")),
            check_kind=str(d.get("binding", {}).get("check", {}).get("kind", "unknown")),
            vulnerable=str(fx.get("vulnerable", "")),
            fixed=str(fx.get("fixed", "")),
            source_ref=str(prov.get("sourceRef", "")),
            evidence_line=str(prov.get("evidenceLine", prov.get("evidence", ""))),
            evidence_sha256=str(prov.get("evidenceSha256", "")),
            corroboration_count=int(d.get("corroborationCount", 1)),
        )
    except (KeyError, ValueError, TypeError):
        return None


class BrainblastMiner:
    def __init__(self, queue_dir: Path = QUEUE_DIR):
        self.queue_dir = queue_dir
        # self.wallet / self.subtensor / self.axon set up via bittensor bootstrap.

    def harvest(self, want_classes: list[str], avoid: set[str], limit: int) -> list[dict]:
        """Return up to `limit` locally-proven candidates, preferring the classes the
        validator asked for and skipping fingerprints it already has. Only serve
        candidates that prove RED->GREEN — self-filtering keeps our miner score high."""
        if not self.queue_dir.exists():
            return []
        proven: list[tuple[bool, dict]] = []
        for p in sorted(self.queue_dir.glob("*.json")):
            c = _load_candidate(p)
            if c is None or c.fingerprint() in avoid:
                continue
            try:
                if not prove(c):
                    continue
            except EngineUnavailable:
                # No local engine: serve unproven and let the validator gate it.
                # (Prefer running the engine miner-side to avoid wasted bandwidth.)
                pass
            wanted = c.vti_class in want_classes
            proven.append((wanted, _candidate_to_dict(c)))
        # wanted classes first, then the rest
        proven.sort(key=lambda t: 0 if t[0] else 1)
        return [d for _, d in proven[:limit]]

    # bittensor axon handler
    def forward(self, synapse: VTISynapse) -> VTISynapse:
        synapse.candidates = self.harvest(
            want_classes=list(getattr(synapse, "want_classes", []) or []),
            avoid=set(getattr(synapse, "avoid_fingerprints", []) or []),
            limit=int(getattr(synapse, "max_candidates", 8) or 8),
        )
        return synapse


def _candidate_to_dict(c: Candidate) -> dict:
    return {
        "id": c.id, "class": c.vti_class, "check_kind": c.check_kind,
        "vulnerable": c.vulnerable, "fixed": c.fixed,
        "source_ref": c.source_ref, "evidence_line": c.evidence_line,
        "evidence_sha256": c.evidence_sha256, "trap_target": c.trap_target,
        "corroboration_count": c.corroboration_count,
    }


def main() -> None:
    miner = BrainblastMiner()
    # Real impl: attach miner.forward to self.axon, serve, and block.
    demo = miner.harvest(want_classes=["missing-slippage-guard"], avoid=set(), limit=3)
    print(f"miner would serve {len(demo)} proven candidate(s) from {miner.queue_dir}")
    while False:  # replace with axon serve-loop
        time.sleep(12)


if __name__ == "__main__":
    main()
