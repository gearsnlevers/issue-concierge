---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/issue-worker.md
  - workflows/issue-triage.md
  - shared/scope.md
---

# The issue gate closes an issue only on evidence

## Context and problem statement

Running the issue worker over old issues raised the question of what an agent may close. "Stale" had no definition: an old bug can be real and a recent one can already be fixed. And the worker had not been told to look at the code, so a quietly fixed issue went on to planning. Recorded retroactively from the founding design discussion and checked against the issue gate.

## Decision

- Already fixed needs a named change. The worker lists the commits and merged pull requests that touch the affected files after the issue was opened, reads the current code, and names the change. If it cannot point at one, it does not call the issue fixed. Triage applies `already-fixed` and closes.
- Cannot reproduce is for a bug only: the current code does not show the behavior, nothing relevant changed since the report, and the report had enough detail to look. Triage applies `invalid` and closes. A thin report gets a request for details and `needs-info`, and stays open.
- A feature that is not built yet is the request, never a failed reproduction.
- Age and inactivity prove nothing, and there is no "stale" outcome. A valid issue that is not urgent gets `backlog`: it stays open and does not enter the plan gate.
- Out of scope closes only for an item that the repository's own `scope.md` excludes, never because a request is large, hard, risky or unusual. An unclear request gets `scope-review` and nothing closes.
- An open pull request, or one closed unmerged, is never evidence of a fix.
- The comment says only what a tool call in that run showed.
- Every stop here has one override: a maintainer removes the stop label (`backlog`, `out-of-scope`, `scope-review`), reopens the issue if it was closed, and adds `issue-triage-handoff`.

## Consequences

- When unsure, the issue stays open with a question or a parking label. Closing without a person is limited to cases that cite evidence.
- Each issue costs the worker a few searches, inside its budget ([0010](0010-gate-budgets-follow-measured-runs.md)).

## Alternatives considered

- Closing on age or inactivity: rejected, for the reason above.
- One outcome for already fixed and cannot reproduce: rejected. They can look the same; the difference is whether the code changed after the report.
- Judging the kind of issue from the label its template applies (`bug`, `enhancement`): rejected. The body says more, and the label is whichever template the reporter picked.
