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
# A maintainer's /accept is recorded by a comment of the bot, and issue triage stands down for it in a deterministic
# pre-activation step (docs/multi-phase-design.md, "A command is not a reply"). Read the compiled lock: the step must
# survive compilation, and the activation condition must read its outcome, or a late issue worker run puts the hold back.
if ! activation_if "$tmp/.github/workflows/issue-triage.lock.yml" | tr '\n' ' ' | tr -s ' ' | grep -qF "needs.pre_activation.outputs.accepted_result != 'failure'"; then
  echo "::error::issue-triage does not read the accepted outcome in its compiled activation condition"
  exit 1
fi
if ! grep -q "id: accepted" "$tmp/.github/workflows/issue-triage.lock.yml" || ! grep -qF "const MARKERS = ['<!-- issue-concierge:accepted -->', '<!-- concierge:accepted -->'];" "$tmp/.github/workflows/issue-triage.lock.yml"; then
  echo "::error::issue-triage lost its accepted step in the compiled lock"
  exit 1
fi
# Gate labels are applied, not suggested (docs/multi-phase-design.md, "Gate labels are applied, not suggested"):
# gh-aw holds a label below confidence HIGH as a suggestion, so no label event starts the next gate (frodo-lib#803).
# Read the compiled locks: the setting must survive into the safe-output configuration. The issue worker is the one
# gate that keeps the intent mechanism, `related-repo` needs its rationale and confidence (decision 0009).
for name in issue-triage plan-worker plan-triage pr-worker pr-triage; do
  if ! grep -q 'issue_intent\\":false' "$tmp/.github/workflows/$name.lock.yml"; then
    echo "::error::$name still holds its hand-off label as a suggestion: issue-intent: false did not take effect"
    exit 1
  fi
done
if grep -q 'issue_intent' "$tmp/.github/workflows/issue-worker.lock.yml"; then
  echo "::error::issue-worker turned the issue intent off: related-repo would lose its rationale and confidence (decision 0009)"
  exit 1
fi
# What a release contains is decided by git, not by the release notes (frodo-lib#762, docs/multi-phase-design.md,
# "Which fixes a release contains"): the closer's deterministic step must survive compilation, or the notes decide again.
if ! grep -q "id: included_fixes" "$tmp/.github/workflows/release-closer.lock.yml"; then
  echo "::error::release-closer lost its included_fixes step in the compiled lock"
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
# An item that carries no-auto-processing is never touched (docs/multi-phase-design.md, "Opting an item out"): every
# gate must read the label in its compiled ACTIVATION condition, where it stops a run before it starts (PR triage reads
# the pull request's labels), the issue worker must start on a label being removed, and the release closer's
# deterministic step must keep the skip. Flatten the whitespace first: gh-aw wraps the condition.
for name in issue-worker issue-triage plan-worker plan-triage pr-worker pr-triage; do
  if ! activation_if "$tmp/.github/workflows/$name.lock.yml" | tr '\n' ' ' | tr -s ' ' | grep -qE "!contains\(github\.event\.(issue|pull_request)\.labels\.\*\.name, 'no-auto-processing'\)"; then
    echo "::error::$name does not stop at no-auto-processing in its compiled activation condition"
    exit 1
  fi
done
# The pause switch (docs/multi-phase-design.md, "The maintainer's view"): while the repository variable ISSUE_CONCIERGE_PAUSED
# is 'true' no gate starts, and so does CONCIERGE_PAUSED, the name it had in v2.0.x, because a pause that lifted when the
# Concierge was updated would be worse than none. Every gate must read both in its compiled ACTIVATION condition, where it
# stops a run before it starts. The gates with a deterministic pre-activation step that writes (the PR worker and issue triage
# take a void label away, the release closer swaps labels and comments) must read both in that step too, or a paused
# repository would still be written to. The step is checked in the compiled pre_activation JOB: the lock repeats the
# frontmatter in a comment at its top, so a count of lines in the whole file would pass without the step.
# Flatten the whitespace first: gh-aw wraps the condition.
PAUSE_TERM="vars.ISSUE_CONCIERGE_PAUSED != 'true' && vars.CONCIERGE_PAUSED != 'true'"
pre_activation_job() { awk '/^  pre_activation:/{f=1;print;next} f&&/^  [a-z_]+:/{exit} f{print}' "$1"; }
for name in issue-worker issue-triage plan-worker plan-triage pr-worker pr-triage release-closer; do
  if ! activation_if "$tmp/.github/workflows/$name.lock.yml" | tr '\n' ' ' | tr -s ' ' | grep -qF "$PAUSE_TERM"; then
    echo "::error::$name does not stop at ISSUE_CONCIERGE_PAUSED and CONCIERGE_PAUSED in its compiled activation condition"
    exit 1
  fi
done
for name in pr-worker issue-triage release-closer; do
  if ! pre_activation_job "$tmp/.github/workflows/$name.lock.yml" | tr '\n' ' ' | tr -s ' ' | grep -qF "$PAUSE_TERM"; then
    echo "::error::$name does not stop at ISSUE_CONCIERGE_PAUSED and CONCIERGE_PAUSED in its deterministic pre-activation step"
    exit 1
  fi
done
if ! tr '\n' ' ' < "$tmp/.github/workflows/issue-worker.lock.yml" | tr -s ' ' | grep -qE "issues:( +types:)? +- opened +- reopened +- edited +- unlabeled"; then
  echo "::error::the issue worker does not start on a label being removed in its compiled lock"
  exit 1
fi
if ! activation_if "$tmp/.github/workflows/issue-worker.lock.yml" | tr '\n' ' ' | tr -s ' ' | grep -qF "(github.event.action != 'unlabeled' || github.event.label.name == 'no-auto-processing')"; then
  echo "::error::the issue worker's compiled activation condition lets the removal of any label through"
  exit 1
fi
if ! grep -qF "if (names.includes('no-auto-processing')) continue;" "$tmp/.github/workflows/release-closer.lock.yml"; then
  echo "::error::release-closer lost the no-auto-processing skip of its included_fixes step in the compiled lock"
  exit 1
fi
# A routed issue starts held and is marked as opened from another repository (docs/multi-phase-design.md,
# "Split-repo routing", "Both issues of a link carry a label"): the canonical issue the issue worker opens in a
# related repository must carry the hold and the link label in the compiled safe-output configuration, where they
# take effect, not only in a prompt. The settings the updater generates from related-repos.md are not needed here.
node -e '
const fs = require("fs");
const line = fs.readFileSync(process.argv[1], "utf8").split("\n").find((l) => l.includes("GH_AW_SAFE_OUTPUTS_HANDLER_CONFIG:"));
if (!line) { console.error("no safe-output handler configuration in the compiled issue-worker lock"); process.exit(1); }
const cfg = JSON.parse(JSON.parse(line.slice(line.indexOf(": ") + 2).trim()));
const labels = cfg.create_issue && cfg.create_issue.labels;
if (JSON.stringify(labels) !== JSON.stringify(["plan-approval-required", "original-in-related-repo"])) {
  console.error("create_issue labels are " + JSON.stringify(labels));
  process.exit(1);
}
' "$tmp/.github/workflows/issue-worker.lock.yml" || {
  echo "::error::the issue worker's canonical issue does not start with the plan-approval-required hold and the original-in-related-repo label in its compiled configuration"
  exit 1
}
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
