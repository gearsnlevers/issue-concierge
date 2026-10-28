---
status: accepted
date: 2026-10-27
decision-makers:
  - maintainers
applies-to:
  - workflows/issue-worker.md
  - workflows/issue-triage.md
  - workflows/plan-worker.md
  - workflows/plan-triage.md
  - shared/guard.md
  - requirements.json
  - scripts/janitor.mjs
  - docs/multi-phase-design.md
---

# A request that changes what exists is held for a maintainer

## Context and problem statement

The Concierge is meant to deal with bugs, where something that exists is broken, and to pick up small enhancements. It is not meant to remove a command, rename an option or move the architecture because an issue argued well for it. Nothing in the gates looked at the kind of change. The scope check matches a request against a list the repository chooses to write and says to leave out what is only "large, hard, risky or unusual". The only brake was plan triage's risk label, set by a small model, after a plan had been written.

Two probes in the end-to-end sandbox on 2026-10-27 showed it: a request to remove a function and its command, worded as safe, was rated "low to medium" risk and parked as `backlog` only because it did not sound urgent. The same request, urgent and with a replacement suggested, was planned in full and held only because the risk came out high.

## Decision

- A request that changes what exists is held for a maintainer before anything is planned. "Changes what exists" means: removing, renaming or replacing a command, an option, an alias, an exported function or a file or data format; changing an interface so that something that works today stops working or reads differently to a script (a signature, the meaning of an option, an output format or an exit code someone may parse, a default that changes what a command does); changing the architecture. A fix that restores documented behavior, an addition, and a refinement inside what the project documents and tests are not held, so that bugs and small enhancements keep being picked up.
- The issue worker decides by the effect of the change and never by the argument for it, and when it hesitates between an addition and a change it chooses the change. Issue triage applies the label `needs-decision`, emits no hand-off and closes nothing. A reporter's reply does not lift it. A maintainer does, by removing the label and adding `issue-triage-handoff`.
- This is a check of its own, on by default in every repository, and not part of `scope.md`. Scope answers "is this ours?", can close, and is optional. This answers "may it be changed without a person?" and only ever holds. A repository may add `.github/agentic-workflows/guard.md` to name what it protects and what it lets through freely; the file sharpens the check and can never lift a hold or change a gate.
- The plan worker is the second layer. A plan whose reading of the code shows a removal, a rename or a change of behavior carries a "Breaking change:" line, and plan triage holds it with `plan-approval-required` like a wrong layer. A removal is therefore approved twice: to be planned, and to be built.
- The prompts are a first layer. The guarantee under them is the hold that the PR worker's `if:` already enforces and that no model can lift.

## Consequences

- A new required label, `needs-decision`, in every deployment: the next release is a major release.
- A maintainer sees a held request and decides; a request that was only worded like a removal costs one look. The check errs towards holding, and the scenarios of the end-to-end suite (a bug fix, a small addition) are the check on the other side.
- Judging the kind of change is a model's call and will sometimes be wrong in either direction. The hold, the human review and the missing auto-merge are what stand behind it.
- `scope-review` keeps its meaning (the request may not fit the project) and is not used for this.

## Alternatives considered

- Listing the protected things in `scope.md` under "Needs a maintainer": works today with no change here, but mixes two questions in one file, is off in a repository without the file, and the template tells owners not to list what is merely risky.
- Reusing `scope-review`: no new label, but a removal request would carry a label named after scope.
- Closing such a request as not planned: a maintainer's own deprecation issue would be closed by a bot, and [0017](0017-the-issue-gate-closes-an-issue-only-on-evidence.md) closes only on evidence.
- Relying on the risk label alone: it did not hold one of two probes before a plan was written.
