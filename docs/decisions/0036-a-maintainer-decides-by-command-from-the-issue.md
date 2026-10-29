---
status: accepted
date: 2026-10-27
decision-makers:
  - maintainers
applies-to:
  - workflows/commands.yml
  - scripts/commands.mjs
  - scripts/issue-concierge-state.mjs
  - shared/settings.yml
  - requirements.json
  - docs/multi-phase-design.md
---

# A maintainer decides by command, from the issue

## Context and problem statement

An issue the Concierge holds for a maintainer (a request that changes what exists, a doubt about the scope, a plan that waits for approval) is released by removing and adding labels by hand, and a maintainer has to know which labels, in which order, for which situation. The people best placed to decide are not always the people who write code, and the label framework keeps growing.

## Decision

- A maintainer decides by a comment that starts with a command: `/accept`, `/decline [reason]`, `/approve`, `/replan [what to change]`, `/retry`, and `/help`. The command is the label changes a person with the role could make by hand, and nothing else; the person who gave it is named in the thread, and an approval names that person, not the owner of the token that made the label change.
- The roles that may use commands are a setting of the repository, `triage` by default, so that people who triage but do not write code can decide. A personal repository has no triage role, so write is its floor. A collaborator below the role is told once, a stranger is not answered, and the comment is never read by a shell or a model.
- An issue that waits for a maintainer carries one comment of the bot, derived from the labels alone, that says what is needed in plain words and lists the commands for that situation. It exists only while a maintainer has to act, it is always the last comment, and it is deleted when nothing waits.
- `/decline` adds the label `declined` and closes the issue as not planned, with the reason given to the reporter. It is a new required label in every deployment.
- The Concierge still never lifts a hold on its own. A person gives the command; the command is that person's act.

## Consequences

- A new required label, `declined`, in every deployment: the next release is a major release, as it already is for `needs-decision`.
- The options comment posts again whenever anyone comments on an issue that waits, which notifies those who follow it each time. That is the point of it.
- A label removed by hand starts nothing here, because only the issue worker and the plan approval resume may start on a removal ([0028](0028-an-item-labelled-no-auto-processing-is-never-touched.md)). A left-over menu is removed by the next event or the hourly run.
- A comment that starts with a command is not a reply from the reporter, so it starts no issue worker run, and issue triage counts a maintainer's `/accept` as the decision whatever labels show. The soak of the first candidate found the race this closes: a worker run started by a reply finished after the hand-over and put the hold back (docs/e2e.md).
- Triage can start the coding agent with `/approve`, as it could by removing the label. Approving the agent's workflow runs and merging stay with write access ([0005](0005-a-maintainer-holds-the-levers-of-the-pipeline.md)).

## Alternatives considered

- Forms in the Actions tab: the same effect with more steps, and not where the maintainer is looking.
- Editing one options comment in place only: no notification when the situation changes, and it sinks under the thread.
- Commands on the status issue with an issue number: one place to decide from, but two entry points for the same acts and no trace on the issue decided.
- Removing the label with the signal token for `/approve`: the timeline and the approval comment would name the owner of the token.
