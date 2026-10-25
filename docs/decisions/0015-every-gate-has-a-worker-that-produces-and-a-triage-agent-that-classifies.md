---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/issue-worker.md
  - workflows/issue-triage.md
  - workflows/plan-worker.md
  - workflows/plan-triage.md
  - workflows/pr-worker.md
  - workflows/pr-triage.md
  - docs/multi-phase-design.md
---

# Every gate has a worker that produces and a triage agent that classifies

## Context and problem statement

The first design had one triage step judge a raw issue, how complex and risky its fix would be included. There was nothing to judge yet, because no fix existed. An agent that classifies what it has just made also hides the classification, the decision that matters most, inside the work. Recorded retroactively from the founding design discussion and checked against the current workflows.

## Decision

- Three gates: issue (`issue-worker`, `issue-triage`), plan (`plan-worker`, `plan-triage`) and PR (`pr-worker`, which assigns the coding agent, then `pr-triage`). In each, the worker produces the artifact (an analysis, a rough plan, a pull request) and a separate triage agent classifies it and decides whether the next gate opens.
- A worker applies only its own completion label, plus `related-repo` for the issue worker. It never applies a classification or a hand-off. Triage does, from an allow-list ([0004](0004-gates-advance-by-labels.md)).
- A gate classifies only what it can see. The issue gate judges the issue (complete, duplicate, already fixed, urgent), never a fix. The plan gate classifies complexity and risk from a plan ([0016](0016-complexity-and-risk-are-separate-gauges-and-either-high-stops-for-approval.md)). The PR gate checks both again against the real diff.
- The plan is a classification prerequisite, not a conversation: one rough plan per hand-off, written when `issue-triage-handoff` arrives and not revised from comments. Reporters talk to the issue gate ([0018](0018-reporters-are-guided-by-plain-comments-never-by-labels.md)); maintainers talk to the pull request.
- Merge is not a gate. `pr-triage-handoff` tells the repository's merge rules that the classification is final; a maintainer merges ([0005](0005-a-maintainer-holds-the-levers-of-the-pipeline.md)).

## Consequences

- A gate costs two model runs. In return the triage side can carry a smaller model, tighter limits or a check the worker does not have ([0010](0010-gate-budgets-follow-measured-runs.md), [0011](0011-code-decides-what-code-can-decide-before-a-model-runs.md)).
- A worker that applies a classification label, or a fourth gate, needs a new record.

## Alternatives considered

- One agent per gate that analyses and classifies: rejected for the reason above, including at the issue gate, which could have been a single step.
- A merge-time gate: rejected. It adds latency and cost for little beyond PR triage and branch protection.
- A plan worker that answers comments and revises the plan: built, then removed. It raced with the triage reading the plan and put reporters and maintainers in one gate.
