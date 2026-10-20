---
description: |
  Issue gate. Assesses completeness and actionability. Applies quality and
  priority labels only. Does not assign complexity or risk of a fix.
on:
  issues:
    types: [opened, reopened, edited]
  reaction: eyes
permissions:
  contents: read
  issues: read
safe-outputs:
  add-labels:
    allowed:
      - bug
      - feature
      - question
      - documentation
      - needs-info
      - priority/p0
      - priority/p1
      - priority/p2
      - duplicate
      - invalid
      - spam
      - ready-for-plan
    max: 5
  add-comment:
    max: 1
  set-issue-type:
    max: 1
  threat-detection:
    enabled: true
    continue-on-error: false
max-ai-credits: 10
timeout-minutes: 5
engine: copilot
---

# Issue Gate

Analyze issue #${{ github.event.issue.number }}.
Base every conclusion on the issue, its discussion, and repository context. Do not invent missing details.

## Analyze
1. Read the issue and its comments.
2. Check for duplicates among open and recent closed issues.
3. Decide whether the report is complete enough to act on (reproduction steps, expected vs actual, environment).

If the repository defines an environment agent and reproduction would materially improve the assessment, you may note that in the comment. Do not attempt the reproduction yourself.

## Triage (this step)
Apply only quality and priority labels from the allowed list.
Do **not** apply complexity or risk labels.

- Missing details → `needs-info` + one concise clarifying comment.
- Strong duplicate → `duplicate` + reference.
- Complete and actionable → `ready-for-plan`.
- Set type and priority as appropriate.

Post at most one summary comment.
