---
description: |
  Plan gate triage. Assigns the first complexity and risk labels against the plan.
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
    max: 2
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

Triggered when an issue receives `plan-ready`.
Read the plan comment. Assign exactly one complexity label and one risk label.

Use the definitions in the shared complexity and risk documents.
High complexity requires human design approval before any coding agent is assigned.

Post a one-line confirmation of the labels you applied.
