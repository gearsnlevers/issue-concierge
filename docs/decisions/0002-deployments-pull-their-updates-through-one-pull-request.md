---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/concierge-updater.yml
  - scripts/concierge-updater.mjs
issues:
  - vscheuber/repo-concierge#7
  - vscheuber/repo-concierge#15
---

# Deployments pull their updates through one pull request

## Context and problem statement

The Concierge knows nothing about its deployments, and `gh aw add` and `gh aw update` fit badly: `add` resolves a tag to a SHA and loses the tag, a `source:` line changes every lock file on each pin bump, and `update` three-way merges and conflicts exactly where deployments edit. Recorded retroactively from the updater's design (#7).

## Decision

- `concierge-updater.yml`, a plain workflow with no model, and `scripts/concierge-updater.mjs` are delivered to every deployment. They read `.github/concierge.yml`, find the latest release of the channel, and check the manifest (for that tag, naming that commit) and every file's SHA-256 at that commit before writing anything.
- They compile the definitions with the gh-aw version the manifest names, create missing labels, and open or update ONE pull request. gh-aw is used only to compile, never to `add` or `update`.
- The branch `concierge/update` is rebuilt from the default branch on every run and force-pushed. Nobody pushes to it or merges into it, so lock-file conflicts between update pull requests cannot happen.
- The pull request lists the release notes, the files added, changed and removed, the secrets the release needs, and the managed files a deployment edited that the update overwrites.
- A pinned deployment that finds no usable release fails instead of reporting success (#15).
- Deployments are found from the pin file each one carries. This repository keeps no list of them.

## Consequences

- Without the optional `CONCIERGE_TOKEN` the updater only reports.
- Compiled lock files are rebuilt from the definitions, so a hand edit to one is replaced without being listed.
