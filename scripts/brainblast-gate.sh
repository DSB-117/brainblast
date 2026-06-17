#!/bin/sh
# Brainblast CI gate — turn a report.json into a pass/fail exit code.
#
#   brainblast-gate.sh [REPORT_JSON] [--fail-on=critical|high|medium|low] [--strict] [--quiet]
#
# Exit codes:
#   0  pass  — no confirmed problem at/above the threshold (and verdict not "blocked")
#   1  fail  — a confirmed FAIL at/above the threshold, verdict "blocked", or
#              (with --strict) a CANT_TELL at/above the threshold
#   2  usage/error — no report found, bad option, or python3 missing
#
# Reports from @brainblast/core carry per-rule check results (checks[]). A
# confirmed FAIL gates the build; a CANT_TELL (the checker could not statically
# prove the guard) is a WARNING by default and only gates under --strict, so a
# red build always means a real, confirmed problem. Older reports without
# checks[] fall back to the riskTotals path.
#
# REPORT_JSON defaults to the newest .agent-research/report.json or
# .agent-research/runs/*/report.json. --fail-on defaults to "critical".
#
# Example (GitHub Actions, after a headless brainblast run produces report.json):
#   curl -fsSL https://raw.githubusercontent.com/DSB-117/brainblast/main/scripts/brainblast-gate.sh \
#     | sh -s -- --fail-on=critical
set -e

FAIL_ON=critical
QUIET=0
STRICT=0
REPORT=""
for arg in "$@"; do
  case "$arg" in
    --fail-on=*) FAIL_ON="${arg#*=}" ;;
    --strict)    STRICT=1 ;;
    --quiet|-q)  QUIET=1 ;;
    -*)          echo "brainblast-gate: unknown option: $arg" >&2; exit 2 ;;
    *)           REPORT="$arg" ;;
  esac
done

# Default to the newest report if none was given.
if [ -z "$REPORT" ]; then
  REPORT=$(ls -1t .agent-research/report.json .agent-research/runs/*/report.json 2>/dev/null | head -1 || true)
fi
if [ -z "$REPORT" ] || [ ! -f "$REPORT" ]; then
  echo "brainblast-gate: no report.json found — pass a path, or run brainblast first" >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "brainblast-gate: python3 is required" >&2
  exit 2
fi

REPORT="$REPORT" FAIL_ON="$FAIL_ON" QUIET="$QUIET" STRICT="$STRICT" python3 - <<'PY'
import json, os, sys

report = os.environ["REPORT"]
fail_on = os.environ["FAIL_ON"].lower()
quiet = os.environ["QUIET"] == "1"
strict = os.environ["STRICT"] == "1"

order = ["low", "medium", "high", "critical"]  # ascending severity
if fail_on not in order:
    print(f"brainblast-gate: --fail-on must be one of {order}", file=sys.stderr)
    sys.exit(2)

try:
    data = json.load(open(report, encoding="utf-8"))
except Exception as exc:  # noqa: BLE001
    print(f"brainblast-gate: {report} is not valid JSON — {exc}", file=sys.stderr)
    sys.exit(2)

verdict = (data.get("summary", {}) or {}).get("verdict", "unknown")
blocked = verdict == "blocked"
gating = set(order[order.index(fail_on):])  # threshold severity and above
checks = data.get("checks")

if isinstance(checks, list):
    # checks-aware path (reports from @brainblast/core)
    fails = [c for c in checks if c.get("result") == "fail" and c.get("severity") in gating]
    cant = [c for c in checks if c.get("result") == "cant_tell" and c.get("severity") in gating]
    fail = bool(fails) or blocked or (strict and bool(cant))
    if not quiet:
        ct = data.get("checkTotals", {}) or {}
        print(f"brainblast-gate: {report}")
        print(f"  verdict: {verdict}   checks: pass={ct.get('pass', 0)} fail={ct.get('fail', 0)} cant_tell={ct.get('cant_tell', 0)}")
        if cant and not strict:
            print(f"  warning: {len(cant)} cant_tell at/above {fail_on} (not gating — use --strict to fail on these)")
        reason = []
        if fails:
            reason.append(f"{len(fails)} confirmed fail(s) at/above {fail_on}")
        if blocked:
            reason.append("verdict is blocked")
        if strict and cant:
            reason.append(f"{len(cant)} cant_tell at/above {fail_on} (--strict)")
        tag = "FAIL — " + "; ".join(reason) if fail else "PASS"
        print(f"  fail-on={fail_on}{' (strict)' if strict else ''}  ->  {tag}")
    sys.exit(1 if fail else 0)

# legacy path: no checks[], gate on riskTotals
totals = data.get("riskTotals", {}) or {}
count = sum(int(totals.get(s, 0)) for s in order[order.index(fail_on):])
fail = count > 0 or blocked
if not quiet:
    counts = ", ".join(f"{s}={int(totals.get(s, 0))}" for s in reversed(order))
    print(f"brainblast-gate: {report}")
    print(f"  verdict: {verdict}   risks: {counts}")
    reason = []
    if count > 0:
        reason.append(f"{count} risk(s) at/above {fail_on}")
    if blocked:
        reason.append("verdict is blocked")
    print(f"  fail-on={fail_on}  ->  {'FAIL — ' + '; '.join(reason) if fail else 'PASS'}")
sys.exit(1 if fail else 0)
PY
