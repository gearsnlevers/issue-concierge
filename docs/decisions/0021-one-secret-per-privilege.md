---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - requirements.json
  - docs/deployment.md
  - workflows/**
---

# One secret per privilege

## Context and problem statement

Several steps need a credential that the workflow's own token lacks. GitHub starts no workflow from an event created with that token, so a label it applies starts no next gate. It also cannot assign the Copilot coding agent or write to another repository. One broad token would be easy to create and would give every gate the privilege of the widest one. Recorded retroactively from the deployment guide and `requirements.json`.

## Decision

- Each credential has one purpose and a conventional name:
  - `SIGNAL_TOKEN` applies and removes labels on issues and pull requests so that the next gate starts. It is the `github-token` of the `add-labels` outputs and of the plain workflows that change labels, except where a label goes to another repository.
  - `GH_AW_AGENT_TOKEN` assigns the Copilot coding agent, for the PR worker only. Its owner needs a Copilot subscription.
  - `COPILOT_GITHUB_TOKEN` runs the engine, unless the organization bills Copilot centrally.
  - A secret per related repository, named by the deployment in `related-repos.md`, creates and closes issues there ([0019](0019-split-repositories-link-issues-and-never-transfer-them.md)). The Concierge does not choose its name.
  - `CONCIERGE_TOKEN` is optional and lets the updater open its pull request ([0002](0002-deployments-pull-their-updates-through-one-pull-request.md)).
- A release that a deployment's own pipeline creates uses a token that is not the workflow token (`RELEASE_TOKEN` in the deployment guide), so that the published release starts the release closer. It is separate from `SIGNAL_TOKEN`: a token that can publish a release is wider than a hand-off needs.
- Tokens are fine-grained, limited to the repositories that need them, and expire (the guide's forms pre-fill 90 days).

## Consequences

- A deployment creates several secrets and renews them. A token belongs to a person, so a flow stops when it expires or its owner leaves.
- The secrets in `requirements.json` are part of a release. A new required one is a major change ([0001](0001-deployments-pin-a-released-version-never-main.md)).

## Alternatives considered

- One token for everything: rejected, for the reason above.
- `SIGNAL_TOKEN` with Contents write, to create releases with it: rejected. Only the release step needs that privilege.
