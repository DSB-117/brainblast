#!/bin/sh
# Auto-seed the component inventory from lockfiles — Rung 5 of ROADMAP.md.
#
#   scripts/seed-inventory.sh [REPO_ROOT]
#
# Scans REPO_ROOT (default ".") for lockfiles across the major ecosystems and
# prints a JSON array of exact, pinned dependency versions on stdout:
#
#   [
#     { "name": "lodash", "version": "4.17.21", "ecosystem": "npm", "source": "package-lock.json" },
#     ...
#   ]
#
# Supported lockfiles: package-lock.json, yarn.lock, pnpm-lock.yaml (npm),
# poetry.lock, requirements.txt (PyPI), Cargo.lock (crates.io), go.mod (Go),
# Gemfile.lock (RubyGems), composer.lock (Packagist).
#
# Used by the /brainblast research skill (Step 1) to seed the component
# inventory with ground-truth versions instead of inferring them from prose —
# every downstream step (caching, docs research, and the OSV cross-check in
# Step 3e) is then keyed on the *real* pinned version.
#
# Exit codes:
#   0  scan completed (possibly with zero entries — an empty `[]` is normal
#      for a repo with no recognized lockfiles)
#   2  python3 missing

set -e

ROOT="${1:-.}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "seed-inventory.sh: python3 is required" >&2
  exit 2
fi

python3 - "$ROOT" <<'PYEOF'
import json
import os
import re
import sys

root = sys.argv[1]
results = []

# Don't descend into these — vendored/installed deps, not lockfiles of interest.
SKIP_DIRS = {".git", "node_modules", "vendor", "target", ".venv", "venv", "dist", "build"}

LOCKFILE_NAMES = {
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "requirements.txt",
    "Cargo.lock",
    "go.mod",
    "Gemfile.lock",
    "composer.lock",
}


def add(name, version, ecosystem, source):
    if not name or not version:
        return
    results.append({"name": name, "version": version, "ecosystem": ecosystem, "source": source})


def parse_package_lock(path, rel):
    try:
        data = json.load(open(path))
    except (json.JSONDecodeError, OSError):
        return
    # npm v7+ lockfileVersion >= 2: flat "packages" map keyed by node_modules path.
    for key, info in (data.get("packages") or {}).items():
        if not key or not isinstance(info, dict):
            continue
        if "node_modules/" not in key and key != "":
            continue
        name = key.rsplit("node_modules/", 1)[-1]
        if not name or info.get("link"):
            continue
        add(name, info.get("version"), "npm", rel)
    # npm v1-v6: nested "dependencies" map.
    for name, info in (data.get("dependencies") or {}).items():
        if isinstance(info, dict):
            add(name, info.get("version"), "npm", rel)


def parse_yarn_lock(path, rel):
    text = open(path, encoding="utf-8", errors="ignore").read()
    # Entries look like:
    #   "lodash@^4.17.20", lodash@^4.17.21:
    #     version "4.17.21"
    for block in re.split(r"\n(?=\S)", text):
        header = block.splitlines()[0] if block.splitlines() else ""
        m_name = re.match(r'^"?(@?[^@"\n]+)@', header.lstrip())
        m_ver = re.search(r'^\s*version[: ]+"?([^"\n]+)"?', block, re.MULTILINE)
        if m_name and m_ver:
            add(m_name.group(1), m_ver.group(1), "npm", rel)


def parse_pnpm_lock(path, rel):
    text = open(path, encoding="utf-8", errors="ignore").read()
    # Top-level package keys look like:  /lodash@4.17.21: or  /@scope/name@1.2.3:
    for m in re.finditer(r"^\s{2}/(@?[^@\n]+)@([^():\n]+)[:(]", text, re.MULTILINE):
        add(m.group(1), m.group(2), "npm", rel)


def parse_toml_packages(path, ecosystem, rel):
    # Cargo.lock / poetry.lock both repeat:
    #   [[package]]
    #   name = "foo"
    #   version = "1.2.3"
    text = open(path, encoding="utf-8", errors="ignore").read()
    for block in text.split("[[package]]")[1:]:
        m_name = re.search(r'^\s*name\s*=\s*"([^"]+)"', block, re.MULTILINE)
        m_ver = re.search(r'^\s*version\s*=\s*"([^"]+)"', block, re.MULTILINE)
        if m_name and m_ver:
            add(m_name.group(1), m_ver.group(1), ecosystem, rel)


def parse_requirements_txt(path, rel):
    for line in open(path, encoding="utf-8", errors="ignore"):
        line = line.strip()
        m = re.match(r"^([A-Za-z0-9_.\-]+)\s*==\s*([A-Za-z0-9_.\-+]+)", line)
        if m:
            add(m.group(1), m.group(2), "PyPI", rel)


def parse_go_mod(path, rel):
    text = open(path, encoding="utf-8", errors="ignore").read()
    in_require = False
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("require ("):
            in_require = True
            continue
        if in_require and line == ")":
            in_require = False
            continue
        m = None
        if in_require:
            m = re.match(r"^([^\s]+)\s+(v[0-9][^\s]*)", line)
        elif line.startswith("require "):
            m = re.match(r"^require\s+([^\s]+)\s+(v[0-9][^\s]*)", line)
        if m:
            add(m.group(1), m.group(2), "Go", rel)


def parse_gemfile_lock(path, rel):
    text = open(path, encoding="utf-8", errors="ignore").read()
    in_specs = False
    for line in text.splitlines():
        if line.strip() == "specs:":
            in_specs = True
            continue
        if in_specs:
            if line.startswith("    ") and not line.startswith("     "):
                m = re.match(r"^\s+([A-Za-z0-9_.\-]+)\s+\(([^)]+)\)", line)
                if m:
                    add(m.group(1), m.group(2), "RubyGems", rel)
            elif line and not line.startswith(" "):
                in_specs = False


def parse_composer_lock(path, rel):
    try:
        data = json.load(open(path))
    except (json.JSONDecodeError, OSError):
        return
    for section in ("packages", "packages-dev"):
        for pkg in data.get(section) or []:
            version = (pkg.get("version") or "").lstrip("v")
            add(pkg.get("name"), version, "Packagist", rel)


PARSERS = {
    "package-lock.json": parse_package_lock,
    "yarn.lock": parse_yarn_lock,
    "pnpm-lock.yaml": parse_pnpm_lock,
    "poetry.lock": lambda p, r: parse_toml_packages(p, "PyPI", r),
    "requirements.txt": parse_requirements_txt,
    "Cargo.lock": lambda p, r: parse_toml_packages(p, "crates.io", r),
    "go.mod": parse_go_mod,
    "Gemfile.lock": parse_gemfile_lock,
    "composer.lock": parse_composer_lock,
}

for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
    for fname in filenames:
        if fname in LOCKFILE_NAMES:
            full = os.path.join(dirpath, fname)
            rel = os.path.relpath(full, root)
            try:
                PARSERS[fname](full, rel)
            except Exception as e:  # best-effort: a malformed lockfile shouldn't crash the scan
                print(f"seed-inventory.sh: skipping {rel}: {e}", file=sys.stderr)

# Dedupe identical (name, ecosystem, version) entries from overlapping
# lockfiles (e.g. requirements.txt AND poetry.lock in the same repo).
seen = set()
deduped = []
for r in results:
    key = (r["name"], r["ecosystem"], r["version"])
    if key in seen:
        continue
    seen.add(key)
    deduped.append(r)

deduped.sort(key=lambda r: (r["ecosystem"], r["name"].lower()))
print(json.dumps(deduped, indent=2))
PYEOF
