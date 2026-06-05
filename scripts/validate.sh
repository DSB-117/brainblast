#!/bin/sh
# Brainblast self-check. Run before tagging a release.
#   sh scripts/validate.sh
# Validates SKILL.md frontmatter, adapter presence, and that the committed
# example is a complete run whose every Fact carries a source URL.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
note() { printf '  %s\n' "$1"; }
ok()   { printf 'PASS  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; FAIL=1; }

echo "Brainblast validation"
echo "====================="

# ── 1. SKILL.md frontmatter ────────────────────────────────────────────────
SKILL="$ROOT/SKILL.md"
if [ ! -f "$SKILL" ]; then
  bad "SKILL.md missing"
else
  # Must open and close a frontmatter block.
  if [ "$(head -1 "$SKILL")" != "---" ]; then
    bad "SKILL.md: frontmatter does not start with ---"
  elif ! awk 'NR>1 && $0=="---"{found=1; exit} END{exit !found}' "$SKILL"; then
    bad "SKILL.md: frontmatter has no closing ---"
  else
    ok "SKILL.md frontmatter delimiters"
  fi
  # Required native keys.
  for key in "name:" "description:" "allowed-tools:"; do
    if grep -q "^$key" "$SKILL"; then
      ok "SKILL.md has $key"
    else
      bad "SKILL.md missing required key: $key"
    fi
  done
  # Real YAML parse when python3 is available (catches subtle breakage).
  if command -v python3 >/dev/null 2>&1; then
    if python3 - "$SKILL" <<'PY'
import sys
src = open(sys.argv[1], encoding="utf-8").read()
parts = src.split("---", 2)
fm = parts[1]
try:
    import yaml  # optional
    yaml.safe_load(fm)
except ImportError:
    # Minimal structural check without PyYAML: every top-level line is
    # "key:" or a "  - list item".
    for ln in fm.splitlines():
        if not ln.strip():
            continue
        if ln.startswith("  ") or ln.rstrip().endswith(":") or ":" in ln:
            continue
        raise SystemExit(f"suspicious frontmatter line: {ln!r}")
except Exception as e:
    raise SystemExit(str(e))
PY
    then ok "SKILL.md frontmatter parses"
    else bad "SKILL.md frontmatter failed parse"
    fi
  fi
fi

# ── 2. Adapters present ────────────────────────────────────────────────────
for f in adapters/codex/AGENTS.md adapters/generic/PROMPT.md; do
  if [ -f "$ROOT/$f" ]; then ok "$f present"; else bad "$f missing"; fi
done

# ── 3. Every committed example is a complete run ───────────────────────────
# Each examples/<name>/ directory must contain the full artifact set and at
# least one component file, and every component's "## Facts" section must
# carry source URLs.
for EX in "$ROOT"/examples/*/; do
  [ -d "$EX" ] || continue
  name=$(basename "$EX")
  for f in requirements.md component-inventory.md research-plan.md \
           coverage-review.md requirements-rereview.md final-report.md report.json; do
    if [ -f "$EX/$f" ]; then ok "example $name/$f present"; else bad "example $name/$f missing"; fi
  done

  # At least one component file.
  ncomp=$(find "$EX/components" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$ncomp" -gt 0 ]; then
    ok "example $name: $ncomp component file(s)"
  else
    bad "example $name: no component files"
  fi

  # Every "## Facts" section must reference a source URL.
  for cf in "$EX"/components/*.md; do
    [ -f "$cf" ] || continue
    urls=$(awk '/^## Facts/{f=1;next} /^## /{f=0} f' "$cf" | grep -c 'http' || true)
    if [ "$urls" -gt 0 ]; then
      ok "example $name/$(basename "$cf"): Facts cite sources ($urls URLs)"
    else
      bad "example $name/$(basename "$cf"): Facts section has no source URLs"
    fi
  done
done

# ── 4. report.json conforms to the committed JSON Schema ───────────────────
# Validates schema/report.schema.json and every examples/*/report.json against
# it. Uses jsonschema for a full Draft-07 check when available; otherwise a
# structural fallback (required keys, enum values, additionalProperties) plus a
# riskTotals == summed-severities cross-check that runs either way.
SCHEMA="$ROOT/schema/report.schema.json"
if [ ! -f "$SCHEMA" ]; then
  bad "schema/report.schema.json missing"
elif ! command -v python3 >/dev/null 2>&1; then
  note "python3 not available — skipping report.json schema validation"
else
  if python3 "$ROOT/scripts/validate_reports.py" "$SCHEMA" "$ROOT"/examples/*/report.json; then
    ok "report.json schema validation"
  else
    bad "report.json schema validation"
  fi
fi

echo "====================="
if [ "$FAIL" -eq 0 ]; then
  echo "All checks passed."
else
  echo "Validation FAILED."
  exit 1
fi
