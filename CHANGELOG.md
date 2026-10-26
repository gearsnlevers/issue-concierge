# Changelog

## [v1.5.0] - 2026-10-26

### What's Changed
* feat: tell the reporter how an issue was resolved, and cite records by full URL by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/56

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.4.0...v1.5.0

## [v1.4.0] - 2026-10-25

### What's Changed
* feat: an item labelled no-auto-processing is never touched by the Concierge by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/55

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.3.2...v1.4.0

## [v1.3.2] - 2026-10-25

### What's Changed
* fix: the related-repo closer does not ask who opened the canonical issue by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/54

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.3.1...v1.3.2

## [v1.3.1] - 2026-10-25

### What's Changed
* fix: a closer installed by the previous updater is a warning to finish, not an error by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/53

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.3.0...v1.3.1

## [v1.3.0] - 2026-10-25

### What's Changed
* fix: the related-repo closer is a script, not a model by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/52

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.2.0...v1.3.0

## [v1.2.0] - 2026-10-25

### What's Changed
* feat: mark the canonical issue of a link with original-in-related-repo, and start the related-repo closer only for it by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/51

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.1.2...v1.2.0

## [v1.1.2] - 2026-10-25

### What's Changed
* docs: start the decision record log, and add AGENTS.md by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/48
* docs: write decision records so they stay true by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/49
* fix: the release closer decides from git which fixes a release contains by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/50

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.1.1...v1.1.2

## [v1.1.1] - 2026-10-25

### What's Changed
* chore: compile and test the gates with gh-aw v0.93.3 by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/47

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.1.0...v1.1.1

## [v1.1.0] - 2026-10-25

### What's Changed
* chore: compile and test the gates with gh-aw v0.93.0 by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/45
* feat: a weekly check that the Concierge's own pins are current by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/46

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.22...v1.1.0

## [v1.0.22] - 2026-10-25

### What's Changed
* chore: the updater workflow uses actions/setup-node v7 by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/44

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.21...v1.0.22

## [v1.0.21] - 2026-10-24

### What's Changed
* fix: Waiting for Release skips hand closes and stops re-reading the same pull request by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/43

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.20...v1.0.21

## [v1.0.20] - 2026-10-24

### What's Changed
* feat(reporter-notify): tell the original reporter when a linked issue is created by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/42

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.19...v1.0.20

## [v1.0.19] - 2026-10-24

### What's Changed
* docs: agent skills for releasing and for changing a gate by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/40
* Issue routing: decide from the report text, start routed issues held, check the layer at the plan gate by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/41

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.18...v1.0.19

## [v1.0.18] - 2026-10-24

### What's Changed
* Gates read the repository's decision records (docs/decisions) by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/39

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.17...v1.0.18

## [v1.0.17] - 2026-10-24

### What's Changed
* Plan gate: a hold added by hand stops the PR worker, and removing it resumes the issue by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/37
* Mention the original reporter when a linked issue needs information by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/38

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.16...v1.0.17

## [v1.0.16] - 2026-10-24

### What's Changed
* Plan triage: describe the plan marker in text that survives prompt rendering by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/36

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.15...v1.0.16

## [v1.0.15] - 2026-10-23

### What's Changed
* Plan gate: high risk requires plan approval like high complexity by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/33
* Janitor: leave one held run to approve per agent pull request by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/34
* A closed issue starts no gate; an open fix pull request stops the hand-off by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/35

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.14...v1.0.15

## [v1.0.14] - 2026-10-23

### What's Changed
* Open the issue worker to reporters without write access by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/31
* Raise PR Triage max-ai-credits from 16 to 24 by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/32

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.13...v1.0.14

## [v1.0.13] - 2026-10-23

### What's Changed
* Plan and PR gates read the repository's own guidance (AGENTS.md, .github/instructions) by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/30

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.12...v1.0.13

## [v1.0.12] - 2026-10-23

### What's Changed
* refactor: rename the label janitor to janitor by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/28
* feat(janitor): delete held Issue Worker runs left by the coding agent's comments by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/29

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.11...v1.0.12

## [v1.0.11] - 2026-10-23

### What's Changed
* fix(release-closer): check the triggering release and closed issues by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/27

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.10...v1.0.11

## [v1.0.10] - 2026-10-23

### What's Changed
* fix(pr-triage): give each label event its own concurrency group by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/26

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.9...v1.0.10

## [v1.0.9] - 2026-10-23

### What's Changed
* fix(issue-worker): name the linked issue with a fixed temporary id by @vscheuber in https://github.com/vscheuber/repo-concierge/pull/25

**Full Changelog**: https://github.com/vscheuber/repo-concierge/compare/v1.0.8...v1.0.9

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
