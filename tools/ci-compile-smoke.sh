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
# Who may start when (docs/multi-phase-design.md): a closed issue starts no gate. Read the compiled locks:
# the condition must survive into the ACTIVATION job's `if:` (the guard step's own `if:` does not count),
# and the PR worker's activation must read its guard step's outcome.
activation_if() { awk '/^  activation:/{f=1} f{print} f&&/^    runs-on:/{exit}' "$1"; }
for name in issue-worker issue-triage plan-worker plan-triage pr-worker; do
  if ! activation_if "$tmp/.github/workflows/$name.lock.yml" | grep -q "github.event.issue.state == 'open'"; then
    echo "::error::$name does not require an open issue in its compiled activation condition"
    exit 1
  fi
done
if ! activation_if "$tmp/.github/workflows/pr-worker.lock.yml" | grep -q "needs.pre_activation.outputs.existing_fix_result != 'failure'"; then
  echo "::error::pr-worker does not read the existing_fix outcome in its compiled activation condition"
  exit 1
fi
# A blocking label stops the hand-off (docs/multi-phase-design.md, "Who may start when"): the PR worker is the
# one gate that causes code, so a person's hold (`plan-approval-required`, also when it was added by hand) and
# an unfinished dependency must be in its compiled ACTIVATION condition, not only in a prompt. Flatten the
# whitespace first: gh-aw wraps the condition.
for label in plan-approval-required dependency-required; do
  if ! activation_if "$tmp/.github/workflows/pr-worker.lock.yml" | tr '\n' ' ' | tr -s ' ' | grep -qF "!contains(github.event.issue.labels.*.name, '$label')"; then
    echo "::error::pr-worker does not stop at $label in its compiled activation condition"
    exit 1
  fi
done
# Prompt rendering (docs/multi-phase-design.md, "Plan comment identity"): gh-aw removes HTML comments when it
# renders a prompt, so the text plan triage must find has to be plain text. The compiled lock does not hold the
# prompt: it imports the .md at run time, so the prompt is the source minus its HTML comments. If a future gh-aw
# inlines the prompt, look in the lock instead.
marker='gh-aw-workflow-call-id: owner/repo/plan-worker'
for name in plan-triage plan-worker; do
  lock="$tmp/.github/workflows/$name.lock.yml"
  if grep -q "{{#runtime-import .github/workflows/$name.md}}" "$lock"; then
    prompt="$tmp/.github/workflows/$name.md"
  else
    prompt="$lock"
  fi
  if ! perl -0pe 's/<!--.*?-->//gs' "$prompt" | grep -qF "$marker"; then
    echo "::error::the rendered $name prompt does not contain '$marker' (an HTML comment is removed by gh-aw)"
    exit 1
  fi
done
echo "compiled $count workflow definitions with gh-aw $version"
