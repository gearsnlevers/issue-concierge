---
description: |
  Issue gate triage. Applies quality and priority labels.
  Re-evaluates when the issue worker re-runs after a reporter comment.
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
      - backlog
      - issue-triage-handoff
    max: 5
  remove-labels:
    allowed:
      - needs-info
    max: 1
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
Read the latest analysis comment produced by the issue worker.

Apply only quality and priority labels.
Do **not** apply complexity or risk labels.

- Missing details → `needs-info` (do not emit hand-off)
- Strong duplicate → `duplicate`
- Invalid or spam → corresponding label
- Valid but not urgent → `backlog`
- Complete, actionable, and worth doing now → remove `needs-info` if present, then emit `issue-triage-handoff`

`backlog` keeps the issue open but does not enter the plan gate.
`issue-triage-handoff` is the signal that the plan worker may run.

A reporter reply causes the issue worker to re-analyze and re-apply `issue-worker-ready`. This triage then runs again and can clear `needs-info` and hand off once the issue is complete. Reporter interaction therefore does not permanently stall the pipeline.

Post at most one short confirmation comment.
