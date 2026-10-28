---
status: accepted
date: 2026-10-26
decision-makers:
  - maintainers
applies-to:
  - workflows/stalled-issue-sweep.yml
  - scripts/stalled-issue-sweep.mjs
  - docs/multi-phase-design.md
issues:
  - rockcarver/frodo-lib#803
---

# A stalled issue is given the gate label again by code

## Context and problem statement

The issue worker can end without signalling: its run reaches the turn limit before it posts, or its request for the gate label is held back as a suggestion because its confidence is below HIGH. The issue then sits outside the pipeline with an analysis (or none) and no sign that anything is wrong, and the only way back in was a maintainer who noticed and added the label by hand (frodo-lib#803, a routed issue that starts held, so it also looked intended). Restarting the issue worker is not a way back: it writes another analysis.

## Decision

- A plain workflow without a model, `Concierge 1e ▸ Stalled Issue Sweep`, gives the gate label `issue-worker-ready` again, with the signal token, to an open issue that has an analysis of this repository's issue worker and no evidence of being past issue triage. It removes the label first when it is there, because re-adding a label that is there starts nothing.
- Evidence of being past issue triage is any outcome of issue triage, a later gate label, a `complexity/*` or `risk/*` label, the coding agent as assignee, or a comment of a later gate (labels can vanish on a held issue). The hold `plan-approval-required` is not evidence: a routed issue starts held, before any gate has run on it.
- The sweep never touches a hold, never posts a comment, never starts the issue worker, and leaves alone pull requests, closed issues, bot-authored issues, originals marked `related-repo`, issues that carry `no-auto-processing`, and issues an open pull request closes.
- It waits for the last sign of life (the analysis or the gate label) to be older than a run of issue triage can take, and it stops after a bounded number of re-entries since the last analysis: a person must look. It never loops.
- A person can run it by hand for one issue or for all of them, with a dry run that only reports.

## Consequences

- A stall of the first gate heals on the next sweep at the cost of one issue triage run, and the number of re-entries is bounded.
- It does not heal a stall at a later gate (a plan worker that failed, a plan triage that did not classify), and it does not help an issue the worker never commented on: that failure is reported by the `[aw]` issue the failed run files.
- The workflow needs `SIGNAL_TOKEN`, which every deployment already has.

## Alternatives considered

- Starting the issue worker again by dispatch: writes a second analysis (frodo-lib#802 got one) and reaches the same label problem.
- Turning the issue intent off for the issue worker: removes the confidence that decision 0009 gives `related-repo`.
- Doing the re-entry in the janitor: it has no secret by design, and a label it adds starts no workflow.
