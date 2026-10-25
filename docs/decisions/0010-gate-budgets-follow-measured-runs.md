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
- Work that needs no judgment uses the small model: the PR worker only assigns the coding agent (#4).
- A gate whose normal run is short gets tight limits on turns and time, so a retry storm after an API error ends quickly instead of consuming the budget (Waiting for Release, #43).

## Consequences

- Raising a budget is a pull request that cites the measurement. Lowering one needs a measurement too.
- The pinned minimums mean a careless cut fails a test.
