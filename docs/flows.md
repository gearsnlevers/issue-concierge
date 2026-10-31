# What the Concierge does: its flows and workflows

This page lists everything Issue Concierge does for a repository that runs it. A **flow** is something that can happen to an issue or a pull request, from the first comment to the release. A **workflow** is one of the GitHub Actions workflows that carry the flows out. Both are numbered, so that "flow 4" here and "scenario 10" in [e2e.md](e2e.md), which tests some of the flows live, each mean one thing.

How it fits together: every issue goes through three gates, issue, plan and pull request. Each gate has a worker that produces something and a triage that classifies it, and a label hands the issue from one to the next ([README](../README.md#architecture), [multi-phase-design.md](multi-phase-design.md)). The Concierge only processes work from people, never merges, and never lifts a hold on its own: a maintainer does, by command or by label.

A workflow is either **model** (a gh-aw agent that reads, decides and writes labels and comments through validated safe outputs) or **plain** (a script in GitHub Actions, no model). Code decides what code can decide ([record 0011](decisions/0011-code-decides-what-code-can-decide-before-a-model-runs.md)), so most of the helpers are plain.

## Flows

| # | Flow | What happens | Workflows | Scenario |
| - | ---- | ------------ | --------- | -------- |
| 1 | From request to pull request | The issue worker analyses the request and issue triage hands it on. The plan worker writes a short plan and plan triage rates complexity and risk. When nothing holds the issue, the PR worker assigns the coding agent, its pull request is rated again and checked against the repository's own rules and decision records, and a maintainer reviews and merges. | 1a, 1b, 2a, 2b, 3a, 3b, 3c | 1, 8 |
| 2 | A request without enough details | The issue worker asks for what is missing in plain comments that never name a label. `needs-info` stops the issue; the reporter's answer starts the issue gate again. | 1a, 1b | 2 |
| 3 | A request outside the project's scope | A repository that keeps `scope.md` can exclude things. A request that matches an exclusion is declined with a short reason and closed as not planned (`out-of-scope`). One that may not fit the project is held for a maintainer (`scope-review`). | 1a, 1b | 3 |
| 4 | A request that changes what exists | Removing, renaming or replacing a command, option, exported function or format, breaking something that works today, or changing the architecture, is held (`needs-decision`) before anything is planned, and a reply from the reporter does not lift it. Bugs and small enhancements pass. A plan that finds such a change later is held as well (flow 9). | 1a, 1b, 2b | 6, 7, 8 |
| 5 | A valid request that is not urgent | It gets `backlog` and does not enter the plan gate. A change that is small and low in risk gets `low-hanging-fruit` and goes on anyway. | 1b | none |
| 6 | A report that is already handled | A strong duplicate is labelled `duplicate`. A bug that a later pull request or commit already fixed gets `already-fixed` and is closed. A report whose behaviour cannot be found gets `invalid` and is closed. Spam is labelled. | 1a, 1b | none |
| 7 | A request that depends on other work | A line that starts with `Depends on:`, `Blocked by:` or `Requires:` gives the issue `dependency-required`. The dependency watcher, with no model, removes it when the work is finished and the issue runs through the gates again. | 1b, 1c | 4 |
| 8 | An issue kept out of the Concierge | `no-auto-processing` stops everything: no gate, workflow or script labels, comments on or closes the item. Removing the label hands the issue over once. Issues opened by bots are never processed. | all | 5 |
| 9 | A plan that needs a person | `plan-approval-required` is added when complexity or risk is high, when the plan conflicts with a decision record, finds the code in another repository, finds a breaking change, or lists work in another repository. A maintainer can add it by hand to read a plan first. The PR worker assigns no coding agent while it is there. A maintainer approves, asks for a new plan, or declines (flow 13). | 2b, 2c | 1, 10 |
| 10 | A request that belongs in another repository | In a project split over repositories, the issue worker opens a linked issue in the related repository (held for plan approval) and marks the original `related-repo`. The reporter of the original is told. When the linked issue is closed by a merged fix, the original is commented on and either closed or labelled `waiting-for-release`. | 1a, 1d, 4b | none |
| 11 | Work sent back | By hand: a maintainer runs Route Back for the linked issue when the fix belongs where the original was filed after all. The original is held and handed to the plan gate there, and the linked issue is closed as not planned. | 4g | none |
| 12 | A fix that needs two repositories | The plan lists `Work item:` lines and plan triage holds it. By hand, a maintainer runs Spawn Work Items, which creates the work items in the related repository (held) and makes this issue wait for the ones that must come first. | 2a, 2b, 2d | none |
| 13 | A maintainer decides by command | A comment that starts with `/accept`, `/decline [reason]`, `/approve`, `/replan [what to change]`, `/retry` or `/help`, from a person with the role the repository sets (`triage` by default), does what that person could do with the labels by hand. An issue that waits for a maintainer carries one comment of the bot that says what is needed and is always the last comment. | 5b | 10, 11, 12 |
| 14 | The status issue | A pinned issue, "Issue Concierge status", written by a plain workflow: what waits for a maintainer, reporter replies nobody answered, which issues the Concierge manages and which not, how the gates are doing and what they cost, with the same numbers as JSON for a dashboard. It can mention maintainers about what has waited too long. | 5a | 9 |
| 15 | Pausing the Concierge | The repository variable `ISSUE_CONCIERGE_PAUSED` set to `true` (or `CONCIERGE_PAUSED`, its older name) makes every gate and every workflow that acts on an issue skip its run. The status issue, the updater and the deployment check still run, and the commands that would start a gate are refused. | all | none |
| 16 | After the merge | When a pull request closes an issue, the reporter gets the `## Resolution` text of the pull request, and the issue gets `waiting-for-release`. When a release is published, the issues it contains are marked `released` with a comment that says which release, decided by git and not by the release notes. | 4c, 4d | none |
| 17 | An issue that stalled | An issue the worker analysed but that never reached triage is given the gate label again by a sweep, a bounded number of times. The sweep never lifts a hold and never comments. | 1e | none |
| 18 | Labels and runs kept tidy | An issue shows where it is, not where it has been: when the next gate label exists the earlier one goes, and when an issue closes the labels that describe open work go. Runs the coding agent leaves waiting for approval, which could only become skipped runs, are deleted. | 4a | none |
| 19 | Staying current | Each day the updater opens one pull request that moves a repository to the newest release of the version channel it pins. The deployment check reports a setup that cannot do what the repository's files promise. | 4e, 4f | none |

"Scenario" is the number of a live end-to-end scenario in [e2e.md](e2e.md#the-scenarios) that tests the flow in a sandbox. `none` means that no live scenario tests it yet; the unit tests still do.

## Workflows

They are named `Issue Concierge <code> [▸ ]<Name>` so that the Actions sidebar lists them in the order they run, and `▸` marks the ones that can also be started by hand ([naming](multi-phase-design.md#workflow-names)). Each flow above lists the codes of the workflows it uses.

| Code | Name | File | Kind | Starts when | Flows |
| ---- | ---- | ---- | ---- | ----------- | ----- |
| 1a | Issue Worker | `issue-worker.md` | model | an issue is opened, edited or commented on, and by hand for one issue | 1, 2, 3, 4, 6, 10 |
| 1b | Issue Triage | `issue-triage.md` | model | `issue-worker-ready` | 1, 2, 3, 4, 5, 6, 7 |
| 1c | Dependency Watch | `dependency-watch.yml` | plain | hourly, when something a dependency waits for happens, and by hand | 7 |
| 1d | Reporter Notify | `reporter-notify.yml` | plain | a linked issue is opened or gets a label that matters, and by hand | 10 |
| 1e | Stalled Issue Sweep | `stalled-issue-sweep.yml` | plain | hourly, and by hand for one issue or all | 17 |
| 2a | Plan Worker | `plan-worker.md` | model | `issue-triage-handoff` | 1, 12 |
| 2b | Plan Triage | `plan-triage.md` | model | `plan-worker-ready` | 1, 4, 9, 12 |
| 2c | Approval Resume | `plan-approval-resume.yml` | plain | a maintainer removes `plan-approval-required`, and by hand | 9 |
| 2d | Spawn Work Items | `spawn-work-items.yml` | plain | by hand, for an issue whose plan lists work in the related repository | 12 |
| 3a | PR Worker | `pr-worker.md` | model | `plan-triage-handoff` | 1 |
| 3b | PR Ready Signal | `pr-ready-signal.yml` | plain | the coding agent finishes, and by hand for one pull request | 1 |
| 3c | PR Triage | `pr-triage.md` | model | `pr-worker-ready` | 1 |
| 4a | Janitor | `janitor.yml` | plain | after gate labels change, on assignment and on close, hourly, and by hand | 18 |
| 4b | Related Repo Closer | `related-repo-closer.yml` | plain | a linked issue is closed, and by hand for one issue | 10 |
| 4c | Waiting for Release | `waiting-for-release.yml` | plain | an issue is closed by a merged pull request, and by hand for one issue | 16 |
| 4d | Release Closer | `release-closer.md` | model | a release is published | 16 |
| 4e | Updater | `issue-concierge-updater.yml` | plain | daily, and by hand | 19 |
| 4f | Check Deployment | `check-deployment.yml` | plain | on pull requests, and by hand | 19 |
| 4g | Route Back | `route-back.yml` | plain | by hand, for the linked issue of a split | 11 |
| 5a | Status | `status.yml` | plain | a label that matters changes, on a comment, hourly, and by hand | 14 |
| 5b | Commands | `commands.yml` | plain | a comment, a label that changes what waits for a maintainer, an issue closing or reopening, hourly, and by hand | 13 |

Flows 8 and 15 are not in the last column: the opt-out label and the pause variable are read by every workflow that acts on an issue or a pull request.

Where the rest is: the rules each flow follows are the [decision records](decisions/README.md), the label and run details are in [multi-phase-design.md](multi-phase-design.md), installing and tuning a repository is in [deployment.md](deployment.md), and how a release reaches a repository is in [releases.md](releases.md) and [updater.md](updater.md).
