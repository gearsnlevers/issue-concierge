---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - requirements.json
  - workflows/**
  - docs/multi-phase-design.md
issues:
  - vscheuber/repo-concierge#5
  - vscheuber/repo-concierge#19
  - vscheuber/repo-concierge#22
---

# Gates advance by labels

## Context and problem statement

An issue passes through an issue gate, a plan gate and a PR gate, each with a worker that does the work and a triage agent that checks it. Something has to carry the state between them and be visible to maintainers. Recorded retroactively from the README, `requirements.json` and the gate workflows.

## Decision

- A worker signals completion with `<worker>-ready`. A triage agent signals the next gate with `<triage>-handoff`. A blocking condition is `<thing>-required`, and removing the label resumes processing.
- Labels are the whole state. The set lives in `requirements.json`, must fit GitHub's limits (checked at build time, #19), and the janitor keeps issues showing where they are.
- `dependency-required` is removed by an event-driven dependency watcher when the work it waits for is finished, and `dependency-satisfied` lets triage through.
- The PR gate is signalled from the coding agent's own timeline by a sweep every 15 minutes. The event triggers tried first never ran for the agent's work (#22).

## Consequences

- `SIGNAL_TOKEN` needs Issues and Pull requests read and write: a token with only Issues cannot label a pull request.
- The PR signal can lag by up to 15 minutes. A finish is signalled once, a new feedback round again, and a label a maintainer or the janitor removed is not put back.
