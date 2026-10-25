---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/**
  - scripts/**
issues:
  - rockcarver/frodo-cli#518
---

# An item labelled no-auto-processing is never touched by the Concierge

## Context and problem statement

The issue worker starts on every new, edited or reopened issue and on every comment, and each later gate starts from a label the gate before it adds ([gates advance by labels](https://github.com/vscheuber/repo-concierge/blob/main/docs/decisions/0004-gates-advance-by-labels.md)). A maintainer's own comment on an old issue that had never been through the pipeline started intake, triage and a plan (frodo-cli#518), although the maintainers wanted to handle that issue by hand. Closed issues and bot activity already start no gate ([closed issues and bot activity start no gate](https://github.com/vscheuber/repo-concierge/blob/main/docs/decisions/0008-closed-issues-and-bot-activity-start-no-gate.md)), but nothing let a person say "do not process this one", for an issue that predates the Concierge or for one that needs a person's own explanation.

## Decision

- The label `no-auto-processing` is a hard stop. An issue that carries it is never processed, labelled, commented on, planned, assigned or closed by any workflow or script of the Concierge: the issue worker, issue triage, plan worker, plan triage, PR worker, PR triage, the janitor, the reporter notices, the plan approval resume, the PR ready signal, the dependency watcher, the Waiting for Release gate, the release closer and the related-repo closer. A closed issue that carries it gets no "Fixed in" and no "Included in" comment and is not marked `released`.
- The guarantee sits where it costs nothing: in the `if:` of every workflow, so no run starts, and in the code of each script that picks items by a query. A sentence in a prompt repeats it and is never the guarantee ([code decides what code can decide](https://github.com/vscheuber/repo-concierge/blob/main/docs/decisions/0011-code-decides-what-code-can-decide-before-a-model-runs.md)).
- Removing the label hands the issue over: the issue worker starts once on the `unlabeled` event of this label and of no other label, and its other conditions still apply (open, not written by a bot, not a pull request).
- A manual dispatch of the issue worker for one issue works on a labelled issue. It is the explicit act of a person, the same rule as for a closed issue.
- The label belongs to the item that carries it. A pull request is its own item: a labelled pull request is skipped by the PR gates, the janitor and the ready signal, and a labelled issue does not opt out a pull request. The dependency watcher may still read the state of a labelled issue that another issue depends on; it changes nothing on it.
- Only a person applies or removes the label. No gate does, and none may ([a maintainer holds the levers of the pipeline](https://github.com/vscheuber/repo-concierge/blob/main/docs/decisions/0005-a-maintainer-holds-the-levers-of-the-pipeline.md)).

## Consequences

- A maintainer who handles an issue by hand labels it and the Concierge stays out of it, including the one-line closing comments, until the label is removed.
- A repository that adopts the Concierge with an existing backlog labels that backlog once, so that a comment on an old issue does not start intake.
- Every new workflow or script that acts on an issue has to check the label; `tools/opt-out.test.mjs` pins that each existing one does.
- The label is listed in `requirements.json`, so the update pull request tells an operator to create it.

## Alternatives considered

- An adoption date in the deployment's configuration: rejected. It cannot cover an issue a person wants out later, and it needs a new setting in every deployment.
- Stopping only the planning gates: rejected. The janitor and the closers would still write one-line comments next to the maintainer's own explanation.
- Starting an issue again by its next comment or edit, or only by a manual dispatch: rejected. The start would be delayed and indirect; removing the label is one deliberate act, as removing `plan-approval-required` already is.
