#!/bin/sh
# Brainblast installer
# Usage: curl -fsSL https://raw.githubusercontent.com/DSB-117/brainblast/main/install.sh | sh
set -e

REPO="DSB-117/brainblast"
BRANCH="main"
RAW="https://raw.githubusercontent.com/$REPO/$BRANCH"
INSTALLED=""

echo ""
echo "Brainblast installer"
echo "===================="
echo ""

# ── Claude Code / OpenClaw ─────────────────────────────────────────────────
if [ -d "$HOME/.claude/skills" ]; then
  echo "Detected: Claude Code / OpenClaw"
  DEST="$HOME/.claude/skills/brainblast"
  mkdir -p "$DEST"
  curl -fsSL "$RAW/SKILL.md" -o "$DEST/SKILL.md"
  echo "  Installed → $DEST/SKILL.md"
  echo "  Invoke:     /brainblast [requirements-file]"
  echo ""
  INSTALLED="yes"
fi

# ── Codex ──────────────────────────────────────────────────────────────────
if command -v codex >/dev/null 2>&1 || [ -d "$HOME/.codex" ]; then
  echo "Detected: Codex"
  mkdir -p "$HOME/.codex"
  AGENTS="$HOME/.codex/AGENTS.md"
  if grep -q "## Brainblast" "$AGENTS" 2>/dev/null; then
    echo "  Already present in $AGENTS — skipping"
  else
    printf '\n' >> "$AGENTS"
    curl -fsSL "$RAW/adapters/codex/AGENTS.md" >> "$AGENTS"
    echo "  Appended → $AGENTS"
  fi
  echo "  Invoke:  Tell Codex: 'Run brainblast on requirements.md'"
  echo ""
  INSTALLED="yes"
fi

# ── No platform detected ───────────────────────────────────────────────────
if [ -z "$INSTALLED" ]; then
  echo "No supported agent platform detected."
  echo ""
  echo "Manual install:"
  echo ""
  echo "  Claude Code / OpenClaw:"
  echo "    mkdir -p ~/.claude/skills/brainblast"
  echo "    curl -fsSL $RAW/SKILL.md -o ~/.claude/skills/brainblast/SKILL.md"
  echo ""
  echo "  Codex:"
  echo "    curl -fsSL $RAW/adapters/codex/AGENTS.md >> ~/.codex/AGENTS.md"
  echo ""
  echo "  Generic (any agent):"
  echo "    curl -fsSL $RAW/adapters/generic/PROMPT.md -o brainblast-prompt.md"
  echo ""
  exit 0
fi

echo "Done. Run /brainblast in your agent to start researching."
echo ""
