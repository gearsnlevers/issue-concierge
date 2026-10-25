---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/issue-worker.md
  - workflows/issue-triage.md
  - workflows/reporter-notify.yml
  - shared/issue-completeness.md
---

# Reporters are guided by plain comments, never by labels

## Context and problem statement

Reporters do not know how the gates work and should not have to. A request that says to add a label, or points at a gate, means nothing to them, and a reporter cannot change labels after opening an issue anyway, apart from the starter labels an issue template sets when it creates the issue. Recorded retroactively from the founding design discussion and the issue gate.

## Decision

- Everything a reporter reads is a plain-language comment. It never mentions labels, gates, workflows or other harness terms. Labels are internal state for maintainers.
- Missing information is asked for as a short, direct list of what is still needed. The reporter's reply is a new comment, which runs the issue worker again; triage then clears `needs-info` and hands the issue on. Nobody has to restart anything.
- Reporter interaction ends at the issue gate. The plan and PR gates talk to maintainers ([0015](0015-every-gate-has-a-worker-that-produces-and-a-triage-agent-that-classifies.md)).
- The repository says what a complete report is. The issue worker reads `.github/agentic-workflows/issue-completeness.md` if it exists, otherwise the repository's issue templates, otherwise a generic list: steps to reproduce, expected against actual behavior, environment. A repository with good templates needs no extra file.
- A person who reported an issue in another repository is mentioned by a plain workflow, `reporter-notify`, never by the model: gh-aw neutralizes an `@handle` that the model writes for someone who is not in the conversation ([0019](0019-split-repositories-link-issues-and-never-transfer-them.md)).

## Consequences

- A gate comment that names a label, a gate or a workflow is a defect.
- The worker's request has to stand on its own, because that comment is all the reporter sees.

## Alternatives considered

- Telling reporters which label to add or remove to move an issue along: rejected. They are not trained in the harness and cannot apply labels.
