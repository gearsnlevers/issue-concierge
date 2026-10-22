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
echo "compiled $count workflow definitions with gh-aw $version"
