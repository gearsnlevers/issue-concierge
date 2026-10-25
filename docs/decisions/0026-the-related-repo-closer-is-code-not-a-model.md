---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/related-repo-closer.yml
  - scripts/related-repo-closer.mjs
  - scripts/concierge-updater.mjs
  - scripts/check-deployment.mjs
issues:
  - rockcarver/frodo-lib#806
  - rockcarver/frodo-cli#922
---

# The related-repo closer is code, not a model

## Context and problem statement

When a canonical issue closes, the original issue in the other repository has to be updated ([0019](0019-split-repositories-link-issues-and-never-transfer-them.md)). That was a gh-aw workflow whose model had to name the original in its outputs. On frodo-lib#806 it named the closed issue itself, the write to the other repository was refused (HTTP 403) and frodo-cli#922 was never updated, while an earlier close had gone right with the same prompt. Everything the closer decides is in data it can read, and [0011](0011-code-decides-what-code-can-decide-before-a-model-runs.md) says code decides what code can decide.

## Decision

- The closer is a plain workflow and a script, with no model. It reads the closed issue, the original and the original's `related-repos.md` with the workflow token, and writes to the other repository only, with the token that the updater generates from `related-repos.md` into the workflow's environment.
- It acts only on a canonical issue that carries `original-in-related-repo` ([0025](0025-both-issues-of-a-link-carry-a-label.md)), was opened by someone with a role in the repository and was closed as completed. A close as not planned or as a duplicate changes nothing; what the original says then is a maintainer's.
- A `Reported from` line only names a candidate. The candidate must be in `related-repos.md`, carry `related-repo`, be open, and have a comment from the harness that names the canonical issue, and exactly one candidate must confirm.
- The original's own `related-repos.md` decides between `waiting-for-release` and closing it. When that file cannot be read, nothing is changed and the run fails.
- A run finishes what an earlier one left and never repeats a write. The workflow can also be run by hand for one issue, with a dry run.

## Consequences

- No model call and no wrong target. A close that does nothing says why in the run, and a refused write fails the run.
- The updater generates two kinds of cross-repository settings (safe-output keys and the closer's environment), and `check-deployment` reads the closer's workflow text instead of a compiled lock. A change to one changes the tests of the others.
- [0019](0019-split-repositories-link-issues-and-never-transfer-them.md) and [0025](0025-both-issues-of-a-link-carry-a-label.md) list the gh-aw definition under `applies-to`. What they decide is unchanged; the files are the workflow and script above.
- The gh-aw definition is replaced, not edited: an updater removes the old definition and its lock file and adds the new files. Nothing is left to an operator.

## Alternatives considered

- A prompt that names the repository and the issue number to use: rejected. A sentence is a first layer and the model may ignore it; the failure was a wrong value that the code could have filled in.
- A pre-activation step of the gh-aw workflow that does the writes: rejected. It would keep an agent job that never runs, put the other repository's token in a step gh-aw does not manage, and need a step that fails on purpose to stop the agent.
