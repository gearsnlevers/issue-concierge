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
| `needs-info`, `backlog`, `scope-review`, `plan-approval-required` | triage, plan triage | triage or a maintainer | removed (they describe open work) |
| any gate label still present | | | removed |

Example: an issue that went through the whole pipeline ends with its type, `complexity/*`, `risk/*` and `released`.

**Which release the closer checks.** The release closer is told the tag of the release that started its run (`github.event.release.tag_name`) and must read exactly that release with `get_release_by_tag`. It must not use `get_latest_release`: that tool skips prereleases and returns the newest stable release. On frodo-lib 5.0.0-12 the closer called it three times, checked v4.12.0, concluded that nothing it was waiting for was included, and changed no labels, so lib#761 stayed `waiting-for-release` after the release that contained it. On 5.0.0-11 the model had happened to recover through `list_releases`. `tools/release-closer-release.test.mjs` pins the prompt.

**When it runs.** On the label events that can change the answer (the gate labels, the triage outcomes and `plan-approval-required`), on assignment and on close, for issues and pull requests; hourly as a sweep for anything missed; and on demand. A manual run can clean one item, or with `include_closed` tidy old closed items once; `dry_run` reports without removing. It is idempotent and treats an already-absent label as success.

**Do not read a gate label as proof that a phase happened.** Those labels are gone by the time the next phase is under way. Code and prompts that need to know "has this issue already been handed on" test for later evidence instead: `issue-triage-handoff`, `plan-worker-ready`, `plan-triage-handoff`, a `complexity/*` or `risk/*` label, or the coding agent as an assignee. `plan-approval-resume` and the scope rule in issue triage do exactly that.

**Reopening** an issue puts it back at the issue gate: the worker re-adds `issue-worker-ready` and triage runs again. Because closing removed `dependency-satisfied`, triage gates the issue again if it still declares a dependency, and the watcher clears it again within the hour.

## Plan comment identity

The plan lives as a single comment on the issue.  
gh-aw injects a non-spoofable marker:

```html
<!-- gh-aw-workflow-id: plan-worker -->
```

`plan-triage` classifies only the comment that contains that marker.

## Human interaction

Reporter interaction stays in the issue phase and is conducted entirely through comments.

When information is missing the issue worker posts an explicit, plain-language request. Issue triage applies the internal `needs-info` label and does not hand off.  
A later comment from the reporter re-triggers the issue worker. Issue triage then re-evaluates and can clear `needs-info` and emit `issue-triage-handoff` once the issue is complete.

The plan phase is a classification prerequisite. For high complexity it adds the internal label `plan-approval-required` and stops. A maintainer removes that label to resume: the `plan-approval-resume` workflow (plain Actions, no LLM) sees the removal and applies `plan-triage-handoff`, which starts the PR gate. It acts only on an open issue that carries `complexity/high`, has no `plan-triage-handoff` yet, and is not waiting on a dependency (`dependency-required`). It can also be run by hand with an issue number for an issue whose label was already removed.

Maintainer interaction on the actual change happens in the PR phase.

## Bot activity is not work

Every issue-driven workflow carries an activation condition (`if:` in the frontmatter) so it never starts for bot-authored issues: `github.event.issue.user.type != 'Bot'`. `issue-worker` additionally requires that the triggering comment was not written by a bot and that the comment is not on a pull request. Without this, the issues gh-aw files about its own failures were analyzed, planned and closed like real work, and the harness's own comments re-triggered the worker. A manual run of `issue-worker` with an issue number is unaffected, so a maintainer can still opt a bot-authored issue in.

The PR gate worker only routes to the coding agent, so it uses the small model like the triage workflows; the plan worker is the only gate that still uses the default model.

## Split-repo routing (linked issues)

When a repository defines `.github/agentic-workflows/related-repos.md`:

1. The issue worker detects that an issue belongs in a related repository.
2. It creates a canonical issue there and cross-links both sides with plain-language comments.
3. It applies the internal label `related-repo` to the original issue and does not emit `issue-worker-ready`.
4. The original issue stays open. Issue triage ignores it for planning.
5. When the canonical issue is closed, `related-repo-closer` closes the original issue with a short notice.

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

The worker judges urgency as if every dependency were already finished: waiting for a dependency, a release or another change is never a reason to call an issue not urgent. A valid issue that is not urgent gets `backlog` and stays out of the plan gate, with one exception. When the worker also says the change is small and low in risk (low complexity and low risk, using `complexity.md` and `risk.md` when the repository defines them), triage treats it as low-hanging fruit: it applies `low-hanging-fruit` and emits `issue-triage-handoff`. Only that combination qualifies; a medium change is not low-hanging fruit even when it is low risk. Plan triage still makes the authoritative complexity and risk call afterwards and stops at `plan-approval-required` for high complexity, so a rough estimate at this gate cannot skip a gate. Why the worker's wording matters: triage reads the latest analysis comment, and an analysis written while a dependency was pending can say "not urgent" because of it. Triage disregards that part once the issue carries `dependency-satisfied`. A maintainer can move a `backlog` issue forward by removing `backlog` and adding `issue-triage-handoff`.

#### Dependency gate

An issue declares a dependency with a `Depends on:`, `Blocked by:`, or `Requires:` line. The issue worker analyzes the issue as usual and still adds `issue-worker-ready`. Issue triage detects the declaration and applies `dependency-required` instead of handing off. `plan-triage` and `pr-worker` also refuse to proceed while the label is present.

The `dependency-watch` workflow (plain Actions, no LLM) resolves dependencies hourly, on demand, when the label is added, and when an issue closes, a pull request merges, a release is published, or `package.json` changes. Satisfied means merged, or closed as completed, in the same repository. For a related repository that requires a consumer release, it also means released, installable from the registry, and pinned by this repository. When every dependency is satisfied the watcher adds `dependency-satisfied`, removes `dependency-required`, and re-applies `issue-worker-ready` with the signal token so issue triage runs again and hands off.

Full rules: `shared/dependencies.md`.

### 2. Plan gate
**Worker** → rough plan + `plan-worker-ready`  
**Triage** → complexity and risk labels.  
If complexity is high, add `plan-approval-required` and do not emit `plan-triage-handoff`. Otherwise emit `plan-triage-handoff`.  
Plan triage never resumes a high-complexity issue itself. Removing `plan-approval-required` is the signal; `plan-approval-resume` applies the handoff.

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
