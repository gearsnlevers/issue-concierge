# Changelog

## [v1.0.8] - 2026-10-23

### What's Changed
* fix(pr-gate): give each label event its own janitor group, and have PR triage report CI by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/23
* fix(pr-triage): run on pull_request_target so label events do not queue runs held for approval by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/24

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.7...v1.0.8

## [v1.0.7] - 2026-10-23

### What's Changed
* fix(pr-gate): signal from the agent's timeline, and document the token it needs by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/22

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.6...v1.0.7

## [v1.0.6] - 2026-10-22

### What's Changed
* feat(workflows): name the workflows in run order and mark the dispatchable ones by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/21

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.5...v1.0.6

## [v1.0.5] - 2026-10-22

### What's Changed
* fix(labels): keep every label within GitHub's limits; check it at build time by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/19
* feat(pr-gate): add the pr-worker-ready label for the coding agent by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/20

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.4...v1.0.5

## [v1.0.4] - 2026-10-22

### What's Changed
* fix(issue-gate): dependency waits no longer become backlog; add low-hanging fruit by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/16
* feat(issue-gate): scope check from an optional scope.md by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/17
* feat(labels): label janitor keeps issues showing where they are by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/18

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.3...v1.0.4

## [v1.0.3] - 2026-10-22

### What's Changed
* docs(updater): treat the pin and gh-aw lock cache as non-code in the deployment's CI by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/14
* fix(updater): fail when a pinned deployment finds no usable release by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/15

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.2...v1.0.3

## [v1.0.2] - 2026-10-22

### What's Changed
* fix(pr-worker): send the coding agent's instructions as custom-instructions by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/13

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.1...v1.0.2

## [v1.0.1] - 2026-10-22

### What's Changed
* fix(release): publish as a draft with the manifest, then undraft by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/10
* docs(updater): export a token before the manual first adoption by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/11
* fix(pr-worker): assign without issue-intent metadata by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/12

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.0...v1.0.1

## [v1.0.0] - 2026-10-22

### What's Changed
* feat: dependency gating by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/1
* fix(issue-worker): never withhold issue-worker-ready for a declared dependency by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/2
* fix: removing plan-approval-required resumes the pipeline by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/3
* fix: stop processing bot-authored issues and comments; PR Worker uses the small model by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/4
* fix: event-driven dependency watch, cross-repo allowed-repos, deployment check by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/5
* feat: rename to Repo Concierge and add CI and a release pipeline by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/6
* feat: concierge-updater, the pull-based way deployments pick up releases by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/7
* fix(pr-worker): check labels in the activation condition and never read the issue by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/8
* fix(changelog): put the notes' headings one level below the release heading by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/9

### New Contributors
* @vscheuber made their first contribution in https://github.com/vscheuber/repo-concierge/pull/1

**Full Changelog**: https://github.com/vscheuber/repo-concierge/commits/v1.0.0
