---
description: |
  Plan gate worker. Produces or revises a short, cheap, rough plan.
  Reacts to the initial hand-off and to later human comments.
  The plan comment is uniquely identified by the gh-aw-workflow-id marker.
on:
  issues:
    types: [labeled]
  issue_comment:
    types: [created]
permissions:
  contents: read
  issues: read
safe-outputs:
  add-comment:
    max: 1
  add-labels:
    allowed:
      - plan-worker-ready
    max: 1
  threat-detection:
    enabled: true
    continue-on-error: false
max-ai-credits: 15
timeout-minutes: 6
engine: copilot
---

# Plan Worker

## When to run
- An issue receives `issue-triage-handoff` → create the initial plan.
- A human comments on an issue that already has a plan → revise the plan if the comment is relevant.

Ignore comments that are from bots or that do not discuss the plan.

## Plan contents
- Expected files or subsystems to touch
- Rough size (small / medium / large)
- Notable risk signals (auth, data, public API, migrations, etc.)
- Whether a design discussion is likely needed
- Open questions, if any

If the repository defines an environment agent and a quick check would improve the plan, you may request it. Otherwise proceed without it.

## Identity of the plan comment
gh-aw automatically appends a hidden marker to every comment this workflow creates:

```html
<!-- gh-aw-workflow-id: plan-worker -->
```

Do not try to add this marker yourself. The safe-outputs job inserts it.
That marker is the unique, non-spoofable signature of the plan comment.

When revising, post a new comment (the newest comment that carries the marker becomes the current plan). Then ensure the label `plan-worker-ready` is present so plan triage re-evaluates.
