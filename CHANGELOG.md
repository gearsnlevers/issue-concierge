# Changelog

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
