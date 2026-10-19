---
# Documentation fragment for complexity model.
# Can be imported into prompts or used as a reference.
---

# Complexity Classification Guide

## complexity/small
- Scope: 1–3 files, pure bug fix or mechanical change
- Risk: low (no security, auth, or data-model changes)
- Tests: existing coverage expected to catch regressions
- Eligible for agent + auto-merge path after green CI

## complexity/medium
- Scope: moderate, some design decisions but bounded
- Risk: medium
- Agent may implement; human review required before merge

## complexity/complex
- Architectural, cross-cutting, unclear requirements, or high impact
- Mandatory design discussion and `design-approved` label before any agent is assigned
- Human remains in the loop for the final PR

Use these definitions consistently across repositories. Fine-tune the thresholds locally if a repository has different risk tolerance.
