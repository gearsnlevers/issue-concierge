---
description: |
  PR gate worker. Assigns a coding agent when plan triage has opened the gate.
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

# PR Worker

Triggered after plan triage has applied complexity and risk labels.
Decides whether a coding agent may be assigned.

## Rules
- `complexity/high` and no `design-approved` → comment requesting design discussion; do not assign.
- Otherwise assign the Copilot cloud agent.
  - Include a short instruction summary based on the plan and the risk level.
  - Note that human review is required unless both labels are low.
  - If the repository defines an environment agent, the coding agent may request it for test generation.

Do not write code in this workflow; only route to the coding agent.
