---
description: |
  Plan gate worker. Produces a short, cheap, rough plan for actionable issues.
on:
  issues:
    types: [labeled]
permissions:
  contents: read
  issues: read
safe-outputs:
  add-comment:
    max: 1
  add-labels:
    allowed:
      - plan-ready
    max: 1
  threat-detection:
    enabled: true
    continue-on-error: false
max-ai-credits: 15
timeout-minutes: 6
engine: copilot
---

# Plan Worker

Triggered when an issue receives `ready-for-plan`.
Produce a short, rough plan only. No code.

## Plan contents
- Expected files or subsystems to touch
- Rough size (small / medium / large)
- Notable risk signals (auth, data, public API, migrations, etc.)
- Whether a design discussion is likely needed
- Open questions, if any

If the repository defines an environment agent and a quick check would improve the plan, you may request it. Otherwise proceed without it.

Post the plan as a single comment and add the label `plan-ready`.
