---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/issue-worker.md
  - workflows/related-repo-closer.yml
  - workflows/waiting-for-release.yml
  - workflows/release-closer.md
  - workflows/reporter-notify.yml
  - shared/related-repos.md
  - docs/updater.md
---

# Split repositories link issues and never transfer them

## Context and problem statement

Some projects are split across repositories, as frodo is into a library and a CLI. Reporters know one of them and file there, so many issues land in the wrong repository. GitHub can transfer an issue, but a transfer is permanent: a wrong classification moves the issue, its number and its history for good, and the reporter loses the place where they filed. Recorded retroactively from the founding design discussion and the workflows.

## Decision

- Routing is the issue worker's and is decided from the report text ([0009](0009-issue-routing-decides-from-the-report-text.md)). When it routes, it creates a canonical issue in the related repository, cross-links both issues with plain-language comments, labels the original `related-repo` and starts no planning there. The original stays open and issue triage skips it.
- The canonical issue is the one that is planned and fixed. It starts held with `plan-approval-required`, so a maintainer reads its plan before any code ([0005](0005-a-maintainer-holds-the-levers-of-the-pipeline.md)).
- The original closes only when the fix reaches the reporter. When the canonical issue closes, `related-repo-closer` closes the original. If the repository's `related-repos.md` sets `release.requires_consumer_release`, it marks the original `waiting-for-release` instead and leaves it open until a release of this repository includes the fix.
- An issue closed by a merged pull request is the standard GitHub close. `waiting-for-release` records that it is not released yet, and `release-closer` swaps it for `released` when the release publishes. The Concierge never creates a release; a maintainer does.
- A related repository is named in `related-repos.md` with its own `secret` for creating and closing issues there, and the updater generates the safe-output wiring from it ([0021](0021-one-secret-per-privilege.md)). One related repository with a secret is supported.
- A plain workflow, `reporter-notify`, mentions the original reporter on the linked issue so that they follow it, and only on proof that the harness wrote the link ([0018](0018-reporters-are-guided-by-plain-comments-never-by-labels.md)).

## Consequences

- Two issues stay in step. A wrong route costs a closed extra issue, not a permanent move.
- In a split project the reporter waits for a release of the repository they know, not only for the fix.

## Alternatives considered

- Transferring the issue with GitHub's transfer: rejected, for the reason above.
- A comment that asks a maintainer to move it: safe, but easy to miss, and it leaves the work to a person.
- A label plus a comment for a manual move: rejected. The linked issue gives the same visibility without the move.
