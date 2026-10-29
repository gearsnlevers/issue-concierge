---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/related-repo-closer.yml
  - scripts/related-repo-closer.mjs
  - scripts/issue-concierge-updater.mjs
  - scripts/check-deployment.mjs
issues:
  - rockcarver/frodo-lib#806
  - rockcarver/frodo-cli#922
---

# The related-repo closer trusts the proof of the link, not the author of the issue

## Context and problem statement

When a canonical issue closes, the original issue in the other repository has to be updated ([0019](0019-split-repositories-link-issues-and-never-transfer-them.md)). A model did that and, on frodo-lib#806, named the closed issue itself, so the write was refused. [0026](0026-the-related-repo-closer-is-code-not-a-model.md) made it code, as [0011](0011-code-decides-what-code-can-decide-before-a-model-runs.md) asks, and also had it act only on an issue opened by someone with a role in the repository. On its first live run the script skipped frodo-lib#806 for that reason: GitHub reports an author's association relative to what the reading token can see, and the workflow token does not see a private organization membership, so an issue a maintainer had opened looked like a stranger's.

## Decision

- The closer is a plain workflow and a script, with no model. It reads the closed issue, the original and the original's `related-repos.md` with the workflow token, and writes to the other repository only, with the token that the updater generates from `related-repos.md` into the workflow's environment.
- It acts only on a canonical issue that carries `original-in-related-repo` ([0025](0025-both-issues-of-a-link-carry-a-label.md)) and was closed as completed. It does not ask who opened the canonical issue. A close as not planned or as a duplicate changes nothing; what the original says then is a maintainer's.
- A `Reported from` line only names a candidate. The candidate must be in `related-repos.md`, carry `related-repo`, be open, and have a comment from the harness that names the canonical issue, and exactly one candidate must confirm. That proof is the check: a stranger's issue cannot make a comment from the harness name it.
- The original's own `related-repos.md` decides between `waiting-for-release` and closing it. When that file cannot be read, nothing is changed and the run fails.
- A run finishes what an earlier one left and never repeats a write. The workflow can also be run by hand for one issue, with a dry run.

## Consequences

- No model call and no wrong target. A close that does nothing says why in the run, and a refused write fails the run.
- A new check that depends on what a token can see has to be tried with the workflow token, in the workflow. The first live run is the test.
- The updater generates two kinds of cross-repository settings, and `check-deployment` reads the closer's workflow text instead of a compiled lock.

## Alternatives considered

- Keeping the check of the author's role: rejected. Its answer depends on the reading token, so it fails for exactly the maintainers it is meant to let through, and the proof of the link already stops a forged link.
- Asking the permission API for the author's role: rejected. It is one more call that can be refused for the same kind of reason.
- A prompt that names the repository and the issue number to use: rejected. A sentence is a first layer and the model may ignore it.
