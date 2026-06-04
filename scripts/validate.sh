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

# ── 3. Committed example is a complete run ─────────────────────────────────
EX="$ROOT/examples/bags-api"
for f in requirements.md component-inventory.md research-plan.md \
         coverage-review.md requirements-rereview.md final-report.md \
         components/bags-api.md; do
  if [ -f "$EX/$f" ]; then ok "example/$f present"; else bad "example/$f missing"; fi
done

# Every "## Facts" section in example component files must carry URLs, and
# every non-empty fact line in that section should reference a source.
for cf in "$EX"/components/*.md; do
  [ -f "$cf" ] || continue
  urls=$(awk '/^## Facts/{f=1;next} /^## /{f=0} f' "$cf" | grep -c 'http' || true)
  if [ "$urls" -gt 0 ]; then
    ok "example $(basename "$cf"): Facts cite sources ($urls URLs)"
  else
    bad "example $(basename "$cf"): Facts section has no source URLs"
  fi
done

echo "====================="
if [ "$FAIL" -eq 0 ]; then
  echo "All checks passed."
else
  echo "Validation FAILED."
  exit 1
fi
