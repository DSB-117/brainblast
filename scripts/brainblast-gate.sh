#!/bin/sh
# Brainblast CI gate — turn a report.json into a pass/fail exit code.
#
#   brainblast-gate.sh [REPORT_JSON] [--fail-on=critical|high|medium|low] [--quiet]
#
# Exit codes:
#   0  pass  — no risk at/above the threshold and verdict is not "blocked"
#   1  fail  — gating risk(s) found, or verdict == "blocked"
#   2  usage/error — no report found, bad option, or python3 missing
#
# REPORT_JSON defaults to the newest .agent-research/runs/*/report.json.
# --fail-on defaults to "critical" (fail if any CRITICAL risk remains).
#
# Example (GitHub Actions, after a headless brainblast run produces report.json):
#   curl -fsSL https://raw.githubusercontent.com/DSB-117/brainblast/main/scripts/brainblast-gate.sh \
#     | sh -s -- .agent-research/runs/*/report.json --fail-on=critical
set -e

FAIL_ON=critical
QUIET=0
REPORT=""
for arg in "$@"; do
  case "$arg" in
    --fail-on=*) FAIL_ON="${arg#*=}" ;;
    --quiet|-q)  QUIET=1 ;;
    -*)          echo "brainblast-gate: unknown option: $arg" >&2; exit 2 ;;
    *)           REPORT="$arg" ;;
  esac
done

# Default to the newest run's report if none was given.
if [ -z "$REPORT" ]; then
  REPORT=$(ls -1t .agent-research/runs/*/report.json 2>/dev/null | head -1 || true)
fi
if [ -z "$REPORT" ] || [ ! -f "$REPORT" ]; then
  echo "brainblast-gate: no report.json found — pass a path, or run brainblast first" >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "brainblast-gate: python3 is required" >&2
  exit 2
fi

REPORT="$REPORT" FAIL_ON="$FAIL_ON" QUIET="$QUIET" python3 - <<'PY'
import json, os, sys

report = os.environ["REPORT"]
fail_on = os.environ["FAIL_ON"].lower()
quiet = os.environ["QUIET"] == "1"

order = ["low", "medium", "high", "critical"]  # ascending severity
if fail_on not in order:
    print(f"brainblast-gate: --fail-on must be one of {order}", file=sys.stderr)
    sys.exit(2)

try:
    data = json.load(open(report, encoding="utf-8"))
except Exception as exc:  # noqa: BLE001
    print(f"brainblast-gate: {report} is not valid JSON — {exc}", file=sys.stderr)
    sys.exit(2)

totals = data.get("riskTotals", {}) or {}
verdict = (data.get("summary", {}) or {}).get("verdict", "unknown")

gating = order[order.index(fail_on):]           # threshold severity and above
count = sum(int(totals.get(s, 0)) for s in gating)
blocked = verdict == "blocked"
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
