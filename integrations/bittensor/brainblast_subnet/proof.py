"""RED->GREEN proof gate — the ground truth a Brainblast validator runs.

`prove(candidate)` returns True iff the candidate's own checker FAILS the vulnerable
fixture and PASSES the fixed fixture. It shells out to the production engine in
`packages/core` (the same `auditWithRule` used by the fleet and the registry reprove
job) so the subnet's validation is bit-identical to Brainblast's canonical oracle —
there is no second, drifting implementation to trust.

Pure of `bittensor` on purpose: a validator imports `prove` and hands it to
`scoring.score_candidate`. Tests inject a stub instead. If the engine isn't present
(e.g. a miner box without the TS toolchain) `prove` raises, and the validator treats
that as "cannot verify" -> score 0, never a false accept.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

from .scoring import Candidate

# Where the TS engine lives. Override with BRAINBLAST_CORE_DIR.
_DEFAULT_CORE = Path(__file__).resolve().parents[3] / "packages" / "core"
CORE_DIR = Path(os.environ.get("BRAINBLAST_CORE_DIR", str(_DEFAULT_CORE)))
PROVE_SCRIPT = "scripts/prove-one.ts"


class EngineUnavailable(RuntimeError):
    pass


def _engine_present() -> bool:
    return (CORE_DIR / PROVE_SCRIPT).exists()


def prove(c: Candidate) -> bool:
    """Shell to `npx tsx scripts/prove-one.ts <candidate.json>` and read its verdict.

    prove-one.ts writes a JSON verdict to stdout; we treat RED->GREEN (checker fails
    vulnerable, passes fixed) as the pass condition. Any nonzero exit / parse failure
    / missing engine is a hard FALSE (fail closed — never reward on doubt)."""
    if not _engine_present():
        raise EngineUnavailable(
            f"Brainblast core engine not found at {CORE_DIR}. "
            f"Set BRAINBLAST_CORE_DIR or run the validator on a box with packages/core."
        )

    payload = _candidate_to_finding(c)
    with tempfile.NamedTemporaryFile(
        "w", suffix=".json", delete=False, encoding="utf-8"
    ) as fh:
        json.dump(payload, fh)
        cand_path = fh.name
    try:
        proc = subprocess.run(
            ["npx", "tsx", PROVE_SCRIPT, cand_path],
            cwd=str(CORE_DIR),
            capture_output=True,
            text=True,
            timeout=120,
        )
        if proc.returncode != 0:
            return False
        return _verdict_is_red_green(proc.stdout)
    except (subprocess.TimeoutExpired, OSError):
        return False
    finally:
        try:
            os.unlink(cand_path)
        except OSError:
            pass


def _verdict_is_red_green(stdout: str) -> bool:
    """prove-one.ts prints a JSON line with the RED/GREEN outcome. Be liberal about
    the exact shape (the script has evolved): accept an explicit boolean or the
    canonical {red:'fail', green:'pass'} receipt."""
    for line in reversed(stdout.strip().splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            v = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(v.get("proven"), bool):
            return v["proven"]
        if isinstance(v.get("redGreen"), bool):
            return v["redGreen"]
        red = str(v.get("red", "")).lower()
        green = str(v.get("green", "")).lower()
        if red in ("fail", "red") and green in ("pass", "green"):
            return True
    return False


def _candidate_to_finding(c: Candidate) -> dict:
    """Render a Candidate back into the fleet Finding JSON that prove-one.ts expects.
    (The miner already produces this shape; this keeps proof.py self-contained for
    Candidates built in-memory.)"""
    return {
        "id": c.id,
        "class": c.vti_class,
        "binding": {"check": {"kind": c.check_kind, "params": {}}},
        "fixtures": {"vulnerable": c.vulnerable, "fixed": c.fixed},
        "provenance": {
            "sourceRef": c.source_ref,
            "evidenceSha256": c.evidence_sha256,
        },
    }
