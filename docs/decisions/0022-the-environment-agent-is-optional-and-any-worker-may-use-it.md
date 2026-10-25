---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - shared/env-agent-contract.md
  - workflows/issue-worker.md
  - workflows/plan-worker.md
  - workflows/pr-worker.md
---

# The environment agent is optional, and any worker may use it

## Context and problem statement

A sandboxed runner can read code and run unit tests. It cannot always reproduce a bug against a live system or record the integration tests that a project relies on. What a repository can do there is specific to it, so the Concierge cannot ship it. Recorded retroactively from the founding design discussion, `shared/env-agent-contract.md` and the gate prompts.

## Decision

- The Concierge defines a contract and no implementation. A worker requests the capability with a comment or label that the repository's own workflow listens for, or with a structured safe output that a local workflow turns into a call. It passes the issue or pull request, the relevant paths and the action it wants. It gets back success or failure, artifacts such as recordings, snapshots, logs or new tests, and a confidence note.
- A repository that wants one supplies it: a self-hosted runner, a reusable workflow or an external agent. A repository that does not is unaffected.
- Any worker in any gate may request it, if it is defined. It is not a gate and no worker waits on it. The prompts of the issue worker, the plan worker and the PR worker say that they may request it and proceed without it.
- Workers must work correctly when it is absent, with less confidence in what they could not check.

## Consequences

- The Concierge ships no implementation, so beyond what a runner can do, reproduction is not done by default. The already-fixed and cannot-reproduce checks read the code and its history only ([0017](0017-the-issue-gate-closes-an-issue-only-on-evidence.md)).
- A repository that adds one decides what it may touch and what it costs. Its credentials stay in that repository ([0021](0021-one-secret-per-privilege.md)).

## Alternatives considered

- Reproduction as a gate of its own: considered first, then generalized. The same capability serves test creation at the PR gate, and a gate that most repositories would skip is a poor place for it.
