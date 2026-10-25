---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/**
issues:
  - vscheuber/repo-concierge#4
  - vscheuber/repo-concierge#35
---

# Closed issues and bot activity start no gate

## Context and problem statement

Two things went wrong early. The cost analysis of the first thirty hours found that the failure issues gh-aw files about its own runs went through the gates and were about a third of all spend (#4). Later a gate started for an issue that a merged pull request had just closed, so the coding agent was assigned work that no longer existed (#35). Recorded retroactively.

## Decision

- Gates do not start for issues or comments written by a bot. The activation condition checks the author type, and the issue worker also ignores pull requests.
- A closed issue starts no gate. Each gate requires the issue to be open; the issue worker alone accepts a maintainer's manual dispatch.
- An issue that an open pull request already closes is not handed to the coding agent: the PR worker checks for one at the start of its run.

## Consequences

- A maintainer who wants a gate on a closed issue dispatches the issue worker by hand.
- The conditions sit in the activation job, so no model runs to decide any of this.
