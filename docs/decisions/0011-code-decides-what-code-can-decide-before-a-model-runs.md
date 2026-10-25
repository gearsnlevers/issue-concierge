---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/**
issues:
  - vscheuber/repo-concierge#8
  - vscheuber/repo-concierge#37
  - vscheuber/repo-concierge#43
---

# Code decides what code can decide before a model runs

## Context and problem statement

Gates that ask a model something a condition could answer cost credits, fail when the model's API does, and can be talked into the wrong answer by the text they read. Two runs showed it: a PR worker that could not read an issue to check one label (#8), and a Waiting for Release run that spent its budget on an issue a maintainer had closed by hand (#43). Recorded retroactively.

## Decision

- What a label, an author type, an issue state or a closing event can answer goes into the activation condition or a deterministic pre-activation step, not into a prompt.
- The PR worker never reads the issue: it needs one label, which the activation condition checks (`dependency-required`, `plan-approval-required`), and untrusted issue text is an injection surface it does not need (#8, #37).
- Waiting for Release decides with code first: a `closed_by_merge` pre-activation step stops hand closes, not-planned and duplicate closes before any model starts. If the step cannot decide, it lets the run continue (#43).
- A label-driven gate names its own signal label in the trigger (`names:`), so a label event that is not for it starts no run. A prompt that says "act only on label X" is read after the run has started and been billed.
- `skip-if-match` is not used to decide about the triggering issue. It is a search over the whole repository: with `label:duplicate` it cancelled a dispatch because an unrelated closed issue carried that label.
- A model runs only where judgment is needed, and its prompt names the few reads it may make.

## Consequences

- A new gate starts by asking which of its conditions code can check.
- A deterministic step that fails open is acceptable here because the model's output is advisory or label-only.
