---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/plan-triage.md
  - workflows/pr-worker.md
  - workflows/pr-triage.md
  - workflows/janitor.yml
  - scripts/plan-approval-resume.mjs
issues:
  - vscheuber/repo-concierge#24
  - vscheuber/repo-concierge#33
  - vscheuber/repo-concierge#34
  - vscheuber/repo-concierge#37
---

# A maintainer holds the levers of the pipeline

## Context and problem statement

The gates assign a coding agent and review its work. A human has to stay the last lever: able to stop a plan before code is written, and the only one who lets agent work run and merge. The frodo repositories record the same rule as core 0002 in frodo-cli. Recorded retroactively from the gate workflows.

## Decision

- `plan-approval-required` is a hold. Plan triage adds it for high complexity and for high risk (#33). A hold added by hand stops the PR worker through a check in its activation condition, and removing it resumes the issue whatever its complexity (#37).
- The Concierge never merges agent work, approves a held run or removes a hold. GitHub holds every run the coding agent causes until a maintainer approves it.
- The janitor deletes only held runs that are disposable. For a pull request it leaves exactly one run to approve: the pipeline run for the newest commit (#34).
- PR triage runs on `pull_request_target`, so label events on an agent's pull request do not queue runs held for approval (#24). CI for the agent's pushes still waits for approval, and branch protection still needs those checks.
- Auto-merge is aspirational and enabled nowhere yet. The harness is new and has not proven reliable, and it first has to stop out-of-scope issues reliably ([0017](0017-the-issue-gate-closes-an-issue-only-on-evidence.md)). The docs describe it for pull requests low in both complexity and risk; the Concierge never enables it.
- Labels are signals, not a security boundary. GitHub grants the right to apply a label by role (Triage and above) and we know of no per-label permission, so whoever has that role can apply `complexity/low`. What must be a person's decision rests on something else: the held runs, the merge, and `plan-approval-resume`, which ignores a removal made by a bot.

## Consequences

- Approval is slower by design. A change to a gate that would start work without a maintainer's step needs a new record.

## Alternatives considered

- Unattended merge for the lowest tier (the agent, an independent agent reviewer and green checks) as the default: proposed at the start, not adopted. A reviewer reads the same untrusted text as the writer and can share its blind spots, so it lowers the risk without replacing a person, and the merge click is the lever the maintainers want to keep. It stays an aspiration until the harness has proven reliable.
