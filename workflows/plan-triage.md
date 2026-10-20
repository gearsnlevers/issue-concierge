---
description: |
  Plan gate triage. Assigns the first complexity and risk labels against the plan.
  Only the newest comment that carries the plan-worker workflow-id marker is classified.
on:
  issues:
    types: [labeled]
permissions:
  contents: read
  issues: read
safe-outputs:
  add-labels:
    allowed:
      - complexity/low
      - complexity/medium
      - complexity/high
      - risk/low
      - risk/medium
      - risk/high
      - plan-triage-handoff
    max: 3
  add-comment:
    max: 1
  threat-detection:
    enabled: true
    continue-on-error: false
max-ai-credits: 8
timeout-minutes: 4
engine: copilot
---

# Plan Triage

Triggered when an issue receives `plan-worker-ready`.

## Which comment is the plan
Locate the newest comment that contains the exact marker:

```html
<!-- gh-aw-workflow-id: plan-worker -->
```

That marker is inserted by gh-aw safe-outputs and cannot be forged by a human or by another agent.
Ignore every other comment, even if it contains a heading such as "## Plan".
If no comment carries the marker, do nothing and post a short note that the plan could not be found.

## Classification
Read only that comment. Assign exactly one complexity label and one risk label.
Use the definitions in the shared complexity and risk documents.

- If complexity is high and `design-approved` is absent, do **not** emit `plan-triage-handoff`.
- Otherwise emit `plan-triage-handoff`. That label is the signal that the PR worker may assign a coding agent.

Post a one-line confirmation of the labels you applied.
