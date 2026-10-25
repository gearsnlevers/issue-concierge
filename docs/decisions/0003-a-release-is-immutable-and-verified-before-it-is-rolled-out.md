---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - .github/workflows/release.yml
  - .claude/skills/cut-a-concierge-release/**
issues:
  - vscheuber/repo-concierge#10
---

# A release is immutable and verified before it is rolled out

## Context and problem statement

Releases are immutable on this repository, and a published immutable release cannot take assets. Creating a release with its manifest in one step fails, and a dry run cannot test it (#10). A published release that is wrong cannot be repaired. Recorded retroactively from the release workflow and the release skill.

## Decision

- A maintainer starts the Release workflow by hand, with a dry-run input that commits, tags and publishes nothing.
- It creates the release as a draft with the manifest attached, then publishes it. A draft left by a failed run is deleted and recreated. A published release is never touched.
- A mistake in a published release is fixed forward with a new version. A tag is never moved and a release is never deleted.
- Before a rollout the release is verified: published, immutable, attested manifest, manifest for that tag and its commit. After the rollout every deployment's default branch is compared file by file with the manifest, and every lock file with the gh-aw version it names (`.claude/skills/cut-a-concierge-release`).

## Consequences

- Rolling out a bad release means releasing again, so the dry run and the comparison with the previous release are not optional.
- The update pull requests are merged only when every check is green and the diff is the one the release comparison predicted.
