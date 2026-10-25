---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/release-closer.md
  - docs/multi-phase-design.md
issues:
  - rockcarver/frodo-lib#762
---

# A release contains a fix when git says so, not when the notes do

## Context and problem statement

The release closer moves an issue from `waiting-for-release` to `released` when a release includes its fix. It decided from the release notes, which are written for people and name only the changes they describe. A fix that is a test or a documentation change has no entry: frodo-lib#762 stayed waiting after a release that contained its fix.

## Decision

- Whether a release contains a fix is decided by git: the merge commit of the fix pull request is an ancestor of the release tag. The Waiting for Release gate names that pull request in its comment ("Fixed in #N."), and only that comment, written by the bot, counts ([0019](0019-split-repositories-link-issues-and-never-transfer-them.md)).
- A step in the closer's pre-activation job decides this with no model, before the agent starts. It adds `released`, removes `waiting-for-release`, then comments, so that a call that failed is finished by the next release. It never fails the job and changes no issue's state.
- The agent still decides what git cannot: an issue the notes name, and an issue whose fix is in a related repository, from the version this repository pins.

## Consequences

- The comment names the release that ran, which is a later release than the first one to contain the fix when the closer did not run for that one.
- A change to what the closer takes for a fix (a different comment, a different link) changes the step and its test together.

## Alternatives considered

- A longer prompt that asks the model to match the pull request against the notes or the history: rejected. It is the judgment that missed #762, and [0011](0011-code-decides-what-code-can-decide-before-a-model-runs.md) says code decides what code can decide.
- A separate plain workflow: rejected. It would run beside the agent and race it for the same issues; a step before the agent cannot.
