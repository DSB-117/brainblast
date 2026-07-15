"""Objective scoring for the Brainblast subnet.

This module is the crux of the incentive mechanism and is deliberately PURE — it
imports no `bittensor` and touches no chain. That makes it (a) unit-testable, and
(b) directly reusable as a "validate-as-a-service" oracle for an existing code/data
subnet (Path A in datasets/marketplace/BITTENSOR.md).

A candidate VTI is scored on facts, never opinion:

    weight = proof_gate * provenance_gate * (w_n*novelty + w_b*balance + w_c*corrob)

The two gates are hard pass/fail (a candidate that does not prove RED->GREEN, or
whose provenance is fabricated, scores exactly 0). The remaining terms are the
continuous quality signal that ranks the survivors. Because the gates are
deterministic checker runs, the subnet is un-gameable: you cannot farm emission with
junk, and every validator computes the same gate result, so consensus is tight.

Run `python -m brainblast_subnet.scoring --demo` to score a sample with no chain.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Callable, Iterable, Optional

# Continuous-term weights. Tunable subnet parameters (the owner governs these).
W_NOVELTY = 0.55
W_BALANCE = 0.30
W_CORROBORATION = 0.15

# Saturated vs. scarce classes — encodes corpus-value = class-balance, not raw count.
# Scarce classes are worth more training signal; auth-bypass is oversupplied.
CLASS_BALANCE_WEIGHT = {
    "auth-bypass": 0.35,
    "missing-verification": 0.70,
    "missing-slippage-guard": 0.85,
    "unconfirmed-state": 0.85,
    "wrong-constant": 1.00,
    "staleness": 1.00,
    "immutable-misuse": 1.00,
    "silent-zero-revenue": 1.00,
}
DEFAULT_BALANCE_WEIGHT = 0.75


@dataclass
class Candidate:
    """The commodity a miner submits. Mirrors the fleet's Finding shape."""

    id: str
    vti_class: str
    check_kind: str
    vulnerable: str
    fixed: str
    # provenance
    source_ref: str = ""          # e.g. "owner/repo@<sha>:path#L12"
    evidence_line: str = ""       # the exact upstream line the trap was seen on
    evidence_sha256: str = ""     # sha256 of evidence_line, buyer-verifiable
    trap_target: str = ""         # the forbidden literal/prop/call that MUST appear in evidence
    corroboration_count: int = 1  # independent repos exhibiting the pattern

    def fingerprint(self) -> str:
        """Class + checker + normalized fixture — the novelty key."""
        norm = _normalize_code(self.vulnerable)
        return f"{self.vti_class}|{self.check_kind}|{norm}"


@dataclass
class ScoreBreakdown:
    weight: float
    proof_ok: bool
    provenance_ok: bool
    novelty: float
    balance: float
    corroboration: float
    reason: str = ""

    def as_dict(self) -> dict:
        return {
            "weight": round(self.weight, 4),
            "proof_ok": self.proof_ok,
            "provenance_ok": self.provenance_ok,
            "novelty": round(self.novelty, 4),
            "balance": round(self.balance, 4),
            "corroboration": round(self.corroboration, 4),
            "reason": self.reason,
        }


# A proof function: (candidate) -> True iff the checker FAILS `vulnerable` and PASSES
# `fixed` (RED->GREEN). The real one shells to packages/core (see proof.py); tests
# inject a stub. Kept injectable so scoring stays pure and fast to unit-test.
ProofFn = Callable[[Candidate], bool]


def _normalize_code(src: str) -> str:
    """Whitespace/comment-insensitive normalization for similarity + fingerprinting."""
    lines = []
    for ln in src.splitlines():
        s = ln.strip()
        if not s or s.startswith("//") or s.startswith("#") or s.startswith("*"):
            continue
        s = re.sub(r"\s+", " ", s)
        lines.append(s)
    return "\n".join(lines)


def _jaccard(a: str, b: str) -> float:
    ta = set(_normalize_code(a).split())
    tb = set(_normalize_code(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def check_provenance(c: Candidate) -> bool:
    """Provenance gate: the cited evidence must contain the trap target verbatim and
    the SHA-256 must match the evidence line. Fabricated provenance -> reject.

    Owned/synthetic candidates (no upstream source) legitimately carry no evidence;
    they pass this gate (their rights come from being authored, not cited)."""
    if not c.source_ref and not c.evidence_line:
        return True  # synthetic-owned: nothing cited, nothing to verify
    if c.trap_target and c.trap_target not in c.evidence_line:
        return False
    if c.evidence_sha256:
        got = hashlib.sha256(c.evidence_line.encode("utf-8")).hexdigest()
        if got != c.evidence_sha256:
            return False
    return True


def novelty(c: Candidate, seen_fixtures: Iterable[str]) -> float:
    """1 - max Jaccard similarity of this candidate's vulnerable fixture to any
    already-validated fixture. New pattern -> ~1; resubmission -> ~0."""
    best = 0.0
    for prior in seen_fixtures:
        best = max(best, _jaccard(c.vulnerable, prior))
        if best >= 0.999:
            break
    return max(0.0, 1.0 - best)


def balance_weight(vti_class: str) -> float:
    return CLASS_BALANCE_WEIGHT.get(vti_class, DEFAULT_BALANCE_WEIGHT)


def corroboration_weight(count: int) -> float:
    """Diminishing return: 1 repo -> 0, saturating toward 1 as prevalence grows."""
    if count <= 1:
        return 0.0
    # log-ish curve capped at 1.0
    return min(1.0, (count - 1) / 5.0)


def score_candidate(
    c: Candidate,
    prove: ProofFn,
    seen_fingerprints: set[str],
    seen_fixtures: list[str],
) -> ScoreBreakdown:
    """Score one candidate. Mutates neither argument — the caller decides whether to
    admit it into the seen-set after consensus."""
    # Hard gate 1: RED->GREEN proof.
    if not prove(c):
        return ScoreBreakdown(0.0, False, False, 0.0, 0.0, 0.0,
                              "rejected: does not prove RED->GREEN")
    # Hard gate 2: provenance.
    if not check_provenance(c):
        return ScoreBreakdown(0.0, True, False, 0.0, 0.0, 0.0,
                              "rejected: provenance mismatch (target/sha)")
    # Duplicate of an already-validated trap -> proven but zero marginal value.
    if c.fingerprint() in seen_fingerprints:
        return ScoreBreakdown(0.0, True, True, 0.0, 0.0, 0.0,
                              "rejected: duplicate of validated VTI")

    nov = novelty(c, seen_fixtures)
    bal = balance_weight(c.vti_class)
    cor = corroboration_weight(c.corroboration_count)
    quality = W_NOVELTY * nov + W_BALANCE * bal + W_CORROBORATION * cor
    return ScoreBreakdown(quality, True, True, nov, bal, cor, "accepted")


@dataclass
class ValidatedIndex:
    """The validator's memory of accepted VTIs (novelty + dedup basis). In a real
    validator this is persisted and periodically reconciled with the registry."""

    fingerprints: set[str] = field(default_factory=set)
    fixtures: list[str] = field(default_factory=list)

    def admit(self, c: Candidate) -> None:
        self.fingerprints.add(c.fingerprint())
        self.fixtures.append(c.vulnerable)

    def score(self, c: Candidate, prove: ProofFn) -> ScoreBreakdown:
        return score_candidate(c, prove, self.fingerprints, self.fixtures)


def _demo() -> None:
    idx = ValidatedIndex()
    # Accept-all stub proof for the demo (real validator uses proof.py).
    prove_stub: ProofFn = lambda c: "0" in c.vulnerable or "false" in c.vulnerable.lower()

    fresh = Candidate(
        id="demo-slippage-mint-amount0min-zero",
        vti_class="missing-slippage-guard",
        check_kind="cst-struct-field-forbidden-literal",
        vulnerable="MintParams({ amount0Min: 0, amount1Min: 0, deadline: block.timestamp })",
        fixed="MintParams({ amount0Min: minOut0, amount1Min: minOut1, deadline: deadline })",
        source_ref="FiveElementsLabs/orbit-defi@abc123:contracts/Mint.sol#L42",
        evidence_line="amount0Min: 0,",
        trap_target="amount0Min: 0",
        corroboration_count=3,
    )
    fresh.evidence_sha256 = hashlib.sha256(fresh.evidence_line.encode()).hexdigest()

    print("fresh   ->", idx.score(fresh, prove_stub).as_dict())
    idx.admit(fresh)
    print("dup     ->", idx.score(fresh, prove_stub).as_dict())

    saturated = Candidate(
        id="demo-authbypass-txorigin",
        vti_class="auth-bypass",
        check_kind="cst-member-access-forbidden",
        vulnerable="require(tx.origin == msg.sender, 'no contracts');",
        fixed="require(msg.sender == owner, 'not owner');",
    )
    print("scarce vs saturated -> balance weights:",
          balance_weight("wrong-constant"), "vs", balance_weight("auth-bypass"))
    print("saturated->", idx.score(saturated, prove_stub).as_dict())


if __name__ == "__main__":
    import sys
    if "--demo" in sys.argv:
        _demo()
    else:
        print("usage: python -m brainblast_subnet.scoring --demo")
