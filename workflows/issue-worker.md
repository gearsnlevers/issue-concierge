---
description: |
  Issue gate worker. Analyzes completeness and actionability of a new issue.
on:
  issues:
    types: [opened, reopened, edited]
permissions:
  contents: read
  issues: read
safe-outputs:
  add-comment:
    max: 1
  add-labels:
    allowed:
      - analysis-ready
    max: 1
  threat-detection:
    enabled: true
    continue-on-error: false
max-ai-credits: 8
timeout-minutes: 4
engine: copilot
---

# Issue Worker

Read issue #${{ github.event.issue.number }} and its comments.
Produce a short analysis comment covering:
- Completeness (reproduction steps, expected vs actual, environment)
- Apparent duplicates
- Whether the report is actionable

If the repository defines an environment agent and a quick reproduction check would help, you may request it. Otherwise proceed without it.

Add the label `analysis-ready` when the analysis comment is posted.
