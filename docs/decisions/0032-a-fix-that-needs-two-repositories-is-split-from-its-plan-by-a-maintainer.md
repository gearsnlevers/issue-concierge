---
status: proposed
date: 2026-10-26
decision-makers:
  - maintainers
applies-to:
  - workflows/spawn-work-items.yml
  - scripts/spawn-work-items.mjs
  - workflows/plan-worker.md
  - workflows/plan-triage.md
  - workflows/issue-worker.md
  - docs/multi-phase-design.md
issues:
  - rockcarver/frodo-lib#803
  - rockcarver/frodo-cli#919
---

# A fix that needs two repositories is split from its plan by a maintainer

## Context and problem statement

A fix can need a change in two repositories: a library function and the command that calls it. The Concierge knew two answers, keep the issue or route it, and nothing for "both". Splitting meant a person writing the second issue and its dependency line by hand. The issue worker cannot do it: it decides from untrusted text, without reading the code, and every reporter can start it.

## Decision

- The issue worker never splits an issue. When part of the work belongs in the related repository it keeps the issue and says which part and why.
- The plan worker, which reads the code on both sides, lists the work as `Work item:` lines, one per repository, and plan triage holds such a plan for a maintainer.
- A maintainer starts the split by hand. The workflow creates the work item in the related repository only (the one configured with its token), held for plan approval and marked as part of the origin, and an issue marked so is never routed or split again. The origin stays: for a work item that must come first it gets a dependency line and the dependency label, so the dependency watcher holds it until that work is done and then starts it again; its own hold stays.
- Nothing in the plan is believed beyond what can be checked: the repository, the exact form of each line and the cleaned text. Each step checks first whether it was done.
- Releasing the first part and bumping the pin stay with a maintainer or Dependabot; the watcher detects them and never performs them. No agent edits two repositories.

## Consequences

- The origin is both the tracker and the last link of the chain, so closing needs nothing new, but it does not wait for an independent work item.
- One related repository is supported, because the updater generates one token pair; more repositories need a token per repository and a closer look at the updater.
- The plan worker's output now has a small machine-read format, and a maintainer sees it before anything is created.

## Alternatives considered

- Letting the issue worker create the second issue at intake: it would act on a guess about untrusted text, and it is the one gate open to everyone.
- Creating the work items when the plan is approved: a later step, once the by-hand run has proved itself.
- Moving the issue with GitHub's issue transfer: it leaves two issues for one problem with no link between the parts.
