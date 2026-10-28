---
status: accepted
date: 2026-10-27
decision-makers:
  - maintainers
applies-to:
  - workflows/status.yml
  - scripts/status-issue.mjs
  - scripts/concierge-state.mjs
  - scripts/concierge-settings.mjs
  - shared/settings.yml
  - docs/multi-phase-design.md
---

# Each repository has a status view of its own

## Context and problem statement

The Concierge works through labels, and a maintainer who wants to know what it is doing has to read them one issue at a time: what waits for me, did the reporter answer, is anything stuck, are the tokens still good, what does this cost. The framework keeps growing, so the questions get harder to answer from the issue list. A board or a dashboard owned by the person who set the Concierge up helps that person only: a deployment cannot assume access to the repositories that use it, and the people who maintain one repository are not the people who maintain the next.

## Decision

- Every repository that uses the Concierge gets a status view of its own, delivered with the Concierge and derived only from that repository's own state: its issues, labels, comments, runs and pin file. Nothing outside the repository is read or needed.
- The view is one pinned issue, "Concierge status", written by a plain workflow (no model) and edited only when its content changes. It is opened by the bot and carries `no-auto-processing`; the Concierge never acts on it and does not count it.
- It shows whose move each issue is, from the labels, in one place that the commands to come will read as well. It counts the issues the Concierge manages next to those it does not (opted out, opened by bots, not yet picked up), so that no number lacks its denominator. It lists reporter replies nobody has answered, opted-out issues included.
- Text from outside goes into the page as entities (`@`, `#`, markup, HTML), and a reporter's reply is shown as a login and a link, never quoted. Writing the page mentions nobody and links it into no other issue.
- It is on by default. The repository's `settings.yml` turns it off (the issue is closed and unpinned, never deleted) and sets how far back it looks for replies. With `mention-after-days` above 0 (off by default) it also mentions the people who have the maintain or admin role, once per period, about what has waited for a maintainer that long. Every setting has a default, a line that cannot be used is reported and the default stays, and a setting is added in the change that gives it an effect.
- The page carries the same numbers as JSON, so that a dashboard over several repositories can read them without scraping labels.

## Consequences

- Every deployment gets a pinned issue at its next update. A repository that already pins three issues gets it unpinned, and the page says so.
- A plain workflow runs on label events, comments and every hour. It is cheap, and in a private repository it uses a few minutes a day. A burst of events is one run behind the one in progress.
- `SIGNAL_TOKEN` is used to pin the issue and to ask GitHub when that token expires. The page can warn before the gates stop handing issues on.
- The AIC on the page is what the gates' comments report. A run that posts no comment is not in it, and the page says so.

## Alternatives considered

- A Projects board: needs an owner's access and a token with project scope in every repository, and the Concierge cannot create it from a repository.
- A page on GitHub Pages: depends on the plan and on the repository being public, and a static page cannot show what changed a minute ago.
- The run summary of a workflow only: nobody looks there, and it cannot be pinned or subscribed to.
- A Discussions category: needs Discussions to be on, which the Concierge cannot assume.
