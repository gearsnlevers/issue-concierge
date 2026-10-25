---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/issue-worker.md
  - workflows/related-repo-closer.md
  - requirements.json
  - shared/related-repos.md
issues:
  - rockcarver/frodo-cli#920
  - rockcarver/frodo-lib#804
---

# Both issues of a link carry a label

## Context and problem statement

A split-repo link has two issues: the original, which the reporter filed, and the canonical issue in the repository that holds the work ([0019](0019-split-repositories-link-issues-and-never-transfer-them.md)). Only the original was marked (`related-repo`). The canonical issue had a `Reported from` line in its body, which a list of issues does not show, so a maintainer could not tell from a list which issues had an original in another repository. The related-repo closer also started a model run on every close of an issue not opened by a bot, only to look for that line.

## Decision

- The canonical issue carries the label `original-in-related-repo`. `related-repo` stays on the original, unchanged, and the new name pairs with it.
- The label is applied by the issue worker's `create-issue` configuration, together with the hold ([0005](0005-a-maintainer-holds-the-levers-of-the-pipeline.md)). The model never chooses it, and the worker's `add-labels` does not allow it. The manifest declares it, so the updater creates it in every deployment.
- The related-repo closer starts only for a closed issue that carries the label. The condition is on the workflow, so any other close starts no run. The `Reported from` line is still how the closer finds the original.
- A canonical issue opened by hand carries the label too, or closing it closes nothing.
- A transfer a maintainer makes with GitHub's own feature leaves no counterpart issue and gets no label.

## Consequences

- A list of issues shows both sides of a link, and closes of ordinary issues cost no model run.
- A repository that opens canonical issues is updated before the repository whose closer closes the originals; an issue opened in between is labelled by hand.
- The canonical issues that existed when the label was introduced were labelled by hand.
- `tools/original-in-related-repo.test.mjs` and `tools/ci-compile-smoke.sh` pin the configuration and the compiled condition; the docs name the label where they name `related-repo`.

## Alternatives considered

- Renaming `related-repo` to a to/from pair: rejected. Several records, tests and docs name it, and the behaviour toward the original does not change.
- Gating the closer on the `Reported from` line instead of the label: not adopted. It would also work for an issue opened by hand and while a rollout is in progress, but the label would then only decorate. The closer acts on what the list shows.
- Marking the issue with a comment only: rejected. A comment does not show in a list and cannot be filtered.
