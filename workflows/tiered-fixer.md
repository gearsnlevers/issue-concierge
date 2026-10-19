---
description: |
  Routes issues according to independent complexity and risk labels.
  Complexity controls design autonomy; risk controls blast-radius constraints.
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

# Tiered Fixer Router

This workflow reacts when complexity or risk labels are applied.
It only routes; it does not write code.

## Routing rules

1. **High complexity without design approval**
   - If `complexity/high` is present and `design-approved` is absent:
     - Post one comment requesting a design discussion.
     - Do not assign an agent.

2. **High risk**
   - If `risk/high` is present:
     - Require human review on any resulting pull request.
     - Assign an agent only when complexity is low or medium and the issue is otherwise ready.
     - Include custom instructions that limit changes to the smallest necessary surface and require the agent to call out any security or data impact.

3. **Low complexity + low risk**
   - If `complexity/low` and `risk/low`:
     - Assign the Copilot cloud agent.
     - Note that the pull request is eligible for auto-merge once required checks pass (subject to repository branch protection).

4. **All other combinations**
   - Assign the Copilot cloud agent.
   - Note that a human review is required before merge.

5. **No relevant labels**
   - Do nothing.

Keep every comment concise. Never invent a design or implementation plan in this workflow.
