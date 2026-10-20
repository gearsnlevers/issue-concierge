---
description: |
  Issue gate worker. Analyzes completeness and actionability of a new or existing issue.
on:
  issues:
    types: [opened, reopened, edited]
  workflow_dispatch:
    inputs:
      issue_number:
        description: "Issue number to analyze (leave empty to skip)"
        required: false
        type: string
permissions:
  contents: read
  issues: read
safe-outputs:
  add-comment:
    max: 1
  add-labels:
    allowed:
      - issue-worker-ready
    max: 1
  threat-detection:
    enabled: true
    continue-on-error: false
max-ai-credits: 8
timeout-minutes: 4
engine: copilot
---

# Issue Worker

## Target issue
- If triggered by an issue event, analyze issue #${{ github.event.issue.number }}.
- If triggered by workflow_dispatch and `issue_number` is provided, analyze that issue.
- Otherwise do nothing.

## Analysis
Read the issue and its comments.
Produce a short analysis comment covering:
- Completeness (reproduction steps, expected vs actual, environment)
- Apparent duplicates
- Whether the report is actionable

If the repository defines an environment agent and a quick reproduction check would help, you may request it. Otherwise proceed without it.

Add the label `issue-worker-ready` when the analysis comment is posted.
Once that label is present the rest of the gate chain proceeds automatically.
