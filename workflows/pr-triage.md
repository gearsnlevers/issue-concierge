---
description: |
  PR gate triage. Re-evaluates complexity and risk against the real diff.
on:
  pull_request:
    types: [opened, synchronize, reopened]
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

Examine the pull request diff.
Re-assign complexity and risk labels based on the actual changes.

Prefer concrete signals:
- Paths touched (auth, security, migrations, public API → raise risk)
- Number of files and size of the diff
- Whether the change matches or exceeds the earlier plan

If the repository defines an environment agent and additional validation or test generation is needed, note it; do not perform it yourself in this triage step.

Post a short comment stating the final labels and any recommended next action (human review, design discussion, or eligible for auto-merge).
