---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - shared/**
  - docs/deployment.md
  - docs/updater.md
  - scripts/concierge-updater.mjs
---

# A repository tunes the gates with optional files, never by editing them

## Context and problem statement

Repositories differ in what a complete report is, what is out of scope, what "complex" or "risky" means and which repository owns what. The first design said to edit the installed workflow files and let `gh aw update` three-way merge the changes. With pinned releases and a managed set of files ([0001](0001-deployments-pin-a-released-version-never-main.md), [0002](0002-deployments-pull-their-updates-through-one-pull-request.md)) an edit to a managed file is overwritten by the next update. Recorded retroactively from the deployment guide and the updater.

## Decision

- The defaults live in the workflows. A repository changes behavior by adding files under `.github/agentic-workflows/`:
  - `issue-completeness.md`: what a complete report is, if its issue templates do not say
  - `scope.md`: what the project does not do; without it every request is in scope
  - `complexity.md` and `risk.md`: its own meaning of the two gauges ([0016](0016-complexity-and-risk-are-separate-gauges-and-either-high-stops-for-approval.md))
  - `related-repos.md`: which repository owns what, and the secret and release rules for each ([0019](0019-split-repositories-link-issues-and-never-transfer-them.md))
- Every file is optional, and a repository needs none for a basic setup. Templates are under `shared/` here, and a repository copies the ones it wants. The workflows read the files from the deployment's own repository, never from this one. A gate falls back to its built-in wording when a file is absent.
- What a deployment must change inside a workflow, such as the cross-repository token, the updater generates from these files instead of a person editing it.
- The updater lists the managed files that a deployment edited and says to move the change to one of these files, or to reject the update.
- There is no other configuration language, and no per-deployment switch for a behavior these files do not cover. The updater a deployment runs is the previous release's, so a setting it does not know yet would apply one release late.

## Consequences

- A behavior that has no file is a change to the Concierge and a release, not a local edit.
- A deployment otherwise keeps its own way of working ([0014](0014-the-concierge-does-not-configure-dependabot-in-deployments.md)).
