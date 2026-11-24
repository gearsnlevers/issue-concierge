---
status: proposed
date: 2026-11-24
decision-makers:
  - maintainers
applies-to:
  - workflows/**
  - scripts/**
---

# An item a person handles is never touched by the Concierge

## Context and problem statement

The label `no-auto-processing` lets a maintainer keep an item out of the Concierge ([the record this replaces](0028-an-item-labelled-no-auto-processing-is-never-touched.md)). A maintainer who opens an issue and assigns it to themselves has already said they handle it, and still gets intake, triage and a plan unless they also add the label. An assignee alone cannot be read as that statement everywhere: when the coding agent is assigned, GitHub also assigns the owner of the agent's token, in the same second, and a retry leaves that person assigned.

## Decision

- The label `no-auto-processing` is a hard stop. An item that carries it is never processed, labelled, commented on, planned, assigned or closed by any workflow or script of the Concierge. The guarantee is the `if:` of every workflow and the code of every script that picks items by a query; a prompt only repeats it. A closed item that carries it gets no "Fixed in" and no "Included in".
- Removing the label hands the issue over: the issue worker starts once on that `unlabeled` event and on no other. A manual dispatch for one issue works on a labelled issue.
- The label belongs to the item that carries it. A pull request is its own item and the rules below never apply to one.
- An open issue that is assigned to a person (an account of type User) is handled by that person. The Concierge adds `no-auto-processing` to it, with the workflow token so that no event follows, when no coding agent or other bot is assigned and the issue carries no outcome of the plan gate (a `complexity/*` or `risk/*` label, or `plan-triage-handoff`). The coding agent's own assignment, and the person GitHub adds with it, never count.
- The issue worker does not start for an issue that is opened or reopened with a person among its assignees and no coding agent or other bot among them.
- Only a person, and the rule above, apply the label. Only a person removes it. Unassigning does not remove it.

## Consequences

- A maintainer who assigns an issue to themselves or a colleague needs no label. Handing it back is removing the label.
- A repository whose issue templates or automation assign every new issue to someone has every issue labelled: `check-deployment` warns about a template with `assignees:`.
- One more small job on `assigned`; every other workflow keeps checking only the label. `tools/opt-out.test.mjs` pins the conditions.
- The record on the label is superseded; its index row and status change.

## Alternatives considered

- Treating the assignee as the opt-out everywhere without a label: it needs the same check in every workflow, and a retry would stand the Concierge down on its own work.
- Guarding only the issue worker: later workflows could still hand the issue on.
