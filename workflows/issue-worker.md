---
description: |
  Issue gate worker. Analyzes completeness and actionability.
  Re-runs when the reporter comments so missing information does not permanently stall the pipeline.
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

## Analysis
Read the issue body **and every comment**.
Produce a short analysis comment covering:
- Completeness (reproduction steps, expected vs actual, environment)
- Apparent duplicates
- Whether the report is still actionable
- Age and activity

### Missing information
If required details are absent, end the comment with an explicit request, for example:

> Please provide: reproduction steps, expected vs actual behavior, and environment (version / OS).

Do not leave the ask implicit.

### Long-lived issues
- Old, inactive, non-pressing issues → note as candidates for closure.
- Valid but non-urgent → note as backlog candidates.
- Do not invent a roadmap.

If the repository defines an environment agent and a quick reproduction check would help, you may request it. Otherwise proceed without it.

## Signaling
Always add (or re-add) the label `issue-worker-ready` after posting the analysis.
This lets issue triage re-evaluate. A later reporter comment simply causes another analysis and another triage pass; the pipeline is not permanently stalled.
