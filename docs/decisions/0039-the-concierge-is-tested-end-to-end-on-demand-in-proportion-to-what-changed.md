---
status: accepted
date: 2026-10-30
decision-makers:
  - maintainers
applies-to:
  - tools/e2e/**
  - tools/e2e-*.test.mjs
  - .github/workflows/e2e.yml
  - docs/e2e.md
  - .claude/skills/cut-an-issue-concierge-release/**
issues:
  - gearsnlevers/issue-concierge#60
  - gearsnlevers/issue-concierge#61
---

# The Concierge is tested end to end on demand, in proportion to what changed

## Context and problem statement

Record 0033 gave the Concierge a sandbox of its own and left two things open: how often the suite runs (it said "on demand and weekly"), and whether a green run is a condition for rolling a release out. The suite has a price that 0033 did not weigh. It spends model credits; the runner files its issues under a person's account, so every comment of the Concierge on them is a mail to that person; and the private pair lives in private repositories, where a free plan limits Actions minutes and where the scheduled workflows of a deployment use them even when nothing is tested (on 2026-10-29 the private pair used up the month's included minutes and its jobs stopped starting). A test that runs when nothing changed protects nothing and costs all of that.

## Decision

- The sandbox and the scenarios stay as 0033 decided: two pairs of tiny repositories in an organisation of their own, scenarios as data, checks on what the design promises and never on a model's wording, a failed scenario run once more before it counts, the hold or the opt-out label on everything a scenario files, the scenarios of a pair one at a time, and no production repository.
- The suite runs on demand only, started by a maintainer. It never runs on a schedule and never on a pull request. A run is tied to a change; nothing is tested because time has passed.
- A release is proven in the sandbox before it is rolled out to any other deployment. What proof it needs follows what it changed:
  - every release: the four sandbox repositories are updated to it like any deployment, and the deployment check, the janitor dry run and the status page are clean there;
  - a release that changes how a gate behaves: also the suite on the public pair, and the scenario that exercises the changed behaviour repeated, because a model's answers vary;
  - a release that changes secrets, tokens, permissions or anything that depends on a repository being private: also the private pair.
- The public pair is the default. The private pair is paused (the repository variable of 0037) whenever no run is in progress and resumed only for a run, because a paused repository starts no gate.
- A stop by billing is not a result: a run that stopped because the plan's minutes or the budget ran out proves nothing about the release, and is neither counted nor excused.
- How a proof is run, what it costs and how to read it live in the release skill and in `docs/e2e.md`, which may name measured values with their date. This record does not.

## Consequences

- A change in a model or in GitHub with no change of ours is found by the next run a change calls for, or by a deployment's status page, not by a calendar. That is accepted.
- A release that changes only what no gate reads (documentation, the tools of this repository) needs no suite.
- The private pair is exercised less often. What it exists for, a token that cannot read the other repository, is exercised when a release touches that.
- A maintainer is told before a run that files issues under their account starts, and while the private pair is paused no scenario can run on it until it is resumed.

## Alternatives considered

- A weekly run as a canary (0033): it finds drift, but it spends credits, minutes and a maintainer's inbox every week on a project that did not change.
- Both pairs for every release: the private pair would use its minutes on changes that cannot reach it.
- Disabling the private pair's workflows between runs: it also stops the updater and the status page, and a disabled workflow is easy to forget; the pause is one variable that says so on the status page.
