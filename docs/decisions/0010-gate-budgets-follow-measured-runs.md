---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/**
  - tools/gate-budgets.test.mjs
  - docs/multi-phase-design.md
issues:
  - vscheuber/repo-concierge#4
  - vscheuber/repo-concierge#32
  - vscheuber/repo-concierge#43
---

# Gate budgets follow measured runs

## Context and problem statement

Each gate sets `max-ai-credits`, a turn limit and a timeout. The credit setting is not a per-run cap: it feeds gh-aw's daily guardrail and the failure report. A value that is too low misreports healthy runs as failures, and one that is far too high hides a leak. Recorded retroactively from the budget changes and `tools/gate-budgets.test.mjs`.

## Decision

- A gate's budget is set from measured runs plus the overhead the gate adds, such as reading repository guidance and decision records, and is changed when a measurement says so.
- `tools/gate-budgets.test.mjs` pins the minimum for the gates whose largest measured run is close to the setting (PR triage and the plan worker), with the measurements in a comment.
- Classification and routing use the small model: the issue worker and triage, plan triage, the closers and Waiting for Release, and the PR worker, which only assigns the coding agent (#4). The plan worker, which writes the plan, and PR triage, which reads a diff, keep the default model.
- A gate whose normal run is short gets tight limits on turns and time, so a retry storm after an API error ends quickly instead of consuming the budget (Waiting for Release, #43).

## Consequences

- Raising a budget is a pull request that cites the measurement. Lowering one needs a measurement too.
- The pinned minimums mean a careless cut fails a test.

## Alternatives considered

- The default model on every gate, as the first deployments ran: rejected. The early gates classify text, and gh-aw's cost guidance is a light model for triage and labeling.
- Round-number budgets set before any run was measured: an early issue worker run finished 0.087 credits over its limit of 10 and was reported as a failure. Hence "measured".
