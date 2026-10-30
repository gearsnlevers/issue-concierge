---
status: proposed
date: 2026-10-30
decision-makers:
  - maintainers
applies-to:
  - workflows/status.yml
  - scripts/status-issue.mjs
  - scripts/issue-concierge-state.mjs
  - scripts/issue-concierge-settings.mjs
  - shared/settings.yml
  - docs/multi-phase-design.md
issues:
  - gearsnlevers/issue-concierge#79
  - rockcarver/frodo-lib#851
---

# Each repository has a status view of its own, and it tells a reporter from a maintainer by role

## Context and problem statement

Record 0035 gave every repository a status view and said that nothing outside the repository is read. The list of reporter replies then went wrong in use (the status issue of a deployment, 2026-10-30). It took a maintainer for a stranger, because the author association of a comment says CONTRIBUTOR to the workflow token when the person's organisation membership is private, so a maintainer's own note was listed as a reply that waits for the reporter. It also called everyone who is not a maintainer "the reporter", while on an issue that the Concierge opened from a report in a related repository the author is the maintainer whose token created it, and the reporter is the author of the original. This record replaces 0035 with the two rules added.

## Decision

- Every repository that uses the Concierge gets a status view of its own, delivered with the Concierge and derived from that repository's own state: its issues, labels, comments, runs, pin file and settings. Nothing outside the repository is needed. The one thing read outside it is the original of an issue that the Concierge opened from a report in a related repository that the deployment itself names: read-only, best effort, by the proof the related-repo closer uses, and only to learn who reported it. Without access the page is complete, and the commenter is shown as another commenter.
- The view is one pinned issue, "Issue Concierge status", written by a plain workflow (no model) and edited only when its content changes. It is opened by the bot and carries `no-auto-processing`; the Concierge never acts on it and does not count it.
- It shows whose move each issue is, from the labels, and counts the issues the Concierge manages next to those it does not, so that no number lacks its denominator. It lists the replies nobody has answered, opted-out issues included.
- Who is a maintainer is decided by the repository role that the permission API gives (write, maintain or admin), never by the author association alone. A reply whose role could not be asked is listed and says so.
- A listed reply says whether the commenter is the reporter or another commenter, and the reporter's replies come first. The reporter is the issue's author, or for a linked issue the author of the original. The original is the one the linked issue proves, whether or not it is opted out: the opt-out says what the Concierge does there, not who wrote it.
- Text from outside goes into the page as entities, and a reply is shown as a login and a link, never quoted. Writing the page mentions nobody and links it into no other issue.
- It is on by default. The repository's `settings.yml` turns it off (the issue is closed and unpinned, never deleted) and sets how far back it looks. Every setting has a default, and a setting is added in the change that gives it an effect.
- The page carries the same numbers as JSON, so that a dashboard over several repositories can read them without scraping labels.

## Consequences

- A maintainer's own note, or one that automation posted with the maintainer's token, no longer sends the maintainer to an issue that waits for the reporter.
- A reporter's answer is told from a passer-by's comment. Only the latest comment of an issue counts, so a later comment of another person still hides an earlier reply of the reporter.
- A role costs one question to GitHub per person, and a linked issue with a reply costs a few reads of the other repository. A repository that the tokens cannot read leaves the reporter unnamed.
- `SIGNAL_TOKEN` is used to pin the issue, to ask when it expires, and to read what the workflow token may not (roles, collaborators, a private original). It never writes the page.

## Alternatives considered

- Only the author association: it is free, and wrong for the maintainers of a private organisation, which is the case that failed.
- A list of maintainers in the settings: it drifts, and a new maintainer's comments would be listed as replies until someone edits the file. GitHub already knows the roles.
- The bot's link notice as the only source of the reporter: it stays inside the repository, but issues linked before the notice existed, or whose original is opted out, have none.
- A Projects board, GitHub Pages, the run summary only, a Discussions category: as for 0035, each needs access or a plan that the Concierge cannot assume.
