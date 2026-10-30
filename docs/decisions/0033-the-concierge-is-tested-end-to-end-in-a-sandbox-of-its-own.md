---
status: superseded by 0039
date: 2026-10-26
decision-makers:
  - maintainers
applies-to:
  - tools/e2e/**
  - tools/e2e-*.test.mjs
  - .github/workflows/e2e.yml
  - docs/e2e.md
issues:
  - gearsnlevers/issue-concierge#60
  - gearsnlevers/issue-concierge#61
---

# The Concierge is tested end to end in a sandbox of its own

## Context and problem statement

The unit tests pin the text of the prompts and the logic of the scripts, but what a model does with a prompt, and what GitHub does with a label, a comment or a run, is seen only in a real deployment. Several rules reached the deployments before they had run live: a label held back as a suggestion, an intake that ran out of turns, a route back, a split between two repositories. Each was found on a real issue of a real project.

## Decision

- A set of scenarios files mock enhancements in sandbox repositories and lets the real gates run on them. The scenarios are data in `tools/e2e/scenarios/`, the runner is `tools/e2e/run.mjs`, and the sandbox is seeded from `tools/e2e/sandbox/`.
- The sandbox is two pairs of tiny repositories, a library and an app that calls it, in an organisation of their own: a public pair, which mirrors the deployments, and a private pair, which shows what breaks when the workflow token cannot read the other repository. No production repository is used.
- A scenario asserts what the design promises (labels, the comment each gate leaves, how an issue ends, that no run failed), never the model's wording. A check that varies with the model is a warning, not a failure, and a failed scenario is run once more before it counts.
- Every issue a scenario files carries the hold or the opt-out label, so no coding agent is assigned, no code is written and no pull request is merged.
- The scenarios of a pair run one at a time, because nothing ties a gate's run to an issue; the pairs run side by side.

## Consequences

- A behaviour "not seen live" can be seen live on demand, at the price of the model runs it starts; so the suite is run on demand and weekly, not on every pull request.
- The sandbox needs its own tokens and a recurring renewal (the tokens, and the interaction limit on the public repositories).
- Whether a green run is a condition for rolling a release out is not decided here.

## Alternatives considered

- Running the scenarios against a fork of a production project: its history, labels and people would be touched by test issues.
- Mocking GitHub and the model: it would test our assumptions, which is what failed before.
