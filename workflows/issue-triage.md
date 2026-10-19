---
description: |
  Triages new and reopened issues by assessing completeness, setting type and
  complexity/priority labels, detecting duplicates, and posting a concise report.
on:
  issues:
    types: [opened, reopened, edited]
  reaction: eyes
permissions:
  contents: read
  issues: read
safe-outputs:
  add-labels:
    allowed:
      - bug
      - feature
      - question
      - documentation
      - needs-info
      - priority/p0
      - priority/p1
      - priority/p2
      - complexity/small
      - complexity/medium
      - complexity/complex
      - duplicate
      - invalid
      - spam
      - ready-for-agent
    max: 5
  add-comment:
    max: 1
  set-issue-type:
    max: 1
  threat-detection:
    enabled: true
    continue-on-error: false
max-ai-credits: 20
timeout-minutes: 8
engine: copilot
---

# Issue Triage Assistant

Analyze issue #${{ github.event.issue.number }} and help maintainers understand and route it quickly.
Base every conclusion on the issue, its discussion, and repository context. Do not invent missing details.

## 1. Gather context
1. Read the issue and its comments.
2. Inspect available labels and issue types in the repository.
3. Search open and recent closed issues for the same symptoms, request, error messages, or expected behavior.
4. Consult relevant repository documentation when it clarifies expected behavior.

## 2. Classify
- Type: bug | feature | question | documentation | invalid | spam
- Priority: p0 (critical/outage/security) | p1 (important) | p2 (normal/low)
- Complexity:
  - small: mechanical, limited scope, high confidence, good test coverage expected, low risk
  - medium: moderate scope or some ambiguity, still suitable for an agent with human review
  - complex: architectural, multi-system, unclear requirements, or high risk — requires design discussion first

## 3. Outputs (via safe-outputs only)
- Add at most the matching labels from the allowed list.
- If details are missing (reproduction steps, expected vs actual, environment), add `needs-info` and ask one concise clarifying comment.
- If a strong duplicate exists, add `duplicate` and mention the issue number in the comment.
- For issues that appear ready and are small or medium, you may add `ready-for-agent`.
- Post at most one summary comment with your classification, confidence, and recommended next step.

Do not assign agents, create PRs, or write code in this workflow. That is the job of the tiered-fixer workflow.
