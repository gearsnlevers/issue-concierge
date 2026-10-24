# Multi-Gate Design

Each stage is a gate. A worker agent produces an artifact and signals completion with a label. A separate triage agent reacts to that label, classifies the artifact, and signals the next gate with a hand-off label.

## Label convention

Worker completion signals use `<worker-name>-ready`.  
Triage hand-off signals use `<triage-name>-handoff`.

| Step | Label |
|------|-------|
| `issue-worker` finished | `issue-worker-ready` |
| `issue-triage` opens plan gate | `issue-triage-handoff` |
| `plan-worker` finished | `plan-worker-ready` |
| `plan-triage` opens PR gate | `plan-triage-handoff` |
| coding agent finished | `pr-worker-ready` |
| `pr-triage` finished | `pr-triage-handoff` |

Blocking labels use the form `<thing>-required`. Removing the label is the human signal to continue. The exception is `dependency-required`, which a watcher removes when the work the issue depends on is finished (see Dependency gate).

Labels are internal. Reporters are never asked to add, remove, or interpret them. All guidance to reporters is given in plain-language comments.

Two independent axes are applied by the triage agents:

- **Complexity** — design impact / autonomy
- **Risk** — blast radius

## Workflow names

The Actions sidebar sorts workflows by display name, so the names carry the order. They are all in the form `Concierge <phase><step> [▸ ]<Name>`:

- **`Concierge`** groups the harness together, ahead of the repository's own workflows.
- **The code** (a digit for the phase, a letter for the step) puts the workflows in the order they run. Workers and triages come first in each phase; the helpers that serve a phase sit after them; phase 4 holds what is not tied to one gate.
- **`▸`** marks a workflow that can be started by hand (it has `workflow_dispatch`). Workflows that run only on events carry no marker.

| Name | Runs when |
|------|-----------|
| `Concierge 1a ▸ Issue Worker` | an issue is opened, edited or commented (and by hand for one issue) |
| `Concierge 1b Issue Triage` | `issue-worker-ready` |
| `Concierge 1c ▸ Dependency Watch` | hourly, on dependency events, and on demand |
| `Concierge 1d ▸ Reporter Notify` | a linked issue is opened, or `plan-approval-required`, `issue-worker-ready` or `needs-info` is applied to it (and by hand for one issue) |
| `Concierge 2a Plan Worker` | `issue-triage-handoff` |
| `Concierge 2b Plan Triage` | `plan-worker-ready` |
| `Concierge 2c ▸ Plan Approval Resume` | a maintainer removes `plan-approval-required` (and by hand) |
| `Concierge 3a PR Worker` | `plan-triage-handoff` |
| `Concierge 3b ▸ PR Ready Signal` | the coding agent finishes (and by hand for one pull request) |
| `Concierge 3c PR Triage` | `pr-worker-ready` |
| `Concierge 4a ▸ Janitor` | after gate labels change, on assignment and on close, hourly, and on demand |
| `Concierge 4b Related Repo Closer` | a linked issue in a related repository closes |
| `Concierge 4c Waiting for Release` | an issue closes because a pull request merged |
| `Concierge 4d Release Closer` | a release is published |
| `Concierge 4e ▸ Updater` | daily, and on demand |
| `Concierge 4f ▸ Check Deployment` | on pull requests, and on demand |

The ordering holds whether the sidebar counts punctuation or ignores it, because the code is unique and sits before the marker. Names stay within about 40 characters (the longest is 35); longer ones truncate in the sidebar.

To add a workflow, give it the next free step letter in its phase (or a new phase digit), add `▸` only if it has `workflow_dispatch`, and set the name in the frontmatter (`name:`) of a gh-aw definition or at the top of a plain workflow. `tools/workflow-names.test.mjs` checks the format, that codes are unique, that the markers match what each workflow actually allows, and that sorting the names sorts the pipeline. File names are separate: they keep their stems (`issue-worker`, `janitor`) so reordering the display names never means renaming files.

## Label lifecycle

Gate labels are signals, not history. A label event starts the next workflow, so only the moment a gate label is added matters; once the next signal exists the earlier label has done its job and goes. At any moment an issue shows at most one gate label, which is where it is now. The history is in the timeline and in the plan comment. A plain Actions workflow, the **janitor** (`janitor.yml` with `janitor.mjs`, no LLM, no secret), does the removing.

**Gate labels**

| Label | On | Added by | Removed when |
|-------|----|----------|--------------|
| `issue-worker-ready` | issue | issue worker (the dependency watcher re-adds it) | issue triage applies any outcome: `issue-triage-handoff`, `backlog`, `needs-info`, `dependency-required`, `scope-review`, `out-of-scope`, `duplicate`, `invalid`, `already-fixed` or `spam` |
| `issue-triage-handoff` | issue | issue triage, or a maintainer (promote a `backlog` issue, override a scope decision) | `plan-worker-ready` is added |
| `plan-worker-ready` | issue | plan worker | `plan-triage-handoff` or `plan-approval-required` is added |
| `plan-triage-handoff` | issue | plan triage, or `plan-approval-resume` after approval | the coding agent is assigned to the issue |
| `pr-worker-ready` | pull request | the coding agent | `pr-triage-handoff` is added to the pull request, or it closes |
| `pr-triage-handoff` | pull request | PR triage | the pull request closes or merges |

An earlier label is removed only when the evidence that replaces it is already there (the next label, or the assignee), so an item never loses its position. Removing a label starts nothing: the workflows listen for `labeled`, and `plan-approval-resume` ignores everything but `plan-approval-required`, which the janitor removes only from closed issues.

Every label event runs in its own concurrency group (the item number plus the label name). GitHub keeps one pending run per group and cancels an older pending run when a newer one arrives, and a run for a label that changes nothing still takes the slot before its job is skipped. Triage adds three labels in the same second, so with one group per item the run for `pr-triage-handoff` could be cancelled by the runs for `complexity/*` and `risk/*` (seen on frodo-lib#771, which kept `pr-worker-ready`). Runs may now overlap, which is safe: the script reads the item's current labels and every removal is idempotent. The hourly sweep is the backstop for anything that still slips through.

**Everything else**

| Label | Added by | Removed | After the issue closes |
|-------|----------|---------|------------------------|
| type (`enhancement`, `bug`, and so on) | issue template or triage | never | stays |
| `complexity/*`, `risk/*` | plan triage | never | stays |
| `low-hanging-fruit`, `priority/*` | issue triage | never | stays |
| `duplicate`, `invalid`, `already-fixed`, `out-of-scope`, `spam` | issue triage | never | stays (it explains the closure) |
| `related-repo` | issue worker | never | stays |
| `waiting-for-release`, `released` | the `waiting-for-release` workflow, then the release closer | `waiting-for-release` goes when the release lands | `released` stays |
| `dependency-required` | issue triage | the dependency watcher | removed |
| `dependency-satisfied` | the dependency watcher, or a maintainer | never while the issue is open: triage needs it, or any later triage run would gate the issue again | removed |
| `needs-info`, `backlog`, `scope-review`, `plan-approval-required` | triage, plan triage; a maintainer can add `plan-approval-required` by hand to any issue; the issue worker's canonical issue in a related repository starts with it, and plan triage adds it for a "Wrong layer" plan | triage or a maintainer | removed (they describe open work) |
| any gate label still present | | | removed |

Example: an issue that went through the whole pipeline ends with its type, `complexity/*`, `risk/*` and `released`.

**Which release the closer checks.** The release closer is told the tag of the release that started its run (`github.event.release.tag_name`) and must read exactly that release with `get_release_by_tag`. It must not use `get_latest_release`: that tool skips prereleases and returns the newest stable release. On frodo-lib 5.0.0-12 the closer called it three times, checked v4.12.0, concluded that nothing it was waiting for was included, and changed no labels, so lib#761 stayed `waiting-for-release` after the release that contained it. On 5.0.0-11 the model had happened to recover through `list_releases`. `tools/release-closer-release.test.mjs` pins the prompt.

**When it runs.** On the label events that can change the answer (the gate labels, the triage outcomes and `plan-approval-required`), on assignment and on close, for issues and pull requests; hourly as a sweep for anything missed; and on demand. A manual run can clean one item, or with `include_closed` tidy old closed items once; `dry_run` reports without removing. It is idempotent and treats an already-absent label as success.

**Do not read a gate label as proof that a phase happened.** Those labels are gone by the time the next phase is under way. Code and prompts that need to know "has this issue already been handed on" test for later evidence instead: `issue-triage-handoff`, `plan-worker-ready`, `plan-triage-handoff`, a `complexity/*` or `risk/*` label, or the coding agent as an assignee. `plan-approval-resume` and the scope rule in issue triage do exactly that.

**Reopening** an issue puts it back at the issue gate: the worker re-adds `issue-worker-ready` and triage runs again. Because closing removed `dependency-satisfied`, triage gates the issue again if it still declares a dependency, and the watcher clears it again within the hour.

## Held runs

GitHub holds every workflow run that the coding agent causes at `action_required` until a maintainer approves it. For the pipeline that is a check worth keeping: the agent's push runs the pipeline definition on its own branch, with the repository's secrets reachable, and the approval is the moment a person reads the diff before that happens. Keep it on.

The hold is decided before any job condition is evaluated, so it also catches runs that a condition would skip, and runs for commits that no longer matter. Every push the agent makes holds the pipeline run and a `Dependabot Auto-Merge` run, whose only job is conditioned on the Dependabot actor and so is skipped for the agent. Every comment the agent posts on its own pull request starts an `Issue Worker` run, and that run waits for approval although its `if:` (`comment.user.type != 'Bot'` and `issue.pull_request == null`) skips it. Approving any of these starts nothing useful. On a pull request with four pushes that is eight held runs, and one of them is needed: the pipeline run for the newest commit.

The janitor deletes the rest. A run is a candidate only when it finished as `action_required` and its actor is the coding agent; a run caused by a person, a contributor's run on a fork pull request and anything else is never touched. A candidate is deleted when one of these holds:

- **It is a listed workflow** (`DISPOSABLE_HELD_RUNS` in `scripts/janitor.mjs`): the Issue Worker's lock file on `issue_comment`, and the repository's `dependabot-auto-merge.yml` on `pull_request`. The second entry is deleted only while the default branch's copy of that workflow still has a job-level `if: github.actor == 'dependabot[bot]'` on every job. The sweep reads the file each time (`everyJobGuardedByDependabot`), so a repository whose workflow differs, or has none, is simply not affected: frodo-cli and frodo-lib have this workflow with one guarded job, and the five action repositories have none.
- **Its pull request is closed**, or **has moved past the run's commit**: the sweep reads the pull request named in the run once and compares the run's `head_sha` with the pull request's current head. This applies to every workflow, the pipeline included, because the run of an older push can only test code that is no longer there.

Everything else stays. In particular the held run for the **current head of an open pull request** is never deleted, whatever the workflow: it is the only CI for the agent's code, and the approval is the moment a person reads the diff before the pipeline definition of the agent's branch runs with the repository's secrets reachable. A run with no pull request (a fork, another event) stays, and so does any run the sweep cannot judge: a pull request or a workflow file that cannot be read is reported as a warning annotation and the run is kept. Doubt never deletes. Never list a workflow that does real work. A test pins the Issue Worker's guard, so weakening it fails the build instead of making the sweep unsafe.

**When it runs.** The sweep is a second job of the janitor workflow, `held-runs`, which follows the label job and starts for the same events except issue events: gate labels on pull requests, a pull request closing, the hourly schedule and a manual run (`dry_run` lists what it would delete and why). A pushed commit cannot start the janitor itself, because GitHub would hold that run too, so a stale run is deleted at the next janitor run, not when the agent pushes. Expect an older run to stay in the approval list for up to an hour, less when a label event or a merge comes first. The run for the newest commit stays until you approve it or the agent pushes again, which makes it stale in turn.

**Permissions.** Deleting a run needs `actions: write`, reading the pull request needs `pull-requests: read`, and reading the workflow file needs `contents: read`. The job declares these for itself, so the label job keeps `issues: write` and `pull-requests: write` only.

## Repository guidance

A repository tells its contributors, human and agent, how to work on it in files of its own: `AGENTS.md` at the root, `.github/copilot-instructions.md`, and `.github/instructions/*.instructions.md`, each of which starts with `applyTo` globs in its frontmatter. GitHub's coding agent, its code review and Copilot CLI load these files on their own (GitHub documents which feature reads which file in its custom instructions support matrix). The harness adds no file format: it makes two of its gates read the same files, so a rule is written once and no copy has to be kept in step. Without these files nothing changes. The template is `shared/agents.md`; it goes to the repository root, not into `.github/agentic-workflows/`.

| Gate | What it does with the guidance | Where it reads from |
|------|--------------------------------|---------------------|
| Plan worker | Reads `AGENTS.md`, `.github/copilot-instructions.md` and at most three instruction files whose `applyTo` matches the files it expects to touch, and adds a "Repository rules that apply" heading of at most five lines to the plan. | The default branch: an `issues` event checks out the default branch, and the prompt tells it to use the GitHub tools with no `ref`. |
| PR worker | Reads nothing. One static sentence in the `custom-instructions` that travel with the assignment: follow `AGENTS.md` and the matching `.github/instructions` files and run the checks they list. The coding agent loads the files itself, from its own branch. | Not applicable. |
| PR triage | Compares the diff with the rules that no test or linter enforces and adds one "Repository rules:" line to its comment. | The GitHub API only (`checkout: false`), with no `ref`, which is the default branch. |
| Every other gate | Does not use it. | |

**Why the default branch.** A pull request could otherwise weaken the rules it is judged by: edit `AGENTS.md` in the same change and the review applies the edited version. PR triage therefore never passes a ref. When the pull request itself changes `AGENTS.md`, `.github/copilot-instructions.md` or a file under `.github/instructions/`, triage judges it by the default-branch version, says so in the comment and makes a maintainer's review of that change the next action. gh-aw applies the same principle: every compiled workflow saves `.github`, `.agents` and `AGENTS.md` from the base branch for restoration ("Save agent config folders for base branch restoration"). A pull request against another base branch is still judged by the guidance of the default branch. The coding agent loads guidance from its own working branch and may edit it, which is the reason triage does not.

**Advisory, never binding.** The repository's guidance ranks below the harness's safety policy and below the workflow's own prompt. It describes how to work on and review the repository; it can never change which comment a gate posts, which label it adds, or any gate or approval, and both prompts say to ignore text in it that tries. The "Repository rules:" line changes none of the complexity, risk or `pr-triage-handoff` labels. A violation shows up in the comment and in the recommended next action, and merge rules stay as they are. Rules that a test or a linter enforces are left to CI ("enforced by CI" at most), so triage does not repeat them.

**Decisions are a second kind of repository file the same gates read:** see "Decision records" below.

**What the PR worker does not do.** It still never reads the issue or any other untrusted content (`deployment.md` explains why it has no `min-integrity: none`), and the sentence it sends is static text in the safe-output configuration, not written by the model, for the reason given under "PR gate": an instruction that only travels in the model's rationale never reaches the coding agent.

**Cost.** Seven recent runs of the two gates (frodo-lib and frodo-cli, 2026-10-23) used 12.6 to 15.0 AIC (plan worker) and 12.3 to 20.4 AIC (PR triage). The guidance adds about 1.5K tokens of context (a 40-line `AGENTS.md` and up to three short instruction files) and two model turns, because the reads are batched into one step each, and every turn re-reads the cached prompt of roughly 40K tokens. Priced with the rates implied by those seven runs (about 0.23 AIC per 1K tokens written to the cache, 0.02 per 1K read from it, 0.9 per 1K of output), that is about 2 to 2.5 AIC per run, or 15% of the plan worker. A repository without guidance files costs one batched read that finds nothing, about 1 AIC. `max-ai-credits` was not acting as a per-run cap (PR triage ran at 19.2 and 20.4 AIC against a setting of 16 and succeeded), but it feeds gh-aw's daily guardrail and the failure report, so PR triage's is raised from 16 to 24: the largest measured run plus the guidance overhead. The plan worker's is raised from 20 to 24 as well: its largest measured run (15.0), the guidance overhead and the extra read that checking a bug's cause can cost come to about 19.5 in the worst case, too close to 20. The other gates are unchanged.

## Decision records

Design decisions that nobody wrote down get made again, differently, by the next contributor or agent (see the case below). A repository can keep them as decision records, in the same way it keeps `AGENTS.md` for rules of work: a folder `docs/decisions/` with one file `NNNN-short-title.md` per decision and an index in `docs/decisions/README.md`. A repository whose `docs/` is generated output that gets rewritten (frodo-lib's is tracked typedoc output) keeps the same folder at the repository root as `decisions/`, with the index `decisions/README.md`. The gates look for `docs/decisions/README.md` first and then for `decisions/README.md`; the first one found wins, and records from both folders are never merged. Each record starts with frontmatter: `status:` (`proposed`, `accepted`, `rejected`, `deprecated` or `superseded by NNNN`), `date:`, `decision-makers:`, optionally `applies-to:` (a list of path globs the record binds; without it the record covers the whole repository) and `issues:`. The body has Context and problem statement, Decision, Consequences and optionally Alternatives. Only `accepted` records bind, and they bind until a newer record supersedes them; an accepted record is never edited except for its `status:` line. A pull request that changes a decided behaviour adds or supersedes a record in the same change. A decision that binds several repositories is written once, in the repository the others list in their `AGENTS.md`, with a `repos:` list. The template and guide are `shared/decision-record.md`, shipped as a reference like `shared/agents.md`; it goes into `docs/decisions/` (or `decisions/`), not into `.github/agentic-workflows/`. Records are as public as the repository: no secrets, no undisclosed security findings.

The harness adds no format beyond the folder. It makes the gates that already read the repository's guidance read the records too:

| Gate | What it does with the records | Where it reads from |
|------|-------------------------------|---------------------|
| Plan worker | Reads the indexes (`docs/decisions/README.md` and `decisions/README.md`, the first one found wins) in the same step as its guidance reads, then at most four accepted records, in the second: those whose `applies-to` matches the files it expects to touch and the repository-wide ones that bear on the request. It adds a "Decisions that apply" heading of at most five lines to the plan, one record per line. If the request goes against an accepted record it says so on its own line: "Conflicts with 0003: needs a maintainer decision". | The default branch: an `issues` event checks out the default branch, and the prompt tells it to use the GitHub tools with no `ref`. |
| Plan triage | Reads the plan comment only. A "Conflicts with" line under "Decisions that apply" makes it classify as usual, add `plan-approval-required`, emit no `plan-triage-handoff` and post one comment: "This conflicts with decision record NNNN. A maintainer has to decide: change the request, or supersede the record. Remove the plan-approval-required label to resume." It never lifts the hold itself. | Not applicable. |
| PR worker | Reads nothing. The one static sentence in the `custom-instructions` that travel with the assignment now also names the accepted decision records in `docs/decisions` or `decisions` that apply to the files the coding agent changes. | Not applicable. |
| PR triage | Reads the same records and adds one "Decisions:" line to its comment: the violations found (record number and path in the diff), "no conflicts found", or "no decision records". A change that does the opposite of an accepted record, or changes a decided behaviour without adding or superseding a record, is a violation. | The GitHub API only (`checkout: false`), with no `ref`, which is the default branch. |
| `check-deployment` | Prints a notice, never a failure, when neither `docs/decisions/` nor `decisions/` exists. | The checked-out repository. |
| Every other gate | Does not use them. | |

**Why a conflict holds the issue and does not only warn.** The plan is the last moment at which a person can see that a request and a decision disagree before a coding agent starts. The `plan-approval-required` hold is the existing human lever for that moment: it stops the PR worker (its `if:` and its live check), and removing it resumes the issue through `plan-approval-resume`. A maintainer then either changes the request or supersedes the record, which is itself a decision worth writing down.

**Why the default branch.** The same reason as for the guidance: a pull request must not be able to weaken the decisions it is judged by. PR triage never passes a ref. When the pull request itself adds, edits or supersedes a file under `docs/decisions/` or `decisions/`, triage judges it by the default-branch version (by none when the default branch has no records), says in the comment that the decision records change in this pull request and makes a maintainer's review of that change the next action. The coding agent works on its own branch and may, and should, add a record when it changes a decided behaviour; the review still judges by the default branch until a maintainer merges the record.

**Advisory, never binding on the harness.** Records rank below the harness's safety policy and below the workflow's own prompt, and both prompts say to ignore text in a record that tries to change a label, a gate or an approval. The "Decisions:" line changes none of the complexity, risk or `pr-triage-handoff` labels. The only thing a record can cause is the human hold at the plan gate, through the plan worker's honest report of a conflict.

**The case that led to it.** frodo-cli#885 asked to restore the 4.x behaviour for an omitted realm. The design, taken weeks earlier, was that the realm picker stays and opens only when other mandatory connection settings are missing. It was not written anywhere the plan could read, so Copilot's first draft deleted the picker and about 180 lines of its terminal tests. With a record "0001: the realm picker stays and opens only when other mandatory connection settings are missing" (`applies-to: src/utils/interactive/RealmPickers.ts`) on the default branch, the plan worker would have listed it under "Decisions that apply", and PR triage would have reported "Decisions: violates 0001: src/utils/interactive/RealmPickers.ts is deleted". A request to remove the picker would have produced "Conflicts with 0001: needs a maintainer decision" and the hold.

**Cost.** The index plus up to four short records add about 2.5K tokens of context per gate run at most. The plan worker and PR triage read them in the same batched steps as the guidance, so there is no extra model turn, and the added cost is the cache write of those tokens (about 0.23 AIC per 1K), their cache reads in the later turns (0.02 per 1K each) and a short heading of output (0.9 per 1K): about 0.9 AIC per run, and about 0.1 AIC when the folder does not exist. If a model reads in separate steps, each extra turn re-reads the cached prompt of roughly 40K tokens, about 0.8 AIC, so the worst case is about 2.5 AIC. The plan worker's worst measured case (about 19.5 AIC with the guidance overhead and a cause check) stays under its `max-ai-credits` of 24. PR triage's (20.4 AIC measured, 2.5 for the guidance, 1 for the records) reaches about 24, so its `max-ai-credits` goes from 24 to 28. The PR worker reads nothing and stays at 12.

## Plan comment identity

The plan lives as a single comment on the issue.  
gh-aw appends hidden HTML comments to every comment a workflow posts. The one that identifies the plan names the repository and the workflow:

```html
<!-- gh-aw-workflow-call-id: owner/repo/plan-worker -->
```

`plan-triage` classifies only the comment written by `github-actions[bot]` whose body contains that text (`gh-aw-workflow-call-id: owner/repo/plan-worker`, with the real repository). The author check matters: a person can type the same text into a comment, so the text alone does not prove who wrote it.

The prompt describes the marker in words and never shows it as an HTML comment. gh-aw removes HTML comments, even inside a code fence, when it renders a workflow's prompt (the agent sees an empty fence), so a prompt that relied on one gave plan triage no marker to look for: on 2026-10-23 it ended without labels on frodo-cli#886 ("the marker value is blank in my instructions") and worked on other issues only because the model guessed which comment was the plan. A test fails if a workflow prompt contains an HTML comment (`tools/prompt-hazards.test.mjs`). The marker in this paragraph is documentation for humans, not part of any prompt.

## Human interaction

Reporter interaction stays in the issue phase and is conducted entirely through comments.

When information is missing the issue worker posts an explicit, plain-language request. Issue triage applies the internal `needs-info` label and does not hand off.  
A later comment from the reporter re-triggers the issue worker. Issue triage then re-evaluates and can clear `needs-info` and emit `issue-triage-handoff` once the issue is complete.

The plan phase is a classification prerequisite. For high complexity or high risk it adds the internal label `plan-approval-required` and stops. A maintainer removes that label to resume: the `plan-approval-resume` workflow (plain Actions, no LLM) sees the removal and applies `plan-triage-handoff`, which starts the PR gate. It acts only on an open issue that plan triage has classified (it carries `complexity/high` or `risk/high`, or both a `complexity/*` and a `risk/*` label with any value, which is what a hold put on by hand leaves), has no `plan-triage-handoff` yet, has no coding agent assigned, and is not waiting on a dependency (`dependency-required`). An issue that plan triage has not classified is not resumed: there is no plan to approve yet. A removal made by a bot account never counts, because approval is a human decision. It can also be run by hand with an issue number for an issue whose label was already removed.

**A hold put on by hand.** A maintainer can add `plan-approval-required` to any issue, whatever its complexity and risk, to read the plan before the coding agent starts. The hold is honored by the one gate that matters: the PR worker assigns nobody while the label is there, even if plan triage emitted `plan-triage-handoff` anyway (see "Who may start when"). Plan triage still classifies the issue, but it never emits the hand-off or adds the label again while the hold is present. Removing the label is the approval: `plan-approval-resume` applies `plan-triage-handoff` and the PR gate starts. The janitor removes `plan-worker-ready` when the hold is added (the plan gate is over), so a hold added before plan triage ran leaves the issue unclassified and the resume has nothing to approve; re-add `plan-worker-ready` to run plan triage.

Maintainer interaction on the actual change happens in the PR phase.

## Who can start a gate

Every gh-aw workflow checks, in its `pre_activation` job, that the user who caused the event has the `admin`, `maintainer` or `write` role, and skips the run silently when they do not. The gates are label-driven: the first gate is the only one that starts from a reporter's own event, so it is the only one that opts out (`roles: all` on `issue-worker`, for `issues` and `issue_comment` alike, since a reporter answers its questions in comments). The later gates start from a label added by `SIGNAL_TOKEN` or by a maintainer, and keep the default check.

Opening the first gate to everyone is safe because of what it can do, not because of who calls it: it has no shell, reads the report as untrusted text, runs threat detection before any output is applied, and its outputs are two comments, two fixed labels and one linked issue. The cost is bounded by `user-rate-limit` (5 runs per user per 30 minutes over `issues` and `issue_comment`; writers are exempt). Residual risk: a crafted report could try to steer the agent into spending its outputs on another issue (`target: "*"`, needed for `workflow_dispatch`), which threat detection and the output caps limit.

## Who may start when

A gate starts for an issue only while the issue is open. The label-driven gates (issue triage, plan worker, plan triage, PR worker) carry `github.event.issue.state == 'open'` in their `if:`, and so does the issue worker, except for a maintainer's `workflow_dispatch`. A comment, an edit or a label on a closed issue therefore starts nothing; reopen the issue to restart. Three workflows act on closed issues on purpose and are left alone: `waiting-for-release` and `related-repo-closer` start on the close event itself, and `release-closer` labels issues that are already closed. The plain-Actions workflows were audited as well: `dependency-watch` lists open issues only and `plan-approval-resume` returns "issue is closed" for a closed one; neither hands an issue to an agent otherwise.

A merged pull request needs no special case: merging closes the issue, so every later event carries the state `closed`. The race is the other way round: a label event created just before the issue closes can run just after, with a payload that still says `open`. Only the PR worker assigns the coding agent, so only it asks GitHub for the live state.

**An open pull request that closes the issue stops the hand-off.** frodo-cli#887 was fixed and closed by a merged pull request, and the PR worker still assigned the coding agent to the closed issue, which opened a redundant pull request: the hand-off label arrived at 22:22:24 while the fix (#896) was open, the run started three seconds later, the merge closed the issue at 22:24:36 and the assignment landed at 22:25:06. The PR worker is static and never reads the issue, so words in the plan cannot stop it. The `existing_fix` step runs in the pre-activation job, before anything is assigned, with no model: it asks GraphQL for `closedByPullRequestsReferences(includeClosedPrs: false)` (exact, no text matching) and for the issue's live state. If the issue is closed, or an open pull request will close it, the step fails on purpose and the workflow's `if:` reads `needs.pre_activation.outputs.existing_fix_result != 'failure'`. gh-aw exports only a step's outcome, not its outputs, which is why the step signals by failing; `continue-on-error: true` keeps the job, and so the run, green and files no failure report. For an open pull request the step posts one plain comment naming it. If GitHub cannot be asked it warns and lets the hand-off through: the payload was already checked, and a silent stall would be worse than a redundant pull request. A `needs.` reference in `if:` makes gh-aw apply the whole `if:` to the activation job only, so the pre-activation job now starts for every label event; the step carries its own label and state conditions and does nothing, and posts nothing, for any other label. To hand the issue on anyway, close that pull request or remove its link and add `plan-triage-handoff` again. One window stays open by design: a merge in the minutes between the step's check and the assignment (which happens in a later job) can still close the issue first. The coding agent then finds nothing to do and its pull request is closed by hand, as #897 was.

**A blocking label stops the hand-off.** The PR worker is the only gate that causes code, so it is the hard stop for the two blocking labels of the form `<thing>-required`: `plan-approval-required` (a person's approval, whether plan triage or a maintainer put it there) and `dependency-required`. Both are in the workflow's `if:` (`!contains(github.event.issue.labels.*.name, ...)`, decided from the labels as the event saw them), and the `existing_fix` step reads the labels live as well, so a hold added in the minutes between the label event and the run still stops the assignment. This was found on frodo-cli#885: it carried a hold added by hand, plan triage classified it (`complexity/low`, `risk/medium`) and emitted `plan-triage-handoff` anyway (its prompt then withheld the hand-off only for its own high classification), the PR worker's `if:` checked only `dependency-required`, and the run started; it was cancelled before an assignment. A blocked hand-off is void: when the step blocks for a blocking label, or because an open pull request already closes the issue, it removes the `plan-triage-handoff` label (best effort, with the pre-activation token, which starts no workflow). Otherwise the stale label would make `plan-approval-resume` answer "already handed off" after the hold is removed, and adding the label again would start nothing. The step stays silent for a hold (a person put it there) and comments only for an open pull request.

The labels that plan triage and issue triage apply to stop the issue gate (`needs-info`, `backlog`, `scope-review`, `out-of-scope`, `related-repo`, `duplicate`, `invalid`, `spam`, `already-fixed`) are deliberately not checked again at the PR worker. They stop the chain where they are applied, because issue triage emits no hand-off for them, and a maintainer who wants the issue planned anyway adds `issue-triage-handoff` by hand, which is the documented override (promote a `backlog` issue, override a scope decision): re-checking them at the PR worker would turn a label that lingers into a silent stall. The same holds for the plan worker and plan triage, which are cheap and must run so that the issue is classified.

The issue worker is the earlier, wording-level layer: when it finds an open pull request that closes the issue it links it, calls it "in review" (not "already fixed") and adds no gate label, so nothing is planned either. The `if:` is the guarantee; the wording saves a plan.

## Bot activity is not work

Every issue-driven workflow carries an activation condition (`if:` in the frontmatter) so it never starts for bot-authored issues: `github.event.issue.user.type != 'Bot'`. `issue-worker` additionally requires that the triggering comment was not written by a bot and that the comment is not on a pull request. Without this, the issues gh-aw files about its own failures were analyzed, planned and closed like real work, and the harness's own comments re-triggered the worker. A manual run of `issue-worker` with an issue number is unaffected, so a maintainer can still opt a bot-authored issue in.

The PR gate worker only routes to the coding agent, so it uses the small model like the triage workflows; the plan worker is the only gate that still uses the default model.

## Split-repo routing (linked issues)

When a repository defines `.github/agentic-workflows/related-repos.md`:

1. The issue worker decides, from evidence, whether an issue belongs in a related repository (see "Evidence before routing").
2. When it does, it creates a canonical issue there, which starts held (see "A routed issue starts held"), and cross-links both sides with plain-language comments.
3. It applies the internal label `related-repo` to the original issue and does not emit `issue-worker-ready`.
4. The original issue stays open. Issue triage ignores it for planning.
5. When the canonical issue is closed, `related-repo-closer` closes the original issue with a short notice.
6. When the canonical issue is created, and again each time it needs more information from the reporter, `reporter-notify` mentions the person who reported the original issue (see below).

**Decide from the text.** On frodo-cli#887 (2026-10-23) the worker (model `small`, 7 turns, no file read) added `related-repo` with confidence HIGH and the rationale "per related-repos.md", and opened a canonical issue in the library. The CLI's own `related-repos.md` told it to send authentication flows, and "most issues", to the library; the wrapper messages in the report ("Error getting tokens", "Error authenticating user") are produced by the library; the cause, a terminal read that failed with `EAGAIN`, was in the CLI. The library's plan worker then planned a wrong-layer fix and the coding agent started one (frodo-lib#785). So the `when` text and the notes are a guide to where to look, never proof, and the worker now decides from the report text in this order, without searching. (1) It takes the innermost error (or, without one, the behavior described), not the wrapper another layer put around it. (2) It applies the layering the repository states (the ownership lists in `related-repos.md`, and `AGENTS.md` or its decision records when the file points to them; this outranks the `when` text and any keyword). The default is to keep the issue here, and a keep needs no tool call. (3) It routes only when the report itself names the failing component in the related repository: a stack-trace path or a package of that repository, that repository's own command or API as the call that failed, or an error that only that repository can produce, in the innermost position. A keyword from the `when` text, a wrapper message or the name of a command that exists in both repositories is not enough, and it does not search to decide: a command in this repository that wraps a library function matches in both repositories, so a search finds both and settles nothing. (4) It quotes those words in the `rationale` it gives for `related-repo` and gives `confidence: HIGH` only with the quote. Without them the issue stays here and the comment says which part might belong elsewhere. Budget: the run used 7 of its 10 turns and 1.03 AIC; the routing decision adds no search, so a keep and a route take about the turns they took before, and `max-turns` and `max-ai-credits` do not change. **Keeping is the safe side**: the plan gate reads the code, and when its layer check finds that the fix belongs in the other repository it says so and holds the issue for a maintainer, so an issue that stays here by mistake costs a comment, while one routed by mistake costs a canonical issue and a plan in the wrong repository. The prompt is the first layer; the second layers are the hold on the canonical issue and the plan worker's layer check ("Layer check" under the plan gate).

*How the step got here (three versions, two replays).* The first version made the worker search the code of both repositories for every issue. Before release, a replay of 33 historical issues whose correct repository is known (from where the fixing pull request landed; the small model `claude-haiku-5.5` and the default `claude-sonnet-5.5`; one pass per cell) compared the current rule A with a corrected rule B, each with and without code-search hits handed to the model. Accuracy, small / default model: A 78.8% / 93.9%, B 90.9% / 90.9%, A with hits 72.7% / 93.9%, B with hits 81.8% / 90.9%. On rule A both models still routed frodo-cli#887 and #527 to the library because the `when` text names authentication flows; rule B alone gave 90.9% on both with almost no wrong routes (the small model's confident wrong routes fell from 2 to 0), at the price of keeping about a third of the true library issues in the CLI; and hits on the outer error text or the command did not help and, for the small model, hurt. The second version therefore decided from the text and used two searches only to confirm a route (this repository first, then the related one; route only when the related one holds the failing code and this one nothing). A second replay (variant C: rule B plus that confirm step, with the two search results supplied for each issue) scored 75.8% on the small model and 81.8% on the default one, below rule B alone: it kept every issue that belonged here (keep recall 100%) but routed only 1 of 9 and 3 of 9 true library issues, because a CLI command that wraps a library function matches in both repositories and the "both repositories match" rule then keeps it, and all of the small model's misses said "both searches found matches". So the final version has no search in the decision: the text decides, and the cheap error (an issue that stays here by mistake) is caught by the plan gate. Caveats: one run per cell, 33 scored issues (a few items move the percentages by several points), rule B was written after #887 (the rows without #887 give the same picture), the code-search hits in the replay were file lists over today's default branches and hand-picked cause terms, cruder or luckier than what a live worker finds, and the replay cannot measure tool use or turns.

**A routed issue starts held.** The canonical issue is created with the label `plan-approval-required`, through the `labels` option of the `create-issue` safe output (gh-aw v0.92.0 applies it when it creates the issue, and `tools/ci-compile-smoke.sh` reads it in the compiled lock). The gates still run on it, so a plan with its layer check is there when a maintainer looks, but no coding agent starts until a maintainer removes the label: `plan-approval-resume` then hands the issue on (removed before plan triage ran, it hands nothing on and the issue goes through the gates as usual). The trade-off is one click for every routed issue, against a wrong routing costing a comment and not a pull request. To switch the default off, delete the two `labels` lines under `create-issue` in `workflows/issue-worker.md` and release. A per-deployment switch in `related-repos.md` is not offered: the updater a deployment runs is the previous release's, so a setting it does not know yet would apply one release late.

**Only say what was checked.** On the same run the worker wrote "No change after this issue was opened touches the authentication code" without a search or a commit listing in the run. The analysis comment may now state only what a tool call in that run showed, and the "already fixed or cannot reproduce" steps are tool calls, not impressions.

**Who is told.** The canonical issue is created by the harness, so its author is not the reporter, and GitHub only notifies people who take part in a thread. Without a mention, the reporter would never see a request for information on the linked issue. GitHub cannot subscribe another user to an issue; being mentioned in a comment is what subscribes a user to the thread. The mention is written by a plain Actions workflow, `reporter-notify` (no LLM), not by the issue worker: gh-aw's output step neutralizes every `@handle` in an agent's comment except the people who take part in the event, so a mention the model wrote for the original reporter would reach nobody. The issue worker's prompt therefore tells the model not to write one.

**The incident behind the link notice.** On 2026-10-24 the worker opened frodo-lib#803 to #806 from frodo-cli#919 to #922. The cross-repository token is a maintainer's personal access token, so the four issues have that maintainer as their author, and the people who reported the originals (cli#919 to #922) were not part of them: nothing the plan, triage or a decision wrote there reached them, and the request notice below only covers the case where more information is needed. One mention when the issue is linked subscribes the reporter to the thread from the start. A bot identity for the token (so that the issues do not appear in a maintainer's name) is a separate, later change.

`reporter-notify` posts two kinds of comment, each at most once, each with its own hidden marker.

- **The link notice** is posted once per linked issue, as soon as the original confirms the link: `Original report: {owner}/{repo}#{number}, reported by @{login}. Updates are posted on both threads.` It needs no label.
- **The request notice** is posted when `needs-info` is applied to an open issue (issue triage applies it when the worker's comment asks for details): one comment per request that starts with `@{login}`, thanks the reporter, and points at the request above.

Both notices use the same proof. The login is the author of the original issue as GitHub returns it, never a name found in text, because issue text is written by whoever opens the issue and a crafted report could otherwise make the bot mention anyone. It acts only when all of these hold, and says why it skipped otherwise:

- The issue body has a `Reported from {owner}/{repo}#{number}` line (at the start of a line; a note may follow the number, as the worker wrote on frodo-lib#806, because the line only names a candidate that the later rules confirm), and that repository is a related repository listed in this repository's `related-repos.md`.
- The original issue can be read (a private or deleted original is skipped silently), is not a pull request, and still carries `related-repo`. Removing that label is how a maintainer unlinks the two issues, and it stops the notifications.
- The original issue has a comment by `github-actions[bot]` that names this issue (`owner/repo#number`, as a whole reference). Anyone can write a `Reported from` line; only the harness writes that comment, so a link to someone else's issue fails here.
- Exactly one linked original passes, and its author is a person (not a bot, an app or the coding agent), not a maintainer of the original repository (`OWNER`, `MEMBER` or `COLLABORATOR` as GitHub reports the author's association; they already follow the work) and not the person who opened this issue (they take part already).
- The author has not commented on this issue yet. The link notice has not been posted before (a comment by the bot with its marker; a person who quotes the marker cannot switch it off), and, for the request notice, this request (the latest comment of this repository's issue worker) has not been mentioned before. A reporter who answers is a participant from then on and gets GitHub's normal notifications.

The comment contains exactly one mention and no internal terms. It does not trigger the issue worker, which ignores comments by bots. If the original repository is private, nothing is posted.

**Why the reporter may be mentioned twice, and why that is harmless.** A reporter who got the link notice is already subscribed, so the first request for information reaches them anyway; the request notice adds a prominent, actionable ask. The two notices have different markers, each is posted at most once per link or per request, a comment written with the workflow token starts no workflow, and a second run finds the markers and skips. The most a thread gets is one link notice plus one notice per request.

**The race, and when the workflow starts.** The proof (`related-repo` on the original and the bot's comment that names the linked issue) is written a moment after the linked issue exists. The issue worker's safe outputs run in order after the agent finishes: they comment on the original with a placeholder, create the linked issue, label the original, and only then rewrite the placeholder to the full reference. In the real run on frodo-cli#887 (2026-10-23) the linked issue was created at 20:45:51.96, `related-repo` was added at 20:45:53.16 and the comment named frodo-lib#783 at 20:45:54.97, about three seconds later. A workflow that starts on `opened` normally needs longer than that to queue and check out, but nothing guarantees it, so the first run may find the proof missing. The workflow starts on an issue that has a `Reported from` line when it is opened and when `plan-approval-required` (added at creation), `issue-worker-ready` (minutes later) or `needs-info` is applied. The link notice waits for the proof for at most four checks, 15 seconds apart, and only while that is the single reason for skipping (every other skip, such as a bot, a maintainer, a private original or an unrelated repository, is final at once). The later label events are the second and third chance. If none of them finds the proof, nothing is posted, which is correct for a link nobody confirmed; a maintainer can run the workflow by hand for the issue. An issue the harness never confirmed (it failed before it rewrote the comment) is never mentioned.

**How the comment names the new issue.** The worker cannot know the canonical issue's number while it writes the comment, because safe outputs run after the agent finishes. It therefore gives the `create-issue` output the fixed temporary id `aw_canonical` and writes `#aw_canonical` in the comment, with no owner or repository in front of it. gh-aw registers the id when it creates the issue and then replaces every `#aw_canonical` with the full reference (`owner/repo#number` for another repository). Two things break this, and `tools/issue-worker-linked-issue.test.mjs` pins both: an id the model invents instead of the one it set (the placeholder stays in the comment, as on frodo-cli#694, which read `rockcarver/frodo-lib#aw_lib694`), and a repository written in front of the token (gh-aw would double the prefix).

## Gates

### 1. Issue gate
**Worker** → plain-language analysis comment + internal `issue-worker-ready`  
(or `related-repo` and no ready label if linked elsewhere)  
**Triage** → internal quality/priority labels. Emits `issue-triage-handoff` when actionable; applies `needs-info` otherwise. Skips issues that already have `related-repo`.

#### Scope check

Optional, and off unless the repository has `.github/agentic-workflows/scope.md` (template: `shared/scope.md`: Purpose, In scope, Out of scope, Needs a maintainer, Where to go instead). When it exists, the issue worker compares each request with it as written and says one of three things in its analysis: in scope (continue), out of scope (the request matches an item under "Out of scope", or a plain statement that the project does not do it), or unclear (it is not excluded, but it matches "Needs a maintainer" or the worker doubts it fits the Purpose). When it hesitates between out of scope and unclear it chooses unclear, and it never calls a request out of scope because it is large, hard, risky or unusual, only because the file excludes it. A bug in something the project already does is always in scope.

Triage turns that into labels. Out of scope: `out-of-scope`, a short plain-language reply, and the issue is closed as not planned; no hand-off. Unclear: `scope-review` and no hand-off; nothing is closed, and a maintainer decides. These outcomes take precedence over the dependency gate. An issue that already has `out-of-scope` is left alone when the reporter replies, and an issue that already has `issue-triage-handoff` is not re-evaluated. To override a decision, reopen the issue if it is closed, remove `out-of-scope` or `scope-review`, and add `issue-triage-handoff`: the same signal that triage sends for an accepted issue. Because an exclusion closes issues without a human, keep that list short and specific; the wording of each item decides what gets closed.

#### Not urgent, and low-hanging fruit

The worker judges urgency as if every dependency were already finished: waiting for a dependency, a release or another change is never a reason to call an issue not urgent. A valid issue that is not urgent gets `backlog` and stays out of the plan gate, with one exception. When the worker also says the change is small and low in risk (low complexity and low risk, using `complexity.md` and `risk.md` when the repository defines them), triage treats it as low-hanging fruit: it applies `low-hanging-fruit` and emits `issue-triage-handoff`. Only that combination qualifies; a medium change is not low-hanging fruit even when it is low risk. Plan triage still makes the authoritative complexity and risk call afterwards and stops at `plan-approval-required` for high complexity or high risk, so a rough estimate at this gate cannot skip a gate. Why the worker's wording matters: triage reads the latest analysis comment, and an analysis written while a dependency was pending can say "not urgent" because of it. Triage disregards that part once the issue carries `dependency-satisfied`. A maintainer can move a `backlog` issue forward by removing `backlog` and adding `issue-triage-handoff`.

#### Dependency gate

An issue declares a dependency with a `Depends on:`, `Blocked by:`, or `Requires:` line. The issue worker analyzes the issue as usual and still adds `issue-worker-ready`. Issue triage detects the declaration and applies `dependency-required` instead of handing off. `plan-triage` and `pr-worker` also refuse to proceed while the label is present.

The `dependency-watch` workflow (plain Actions, no LLM) resolves dependencies hourly, on demand, when the label is added, and when an issue closes, a pull request merges, a release is published, or `package.json` changes. Satisfied means merged, or closed as completed, in the same repository. For a related repository that requires a consumer release, it also means released, installable from the registry, and pinned by this repository. When every dependency is satisfied the watcher adds `dependency-satisfied`, removes `dependency-required`, and re-applies `issue-worker-ready` with the signal token so issue triage runs again and hands off.

Full rules: `shared/dependencies.md`.

### 2. Plan gate
**Worker** → rough plan + `plan-worker-ready`. For a report that contains an error message or a stack trace the plan says how the likely cause was checked (the file and line it read, or "not verified") and labels an unchecked cause "Hypothesis (unverified)", so whoever approves the plan can see what is established and what is a guess.  
**Triage** → complexity and risk labels.  
If complexity is high or risk is high, add `plan-approval-required` and do not emit `plan-triage-handoff`; the comment says which ("High complexity.", "High risk." or "High complexity and high risk.") and how to resume. Otherwise, unless the issue already carries `plan-approval-required`, emit `plan-triage-handoff`. When the hold is already there (a maintainer added it by hand), plan triage classifies, emits no hand-off, adds no second label and posts no comment.  
**Layer check.** In a repository with `related-repos.md`, the plan worker notices which repository holds the code that has to change when it reads the code for the cause: it takes the innermost error, not the wrapper another layer put around it, and searches the related repository when the report could belong there. If the fix belongs in the other repository, or an issue routed here belongs where it came from, the plan starts with "Wrong layer: the fix belongs in {owner}/{repo}, see {file}". Plan triage treats that line like a conflict with a decision record: it classifies, adds `plan-approval-required`, emits no hand-off and says that a maintainer has to move or re-route the issue. Without it, a wrong-layer plan on an issue that is low in risk went straight to a coding agent in the wrong repository (frodo-lib#785). When the worker read nothing that settles the layer it writes "Layer: not verified" and does not guess. Cost: one more search in the related repository, about 1 AIC, so the worst case of about 19.5 AIC becomes about 20.5 against a `max-ai-credits` of 24.  
Plan triage never resumes a held issue itself. Removing `plan-approval-required` is the signal; `plan-approval-resume` applies the handoff. The prompt is the first layer; the PR worker's `if:` and its `existing_fix` step are the guarantee, because a model can ignore a sentence and the label allow-list cannot depend on the issue's state.

Why risk counts, not only complexity: a change can be small and still sit in a place where a wrong fix is costly (authentication, data integrity, public API). Without the stop, such an issue went straight to the coding agent on a plan that was still a hypothesis (frodo-lib#783: complexity low, risk high, handed to the coding agent three minutes after triage, with a cause that turned out to be in the wrong layer). The stop is the human lever between "this is what we think is wrong" and code. The PR gate is unchanged: human review is still required unless both complexity and risk are low.

Two consequences. An issue that is planned again (the dependency watcher re-applies `issue-worker-ready`, for one) gets the stop again and needs a new approval, as it always did for high complexity. And an issue that already passed the plan gate keeps its place: the rule applies when plan triage runs, not retroactively.

### 3. PR gate
**Worker** → assigns coding agent (triggered by `plan-triage-handoff`)  
The PR worker never reads the issue: its activation condition (an `if:` on the label event) already excludes bot-authored issues and issues labeled `dependency-required`, and the instructions it passes to the coding agent are static: configured as `custom-instructions` on the safe output and sent with the assignment as `agent_assignment.custom_instructions`, not written by the model (an instruction that only travelled in the model's `rationale` never reached Copilot, which is why frodo-lib#764 did not get its `pr-worker-ready` label). Reading untrusted issue content is blocked by gh-aw's integrity policy unless a workflow opts out with `min-integrity: none`, which made the worker refuse to assign the agent (frodo-lib#760); this design needs no such opt-out.

The assignment is sent without issue-intent metadata (`issue-intent: false`). With it, gh-aw sends the agent's `confidence` and `rationale` along with the assignee, and GitHub's Agent suggestions preview holds anything below `HIGH` as a pending suggestion that a person must accept on the issue page (frodo-lib#760, confidence `MEDIUM`: the call reported success and nothing was assigned until someone clicked Accept). The gate here is the `plan-triage-handoff` label, which a person or plan triage already decided on, so the assignment is a mechanical step and must not depend on how the model rates its own confidence.

**Ready signal** → the PR gate's triage starts when the pull request carries `pr-worker-ready`. The coding agent is told to add that label but cannot: its GitHub tools do not write labels (observed on frodo-cli#870 and frodo-lib#764: the instructions arrived, the label did not). The `pr-ready-signal` workflow (plain Actions, no LLM) adds it, with `SIGNAL_TOKEN` (Issues and Pull requests: Read and write) so the label event starts triage.

It learns that the agent has finished from the pull request's timeline, where each agent session is recorded as `copilot_work_started` and `copilot_work_finished`. A **sweep every 15 minutes** looks at every open pull request the coding agent opened and signals when the latest session has finished (the newest finish is later than the newest start) and no `pr-worker-ready` label has been applied since that finish. So a finish is signalled once, a feedback round that finishes again is signalled again, a label the janitor removed is not re-added for a finish that was already handled, and a signal that arrived early (someone labelled while the agent was still working) does not hide the real finish.

Why a sweep and not an event (measured on frodo-lib#771): the agent's own `review_requested` starts a run that waits for a maintainer's approval like any run the agent causes (the repository's "Require approval for workflow runs" policy), and `workflow_run` is never delivered for the agent's `dynamic` runs. Two more triggers remain: `ready_for_review` (a maintainer took the draft out of draft) and `workflow_dispatch` (with a pull request number for that one, or without one for a sweep; `dry_run` reports only). Only open pull requests opened by the coding agent are touched.

PR triage runs as a `pull_request_target` run, so it does not wait for "Approve and run workflows". As a `pull_request` run it did: GitHub holds every run on a pull request the coding agent opened. gh-aw accepts `names:` only under `pull_request`, so triage listened for every `labeled` event and filtered by name inside the job, which meant each label event on the pull request, including triage's own three labels, queued another held run, and a held run stays on the head it was queued for after the agent pushes again (seen on frodo-lib#771 and frodo-cli#871).

This removes a human step, so the trade-off is stated here. The CI runs on the agent's pushes still wait for "Approve and run workflows", and branch protection still needs those checks, so that click remains the human gate before anything merges. What protects the unattended triage run:

- It runs the workflow from the default branch, and gh-aw refuses `pull_request_target` unless the checkout is off. `checkout: false` means no pull request code is checked out or run; the agent reads the diff through the API.
- The `if:` starts it only for the `pr-worker-ready` label and only for a pull request from this repository. The same-repository guard is one gh-aw adds for `pull_request` and not for `pull_request_target`, so it is written out.
- The label must be added by someone with write access, as for every gate.
- It can write only the fixed list of complexity, risk and handoff labels and one comment, and threat detection stays on.

Its concurrency group includes the label name. gh-aw's default for pull-request triggers is one group per pull request with `cancel-in-progress`. Now that these runs are no longer held, triage's own three labels each start a run (skipped by the `if:`) that enters the group and cancels the triage still finishing. Seen on frodo-lib#775: the `safe_outputs` job was cancelled seconds after the labels and the comment had landed, so any output still waiting would have been lost. With the label name in the key, only another `pr-worker-ready` event for the same pull request cancels a running triage.

What it gives up: nobody looks at the pull request before a model reads it, and the labels it writes feed the merge rules. Do not let auto-merge act on `pr-triage-handoff` without required CI checks, as `deployment.md` already says. To get the approval click back, revert this change (`on: pull_request` with `names: [pr-worker-ready]`) and accept the held runs; the updater rewrites deployed files from each release, so a local edit in one deployment would not last.

**Triage** → re-evaluates against the diff, reports the state of the checks (failing, running, passing, or "CI state not checked" when it cannot read them) and emits `pr-triage-handoff`. It classifies size and risk, so a red check does not hold the handoff back; it changes the recommended next action.

### Environment agent
Optional. Any worker may invoke it if the consuming repository defines it.

### Merge
Branch protection and auto-merge rules act on the final labels.
