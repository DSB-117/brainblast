#!/usr/bin/env bash
# Install (or replace) the autonomous brainblast-fleet cron job on Hermes as a
# NO-AGENT job: the scheduler runs the pipeline script directly and delivers its
# stdout — zero LLM involvement, so an unattended run can only ever submit
# proof-gated VTIs.
#
# Hermes requires cron scripts to live in ~/.hermes/scripts/ (sandbox rule), so
# this stages run-fleet.sh there first.
#
# Usage:  install-cron.sh                    # every 6 hours
#         install-cron.sh "every 4h"
#         install-cron.sh "0 */12 * * *"     # cron expression
# Env:    BRAINBLAST_CRON_NAME  job name (default brainblast-fleet)
#         BRAINBLAST_CRON_DELIVER  delivery target (default local)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/run-fleet.sh"
NAME="${BRAINBLAST_CRON_NAME:-brainblast-fleet}"
DELIVER="${BRAINBLAST_CRON_DELIVER:-local}"
SCHED="${1:-every 6h}"

command -v hermes >/dev/null || { echo "hermes not found on PATH" >&2; exit 1; }
[ -f "$SRC" ] || { echo "run-fleet.sh not found next to this script" >&2; exit 1; }

# Stage the pipeline into the Hermes script sandbox dir.
STAGE_DIR="$HOME/.hermes/scripts"
mkdir -p "$STAGE_DIR"
cp "$SRC" "$STAGE_DIR/brainblast-fleet.sh"
chmod +x "$STAGE_DIR/brainblast-fleet.sh"
echo "Staged pipeline → $STAGE_DIR/brainblast-fleet.sh"

# Replace any existing job of the same name so re-running is idempotent.
hermes cron remove "$NAME" >/dev/null 2>&1 || true

hermes cron create "$SCHED" \
  --no-agent \
  --script brainblast-fleet.sh \
  --deliver "$DELIVER" \
  --name "$NAME"

echo
echo "Installed no-agent cron '$NAME' (schedule: $SCHED, deliver: $DELIVER)."
echo "  hermes cron list              # see it"
echo "  hermes cron run $NAME         # trigger once now"
echo "  hermes cron remove $NAME      # remove it"
echo
echo "Note: the Gateway must be running for schedules to fire — 'hermes gateway install'."
