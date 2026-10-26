---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/waiting-for-release.yml
  - workflows/related-repo-closer.yml
  - workflows/pr-worker.md
  - workflows/pr-triage.md
  - workflows/plan-worker.md
  - workflows/plan-triage.md
  - scripts/resolution.mjs
  - scripts/related-repo-closer.mjs
issues:
  - rockcarver/frodo-cli#886
  - rockcarver/frodo-lib#806
---

# The reporter is told how an issue was resolved

## Context and problem statement

An audit on 2026-10-25 found that an issue closed by a merged pull request got one fixed sentence from a model, "Fixed in #N. Waiting for a release that includes this.", and the original of a split-repository link got a line that only named the other issue. The explanation the reporter needed was in the pull request, which that model was forbidden to read. The same audit found gate comments that cite a decision record by a bare number, which a reader cannot resolve. This replaces [0018](0018-reporters-are-guided-by-plain-comments-never-by-labels.md), whose rules stand except where noted.

## Decision

- Everything a reporter reads is a plain-language comment. It never mentions labels, gates, workflows or other harness terms. Missing information is asked for as a short, direct list, and the reply runs the issue worker again. The repository says what a complete report is (`issue-completeness.md`, else its issue templates, else a generic list). A person who reported an issue in another repository is mentioned by a plain workflow, `reporter-notify`, never by the model ([0019](0019-split-repositories-link-issues-and-never-transfer-them.md)).
- Reporter interaction otherwise ends at the issue gate; the plan and PR gates talk to maintainers ([0015](0015-every-gate-has-a-worker-that-produces-and-a-triage-agent-that-classifies.md)). The exception is the resolution: when an issue is closed because a pull request merged, the reporter reads how it was resolved.
- The text is the `## Resolution` section of that pull request's description, written for the reporter: what was wrong, what changed, what they will see now and how to use it. The PR worker tells the coding agent to write it, and PR triage reports on it in an advisory line. A pull request without a usable section gets the one-line comment.
- Code copies it, once, onto the issue, and onto the original of a split-repository link when the work was in the other repository. No model reads or writes it. It is used only when a person merged the pull request, and the copy removes HTML, images and `@` mentions and is capped in length.
- Waiting for Release is code, not a model: how an issue was closed, when the pull request merged and which release contains it are data ([0011](0011-code-decides-what-code-can-decide-before-a-model-runs.md), [0024](0024-a-release-contains-a-fix-when-git-says-so-not-when-the-notes-do.md)). A close by hand, as not planned or as a duplicate, or by a commit gets nothing.
- A decision record is named by its full URL in any text a reader of an issue or pull request sees, with a few words on what it decides. Never a bare number or a relative link.

## Consequences

- A pull request that closes an issue needs a description a reporter can read. The coding agent cannot revise its description after it opens, so a maintainer fixes it before merging.
- Threat detection ([0020](0020-agents-are-read-only-and-threat-detection-runs-where-untrusted-text-meets-a-write.md)) stays off here: the text is copied by code after a person merged it, and no model reads it.
- The example in [0011](0011-code-decides-what-code-can-decide-before-a-model-runs.md) of a Waiting for Release gate that decides with code first and then asks a model describes the gate this replaces. The rule there stands.

## Alternatives considered

- A model writes the resolution at close: rejected. It costs credits per close, reads untrusted pull request text and so needs detection, and can state behavior the change does not have.
- Post it at the release only: rejected. The reporter waits for the release to learn anything.
- A skill drafts the closing comment for a maintainer: kept as a way to write the section, not as the harness.
