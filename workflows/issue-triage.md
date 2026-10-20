---
description: |
  Issue gate triage. Applies quality and priority labels after the issue worker.
on:
  issues:
    types: [labeled]
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
max-ai-credits: 6
timeout-minutes: 3
engine: copilot
---

# Issue Triage

Triggered when an issue receives `issue-worker-ready`.
Read the analysis comment produced by the issue worker.

Apply only quality and priority labels.
Do **not** apply complexity or risk labels.

- Missing details → `needs-info`
- Strong duplicate → `duplicate`
- Complete and actionable → `ready-for-plan`
- Set type and priority as appropriate.

Post at most one short confirmation comment.
