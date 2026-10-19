---
description: |
  Routes triaged issues to the appropriate fix path based on complexity labels.
  Small → assign Copilot + auto-merge eligible; Medium → assign Copilot with reviews;
  Complex → request design discussion only.
on:
  issues:
    types: [labeled]
permissions:
  contents: read
  issues: read
  pull-requests: read
safe-outputs:
  add-comment:
    max: 1
  assign-to-agent:
    name: copilot
    max: 1
    target: triggering
  threat-detection:
    enabled: true
    continue-on-error: false
max-ai-credits: 10
timeout-minutes: 5
engine: copilot
---

# Tiered Fixer Router

This workflow reacts when a complexity label is applied to an issue.
It must not write code itself; it only routes.

## Rules
- If the issue has `complexity/complex` and does **not** have `design-approved`:
  - Post one comment explaining that a design discussion is required before any code is written.
  - Suggest creating a Discussion or adding a short design note and then applying the `design-approved` label.
  - Do **not** assign an agent.

- If the issue has `complexity/complex` and **does** have `design-approved`:
  - Assign to Copilot cloud agent with custom instructions that reference the approved design.
  - Human review is still required on the resulting PR.

- If the issue has `complexity/medium`:
  - Assign to Copilot cloud agent.
  - Note in the comment that a human review is required before merge.

- If the issue has `complexity/small`:
  - Assign to Copilot cloud agent.
  - Note that the PR is eligible for auto-merge once required checks pass (subject to repository branch protection configuration).
  - Remind that only mechanical, well-tested changes should be treated as small.

- If none of the complexity labels are present, do nothing (noop).

Always keep comments concise and actionable. Never invent a design or implementation plan here.
