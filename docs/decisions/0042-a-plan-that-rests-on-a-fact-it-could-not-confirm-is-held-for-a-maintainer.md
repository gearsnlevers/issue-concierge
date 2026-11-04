---
status: accepted
date: 2026-11-04
decision-makers:
  - maintainers
applies-to:
  - workflows/plan-worker.md
  - workflows/plan-triage.md
  - workflows/pr-worker.md
  - scripts/commands.mjs
  - docs/multi-phase-design.md
issues:
  - rockcarver/frodo-cli#591
---

# A plan that rests on a fact it could not confirm is held for a maintainer

## Context and problem statement

[0016](0016-complexity-and-risk-are-separate-gauges-and-either-high-stops-for-approval.md) stops a plan for approval when complexity or risk is high, because a plan whose cause was still a hypothesis once went straight to the coding agent. Complexity and risk measure effort and blast radius; they do not measure whether the plan is true. A plan can be medium and low and still rest on a fact nobody confirmed: the name of an object in another system, the form of a file, what a linked page says. A coding agent started on it fills the gap from memory, and its pull request reads as if the fact were known.

On 2026-11-04 a plan marked the name of a configuration entity "Hypothesis (unverified)" and listed it as an open question. Plan triage rated it medium and low and handed it on. The coding agent's firewall blocked the documentation host, its two fetches failed, it named an entity from memory in the same step as the first fetch, and the pull request presented the name as fact. The name was wrong.

## Decision

- The plan worker writes one line, "Unverified: {the fact} | tried: {what it read or fetched, and what stopped it}", for each fact (three at most) that decides what the change does and that it could not confirm from the code, the tests, the guidance, the records or a page it read. A lookup that was blocked, refused or empty confirmed nothing. A cause labelled "Hypothesis (unverified)" that the change would fix counts. It never writes a candidate into the plan as if it were the answer.
- The line is not written for a detail the coding agent can read in the code, for a choice of design or scope (an open question for review), or for a fact that was confirmed.
- Plan triage holds such a plan like a wrong layer or a breaking change: it classifies and lowers neither label, adds `plan-approval-required`, emits no hand-off and says that a maintainer has to supply the fact or accept the risk. It never lifts the hold.
- A maintainer lifts it with `/replan` (the comment carries the answer) or `/approve` (the coding agent goes on without it). The options comment offers both and names the reason.
- The static instructions that travel with the PR worker's assignment tell the coding agent not to build on a guess: when a fact the plan leaves unverified or open cannot be confirmed, it stops and comments on the issue, and it says in the pull request description which facts it could not confirm, a blocked lookup included.
- The prompts are the first layer. The guarantee under them is the hold that the PR worker's `if:` enforces and that no model can lift.

## Consequences

- A plan that guesses costs a maintainer one command; a plan that does not costs nothing. Whether a fact "decides what the change does" is a model's call and will sometimes be wrong in either direction. The hold, the human review and the missing auto-merge stand behind it.
- If plans are held for trivia, the wording of the line is tightened; the hold is not dropped.
- The Concierge cannot see the network allow-list of a repository's coding agent. A repository whose agent needs a documentation host adds it in its own settings.
- Kept in sync with this record: both prompts, `planReason` and the sentences in `scripts/commands.mjs`, `tools/unverified-fact.test.mjs`, and the design document.

## Alternatives considered

- Holding every medium plan: pauses a large share of agent pull requests, nearly all of which were merged; the failures were unverified facts and wrong layers, not size.
- A stronger model or more effort for the coding agent: not rejected, but unproven for this failure (the agent never saw the page) and it costs on every run. It is revisited with data.
- Holding on any open question: choices of design and scope are for review; holding on all of them would stop most plans.
- A deterministic rule in code: there is no signal for an unconfirmed fact outside the plan's own words.
