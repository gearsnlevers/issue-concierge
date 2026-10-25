# Decision records

A decision record explains one lasting decision: why we chose it, what it means and what we gave up. Records are plain Markdown in the repository, so every contributor and every coding agent, whatever tool it uses, reads the same thing.

This folder holds the decisions of Repo Concierge itself: how it is released and delivered, how its gates behave, what they may and may not do, and how it stays current. It is not delivered to deployments. A deployment writes its own records in its own `docs/decisions/` (or `decisions/` at the root), which the gates read ([0006](0006-gates-read-the-repositorys-own-guidance-and-decision-records.md)). The frodo repositories keep a few records that describe the Concierge from their side (core 0002 and core 0004 in [frodo-cli](https://github.com/rockcarver/frodo-cli/tree/main/docs/decisions/core)).

## Rules

- An accepted record is binding for humans and agents until a newer record supersedes it. An agent whose task conflicts with one stops and says so in the issue or pull request.
- Only lasting decisions get a record: something you would be surprised to see reversed without discussion. Not minor implementation notes or routine refactors.
- An accepted record is not edited, except for typos and for a `Known deviations` section, a status note that may be added, edited or removed, without a new record, in the pull request that fixes the deviation or opens its tracking issue. A changed decision is a new record: set the old record's status to `superseded by NNNN` and update the index.
- A pull request that changes a decided behaviour adds or supersedes a record in the same pull request.
- Records are public. No credentials, tenant names, security-incident details or personal information.
- Write a record so it stays true: state the rule, not a value that changes. Leave out "currently", "now", "the latest" and any current version, count, size or line number. Say "e.g." or "for example" when an example helps, and date a fact that explains the decision ("on 2026-10-24 the pin was ..."). An accepted record is not edited to keep up with such a fact, so it must not contain one.
- `applies-to:` lists path globs where that helps; `issues:` lists related issues and pull requests as `owner/repo#N`.
- A record written after the fact says so in its context ("Recorded retroactively from ...") and describes what the code and the history show.

## Writing one

Copy `template.md` to `NNNN-short-title.md` (the next number, starting at 0001), fill it in (aim for under 40 lines) and add a row to the index. Besides the three required sections, a record may have `## Known deviations` and `## Alternatives considered`. `node tools/validate-decision-records.mjs` checks this folder; CI runs the same check.

## Index

| # | Title | Status |
| - | - | - |
| 0001 | [Deployments pin a released version, never main](0001-deployments-pin-a-released-version-never-main.md) | accepted |
| 0002 | [Deployments pull their updates through one pull request](0002-deployments-pull-their-updates-through-one-pull-request.md) | accepted |
| 0003 | [A release is immutable and verified before it is rolled out](0003-a-release-is-immutable-and-verified-before-it-is-rolled-out.md) | accepted |
| 0004 | [Gates advance by labels](0004-gates-advance-by-labels.md) | accepted |
| 0005 | [A maintainer holds the levers of the pipeline](0005-a-maintainer-holds-the-levers-of-the-pipeline.md) | accepted |
| 0006 | [Gates read the repository's own guidance and decision records](0006-gates-read-the-repositorys-own-guidance-and-decision-records.md) | accepted |
| 0007 | [Only the issue worker is open to every reporter](0007-only-the-issue-worker-is-open-to-every-reporter.md) | accepted |
| 0008 | [Closed issues and bot activity start no gate](0008-closed-issues-and-bot-activity-start-no-gate.md) | accepted |
| 0009 | [Issue routing decides from the report text](0009-issue-routing-decides-from-the-report-text.md) | accepted |
| 0010 | [Gate budgets follow measured runs](0010-gate-budgets-follow-measured-runs.md) | accepted |
| 0011 | [Code decides what code can decide before a model runs](0011-code-decides-what-code-can-decide-before-a-model-runs.md) | accepted |
| 0012 | [Workflows are named in run order](0012-workflows-are-named-in-run-order.md) | accepted |
| 0013 | [The gh-aw version moves only by release, and the pins stay current](0013-the-gh-aw-version-moves-only-by-release-and-the-pins-stay-current.md) | accepted |
| 0014 | [The Concierge does not configure Dependabot in deployments](0014-the-concierge-does-not-configure-dependabot-in-deployments.md) | accepted |
| 0015 | [Every gate has a worker that produces and a triage agent that classifies](0015-every-gate-has-a-worker-that-produces-and-a-triage-agent-that-classifies.md) | accepted |
| 0016 | [Complexity and risk are separate gauges, and either one at high stops for approval](0016-complexity-and-risk-are-separate-gauges-and-either-high-stops-for-approval.md) | accepted |
| 0017 | [The issue gate closes an issue only on evidence](0017-the-issue-gate-closes-an-issue-only-on-evidence.md) | accepted |
| 0018 | [Reporters are guided by plain comments, never by labels](0018-reporters-are-guided-by-plain-comments-never-by-labels.md) | accepted |
| 0019 | [Split repositories link issues and never transfer them](0019-split-repositories-link-issues-and-never-transfer-them.md) | accepted |
| 0020 | [Agents are read-only, and threat detection runs where untrusted text meets a write](0020-agents-are-read-only-and-threat-detection-runs-where-untrusted-text-meets-a-write.md) | accepted |
| 0021 | [One secret per privilege](0021-one-secret-per-privilege.md) | accepted |
| 0022 | [The environment agent is optional, and any worker may use it](0022-the-environment-agent-is-optional-and-any-worker-may-use-it.md) | accepted |
| 0023 | [A repository tunes the gates with optional files, never by editing them](0023-a-repository-tunes-the-gates-with-optional-files-never-by-editing-them.md) | accepted |
| 0024 | [A release contains a fix when git says so, not when the notes do](0024-a-release-contains-a-fix-when-git-says-so-not-when-the-notes-do.md) | accepted |
| 0025 | [Both issues of a link carry a label](0025-both-issues-of-a-link-carry-a-label.md) | accepted |
| 0026 | [The related-repo closer is code, not a model](0026-the-related-repo-closer-is-code-not-a-model.md) | superseded by 0027 |
| 0027 | [The related-repo closer trusts the proof of the link, not the author of the issue](0027-the-related-repo-closer-trusts-the-proof-of-the-link-not-its-author.md) | accepted |
| 0028 | [An item labelled no-auto-processing is never touched by the Concierge](0028-an-item-labelled-no-auto-processing-is-never-touched.md) | accepted |
