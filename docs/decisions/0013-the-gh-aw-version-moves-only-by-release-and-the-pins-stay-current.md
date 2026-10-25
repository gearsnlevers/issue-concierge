---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - requirements.json
  - tools/ci-compile-smoke.sh
  - tools/check-currency.mjs
  - .github/workflows/currency-check.yml
issues:
  - vscheuber/repo-concierge#45
  - vscheuber/repo-concierge#46
  - vscheuber/repo-concierge#47
---

# The gh-aw version moves only by release, and the pins stay current

## Context and problem statement

The compiled lock files in a deployment depend on the gh-aw version, so a deployment compiles only with the version a release names and its lock files change only when a release says so. That held until Dependabot edited the `gh-aw-actions/setup` references inside lock files in two deployments, leaving each file half on one version and half on another. The Concierge's own pins had also gone stale where no tool looks: the `workflows/` folder and `requirements.json`.

## Decision

- `ghAw.version` in `requirements.json` is the only gh-aw version. The manifest carries it, the updater compiles with it, and CI and the release compile every workflow with it.
- A gh-aw move is a release like any other. Before it, compile with both versions and compare the lock files for secrets, permissions, the set of actions and the budgets, read the gh-aw release notes for breaking changes, and run `tools/ci-compile-smoke.sh`.
- The pin follows the latest stable gh-aw release, and the actions pinned in `workflows/` and `.github/workflows/` follow theirs.
- A weekly workflow, `Currency check`, compares them with the latest releases and keeps one open issue listing what is behind, closing it when nothing is.

## Consequences

- Dependabot cannot see `workflows/` or `requirements.json`, so this check is the only thing that notices.
- A release that moves gh-aw changes every lock file in every deployment, which the release comparison states.
