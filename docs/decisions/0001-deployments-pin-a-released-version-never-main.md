---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - aw.yml
  - requirements.json
  - tools/build-release-manifest.mjs
issues:
  - vscheuber/repo-concierge#6
---

# Deployments pin a released version, never main

## Context and problem statement

A repository that runs the Concierge's gates does what the gates say. If it followed `main` it would take every unreleased change at once, and nobody could say which version produced a given run. Recorded retroactively from the README, `docs/releases.md` and the release pipeline.

## Decision

- A deployment pins a released version in `.github/concierge.yml`: source, version, commit and channel. `main` is work in progress.
- A release carries notes and `release-manifest.json`: version, tag, commit, the gh-aw version, the labels and secrets it needs, and a SHA-256 digest for every file a deployment installs (the list in `aw.yml`).
- The default channel ignores prereleases. Patch is for fixes and wording, minor for changes that need nothing from a deployment, major when a human has to do something: a new required secret, label or setting, or a removed or renamed workflow.
- A gate changes in a deployment only through a release, never by editing the deployment.

## Consequences

- A fix to a gate is a release plus an update pull request in every deployment. A hand edit to a managed file in a deployment is overwritten by the next update.
- Everything a release changes is visible in one manifest comparison before it is rolled out.
