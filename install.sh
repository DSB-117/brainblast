#!/bin/sh
# Brainblast installer / updater
# Install:  curl -fsSL https://raw.githubusercontent.com/DSB-117/brainblast/main/install.sh | sh
# Update:   curl -fsSL https://raw.githubusercontent.com/DSB-117/brainblast/main/install.sh | BRAINBLAST_REF=latest sh
# Specific: curl -fsSL https://raw.githubusercontent.com/DSB-117/brainblast/main/install.sh | BRAINBLAST_REF=v0.2.0 sh
#
# Pins to a tagged release and verifies SHA-256 checksums before writing any file.
set -e

REPO="DSB-117/brainblast"
REF="${BRAINBLAST_REF:-v0.2.0}"

# Resolve "latest" to the actual newest release tag via GitHub API
if [ "$REF" = "latest" ]; then
  LATEST=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
    | grep '"tag_name"' \
    | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
  if [ -n "$LATEST" ]; then
    REF="$LATEST"
  else
    echo "ERROR: could not resolve latest release from GitHub API." >&2
    exit 1
  fi
fi

RAW="https://raw.githubusercontent.com/$REPO/$REF"
INSTALLED=""
GSTACK_BIN="$HOME/.claude/skills/gstack/browse/dist/browse"
GSTACK_INSTALL='git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup'

echo ""
echo "Brainblast installer  (ref: $REF)"
echo "================================="
echo ""

# ── Helpers ────────────────────────────────────────────────────────────────

# Portable SHA-256: prefer shasum (macOS), fall back to sha256sum (Linux).
sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    echo "ERROR: no sha256 tool found (need shasum or sha256sum)" >&2
    exit 1
  fi
}

# Download $1 (path within repo) to local file $2, then verify against SHA256SUMS.
fetch_verified() {
  _path="$1"; _dest="$2"
  _tmp="$(mktemp)"
  curl -fsSL "$RAW/$_path" -o "$_tmp"
  _want=$(grep "  $_path\$" "$SUMS" 2>/dev/null | awk '{print $1}')
  if [ -z "$_want" ]; then
    echo "ERROR: $_path not listed in SHA256SUMS — refusing to install." >&2
    rm -f "$_tmp"; exit 1
  fi
  _got=$(sha256 "$_tmp")
  if [ "$_want" != "$_got" ]; then
    echo "ERROR: checksum mismatch for $_path" >&2
    echo "  expected: $_want" >&2
    echo "  got:      $_got" >&2
    rm -f "$_tmp"; exit 1
  fi
  mkdir -p "$(dirname "$_dest")"
  mv "$_tmp" "$_dest"
}

# Fetch the manifest of checksums once, up front.
SUMS="$(mktemp)"
if ! curl -fsSL "$RAW/SHA256SUMS" -o "$SUMS"; then
  echo "ERROR: could not fetch SHA256SUMS from $RAW — is the ref '$REF' tagged?" >&2
  exit 1
fi

# ── gstack dependency check (required by the Claude Code / OpenClaw adapter) ─
if [ -d "$HOME/.claude/skills" ] && [ ! -x "$GSTACK_BIN" ]; then
  echo "⚠  gstack not found — Brainblast's browse engine depends on it."
  echo "   The skill will install, but /brainblast will fail with BROWSE_MISSING"
  echo "   until you install gstack. Run this (in Claude Code or your shell):"
  echo ""
  echo "     $GSTACK_INSTALL"
  echo ""
fi

# ── Claude Code / OpenClaw ─────────────────────────────────────────────────
if [ -d "$HOME/.claude/skills" ]; then
  echo "Detected: Claude Code / OpenClaw"
  DEST="$HOME/.claude/skills/brainblast"
  fetch_verified "SKILL.md" "$DEST/SKILL.md"
  echo "  Installed → $DEST/SKILL.md  (verified)"
  # Register /brainblast as a first-class slash command in the command palette
  fetch_verified "commands/brainblast.md" "$HOME/.claude/commands/brainblast.md"
  fetch_verified "commands/brainblast-update.md" "$HOME/.claude/commands/brainblast-update.md"
  fetch_verified "commands/brainblast-rico-maps.md" "$HOME/.claude/commands/brainblast-rico-maps.md"
  # Solana power tools (v0.7.0)
  fetch_verified "commands/brainblast-firewall.md" "$HOME/.claude/commands/brainblast-firewall.md"
  fetch_verified "commands/brainblast-score.md" "$HOME/.claude/commands/brainblast-score.md"
  fetch_verified "commands/brainblast-pump-check.md" "$HOME/.claude/commands/brainblast-pump-check.md"
  fetch_verified "commands/brainblast-batch.md" "$HOME/.claude/commands/brainblast-batch.md"
  fetch_verified "commands/brainblast-idl-rules.md" "$HOME/.claude/commands/brainblast-idl-rules.md"
  # Deployment Intelligence (v0.7.2)
  fetch_verified "commands/brainblast-deploy-plan.md" "$HOME/.claude/commands/brainblast-deploy-plan.md"
  # Exploit Pattern Database (v0.7.3)
  fetch_verified "commands/brainblast-exploits.md" "$HOME/.claude/commands/brainblast-exploits.md"
  # Live On-Chain Intelligence (v0.7.4)
  fetch_verified "commands/brainblast-oracle.md" "$HOME/.claude/commands/brainblast-oracle.md"
  # Fee Config Validator (v0.7.5)
  fetch_verified "commands/brainblast-fee-configs.md" "$HOME/.claude/commands/brainblast-fee-configs.md"
  # Protocol Pack Library (v0.7.6)
  fetch_verified "commands/brainblast-packs.md" "$HOME/.claude/commands/brainblast-packs.md"
  echo "  Registered → ~/.claude/commands/brainblast.md"
  echo "  Registered → ~/.claude/commands/brainblast-update.md"
  echo "  Registered → ~/.claude/commands/brainblast-rico-maps.md"
  echo "  Registered → ~/.claude/commands/brainblast-{firewall,score,pump-check,batch,idl-rules,deploy-plan,exploits,oracle,fee-configs,packs}.md"
  echo "  Invoke:     /brainblast [requirements-file]"
  echo "  Token check: /brainblast-rico-maps <contract-address>"
  echo "  TX firewall: /brainblast-firewall <base64-tx>"
  echo "  Pre-flight:  /brainblast-pump-check <mint>"
  echo "  Update:     /brainblast-update"
  echo ""
  INSTALLED="yes"
fi

# ── Codex ──────────────────────────────────────────────────────────────────
if command -v codex >/dev/null 2>&1 || [ -d "$HOME/.codex" ]; then
  echo "Detected: Codex"
  mkdir -p "$HOME/.codex"
  AGENTS="$HOME/.codex/AGENTS.md"
  BLOCK="$(mktemp)"
  fetch_verified "adapters/codex/AGENTS.md" "$BLOCK"
  # Marker-delimited block so re-install REPLACES the old version instead of
  # skipping it or appending a duplicate.
  START="<!-- BRAINBLAST:START -->"
  END="<!-- BRAINBLAST:END -->"
  if [ -f "$AGENTS" ] && grep -qF "$START" "$AGENTS"; then
    # Strip the existing block, keep everything else.
    awk -v s="$START" -v e="$END" '
      $0==s {skip=1} !skip {print} $0==e {skip=0}
    ' "$AGENTS" > "$AGENTS.tmp"
    mv "$AGENTS.tmp" "$AGENTS"
    echo "  Replaced existing Brainblast block in $AGENTS"
  else
    echo "  Appended Brainblast block to $AGENTS"
  fi
  {
    printf '\n%s\n' "$START"
    cat "$BLOCK"
    printf '%s\n' "$END"
  } >> "$AGENTS"
  rm -f "$BLOCK"
  # Install the Codex skill package (registers /brainblast in Codex's skill UI)
  CODEX_SKILL="$HOME/.codex/skills/brainblast"
  fetch_verified "adapters/codex-skill/SKILL.md" "$CODEX_SKILL/SKILL.md"
  fetch_verified "adapters/codex-skill/agents/openai.yaml" "$CODEX_SKILL/agents/openai.yaml"
  echo "  Installed → $CODEX_SKILL/  (skill + openai.yaml)"
  echo "  Invoke:     /brainblast [requirements-file]"
  echo ""
  INSTALLED="yes"
fi

rm -f "$SUMS"

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
