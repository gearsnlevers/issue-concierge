---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/**
  - tools/workflow-names.test.mjs
issues:
  - vscheuber/repo-concierge#21
---

# Workflows are named in run order

## Context and problem statement

The Actions sidebar sorts workflows by their display name, and a deployment has more than a dozen Concierge workflows in no useful order. Recorded retroactively from #21 and `tools/workflow-names.test.mjs`.

## Decision

- Every workflow is named `Concierge <phase digit><step letter> [▸ ]<Name>`, for example `Concierge 1a ▸ Issue Worker`. The code puts the workflows in pipeline order, so sorting the names sorts the pipeline.
- The marker `▸` is on exactly the workflows that can be run by hand, those with a `workflow_dispatch` trigger, and on no other.
- A name stays within 40 characters, because the sidebar truncates longer ones, and codes are unique.
- `tools/workflow-names.test.mjs` enforces all of this for `workflows/`.

## Consequences

- A new workflow needs a code that fits the pipeline, and adding or removing a manual trigger changes its marker.
- The names are part of what a deployment sees, so renaming is a release.
