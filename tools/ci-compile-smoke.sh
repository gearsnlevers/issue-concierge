#!/usr/bin/env bash
# Compiles every gh-aw workflow definition in a scratch repository with the
# gh-aw version pinned in requirements.json, and fails if any does not compile
# or no lock file is produced. Catches broken frontmatter before a release.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -p "require('$root/requirements.json').ghAw.version")"
gh extension list 2>/dev/null | grep -q 'gh-aw' || gh extension install github/gh-aw --pin "$version" >/dev/null
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q
mkdir -p "$tmp/.github/workflows"
cp "$root"/workflows/*.md "$tmp/.github/workflows/"
count="$(ls "$tmp"/.github/workflows/*.md | wc -l | tr -d ' ')"
cd "$tmp"
gh aw compile 2>&1 | tee "$tmp/compile.log" | sed 's/^/  /'
summary="$(grep -oE 'Compiled [0-9]+ workflows?: [0-9]+ succeeded' "$tmp/compile.log" | tail -1 || true)"
total="$(echo "$summary" | sed -E 's/Compiled ([0-9]+) .*/\1/')"
ok="$(echo "$summary" | sed -E 's/.*: ([0-9]+) succeeded/\1/')"
if [ -z "$summary" ] || [ "$total" != "$ok" ] || [ "$total" != "$count" ]; then
  echo "::error::gh aw compile: expected $count of $count to succeed, got '$summary'"
  exit 1
fi
locks="$(ls "$tmp"/.github/workflows/*.lock.yml | wc -l | tr -d ' ')"
if [ "$locks" != "$count" ]; then
  echo "::error::expected $count lock files, got $locks"
  exit 1
fi
# Role gate (docs/deployment.md, "Who can start a gate"): only the issue worker opts out of gh-aw's
# membership check. Read the compiled locks, not the sources, so a setting that does not take
# effect fails here.
for lock in "$tmp"/.github/workflows/*.lock.yml; do
  name="$(basename "$lock" .lock.yml)"
  if grep -q 'id: check_membership' "$lock"; then has=yes; else has=no; fi
  if [ "$name" = "issue-worker" ] && [ "$has" = yes ]; then
    echo "::error::issue-worker still checks team membership: roles: all did not take effect"
    exit 1
  fi
  if [ "$name" != "issue-worker" ]; then
    if [ "$has" = no ]; then
      echo "::error::$name has no team-membership check; only issue-worker may opt out"
      exit 1
    fi
    if ! grep -q 'GH_AW_REQUIRED_ROLES: "admin,maintainer,write"' "$lock"; then
      echo "::error::$name does not use the default roles (admin,maintainer,write)"
      exit 1
    fi
  fi
done
echo "compiled $count workflow definitions with gh-aw $version"
