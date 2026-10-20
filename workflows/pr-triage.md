---
description: |
  PR gate triage. Runs when the coding agent signals completion with pr-worker-ready.
on:
  pull_request:
    types: [labeled]
permissions:
  contents: read
  pull-requests: read
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
max-ai-credits: 12
timeout-minutes: 6
engine: copilot
---

# PR Triage

Triggered when a pull request receives the label `pr-worker-ready`.
That label is the completion signal from the PR worker / coding agent.

Examine the pull request diff.
Re-assign complexity and risk labels based on the actual changes.

Prefer concrete signals:
- Paths touched (auth, security, migrations, public API → raise risk)
- Number of files and size of the diff
- Whether the change matches or exceeds the earlier plan

Post a short comment stating the final labels and any recommended next action (human review, design discussion, or eligible for auto-merge).
