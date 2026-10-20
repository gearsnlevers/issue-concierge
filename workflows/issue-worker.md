---
description: |
  Issue gate worker. Analyzes completeness and actionability.
  Guides reporters only through comments; never mentions internal labels.
on:
  issues:
    types: [opened, reopened, edited]
  issue_comment:
    types: [created]
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
- Issue event → analyze issue #${{ github.event.issue.number }}.
- Comment event → analyze the issue the comment belongs to (ignore bot comments).
- workflow_dispatch with `issue_number` → analyze that issue.
- Otherwise do nothing.

## Analysis comment (reporter-facing)
Read the issue body **and every comment**.
Post a short, plain-language comment. Do not mention labels, gates, workflows, or any internal harness terms.

Cover, in ordinary language:
- Whether the report is clear enough to act on
- Apparent duplicates
- Age and recent activity if relevant

### Missing information
If details are absent, end with a direct request, for example:

> To move this forward, please add:
> - Steps to reproduce
> - What you expected vs what actually happened
> - Environment (version, OS)

### Not actionable or not urgent
- If the issue looks stale or no longer relevant, say so plainly and note that it may be closed.
- If it is valid but not urgent, say that it has been noted for later and that no immediate work is planned.

If the repository defines an environment agent and a quick reproduction check would help, you may request it. Otherwise proceed without it.

## Signaling (internal)
After posting the comment, add (or re-add) the label `issue-worker-ready`.
That label is for the triage agent only; never refer to it in the comment.
