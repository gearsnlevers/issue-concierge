---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - aw.yml
  - docs/releases.md
issues:
  - vscheuber/repo-concierge#46
---

# The Concierge does not configure Dependabot in deployments

## Context and problem statement

Dependabot scans every workflow file in a repository, including the ones the Concierge delivers and the lock files its updater compiles. A deployment that runs it can get a pull request that edits a file the Concierge owns, and the next update overwrites that edit. This happened with `setup-node` in the updater workflow and with `gh-aw-actions/setup` in lock files. Whether and how a repository uses Dependabot is the choice of its maintainers.

## Decision

- The Concierge ships no `dependabot.yml` and requires no exclusion or ignore rule in a deployment. Each deployment goes about its business as its maintainers choose.
- The Concierge keeps its own pins current instead (record 0013), so the versions it delivers are not behind when a deployment's Dependabot looks.
- The update pull request lists an edited managed file under "Local changes this update overwrites". Compiled lock files are rebuilt from the definitions and are not listed.

## Consequences

- A deployment that runs Dependabot may still see a pull request for a managed file when an action releases between two Concierge releases. Closing it is the maintainers' decision.

## Alternatives considered

- A managed `dependabot.yml`, or required exclusions for the managed files: rejected, it forces configuration into repositories the Concierge does not own, and GitHub's documentation does not confirm `exclude-paths` for the `github-actions` ecosystem.
