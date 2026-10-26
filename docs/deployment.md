# Deploying Repo Concierge

Step-by-step instructions for installing Repo Concierge in a consuming repository.

## Prerequisites

- GitHub CLI (`gh`) authenticated with permission to push and manage the target repository.
- `gh-aw` extension:
  ```bash
  gh extension install github/gh-aw
  ```
- Issues enabled on the target repository (Settings → General → Features → Issues).
- For organization repositories, the Grok (by xAI) GitHub App (or equivalent token) must be installed on the organization.
- A Copilot engine credential (see below).

## 1. Install the workflow files

From a clone of the target repository:

```bash
gh aw add vscheuber/repo-concierge/issue-worker@main \
         vscheuber/repo-concierge/issue-triage@main \
         vscheuber/repo-concierge/plan-worker@main \
         vscheuber/repo-concierge/plan-triage@main \
         vscheuber/repo-concierge/pr-worker@main \
         vscheuber/repo-concierge/pr-triage@main
```

Alternatively, copy the seven `.md` files from `workflows/` in this repository into `.github/workflows/` of the target.

Commit the files on a branch and open a pull request.

## 2. Optional shared configuration

The files under `shared/` in the harness repository are templates. They are **not** required for a working deployment. Copy only the ones you need into `.github/agentic-workflows/` of the consuming repository.

| File | Required? | Purpose |
|------|-----------|---------|
| `complexity.md` | No | Override the default complexity axis definitions used by plan triage |
| `risk.md` | No | Override the default risk axis definitions used by plan triage |
| `issue-completeness.md` | No | Override completeness criteria (issue template is preferred by default) |
| `scope.md` | No | The project's purpose and explicit exclusions; turns on the scope check (see [multi-phase-design.md](multi-phase-design.md#scope-check)) |
| `related-repos.md` | No | Enable linked-issue routing for split-repo projects |
| `agents.md` | No | Template for `AGENTS.md` at the **repository root**, not for this folder: how coding agents and the plan and PR gates should work on the project (see [multi-phase-design.md](multi-phase-design.md#repository-guidance)) |
| `decision-record.md` | No | Template and guide for decision records in `docs/decisions/` (or `decisions/`) of the **consuming repository**, not for this folder: the design decisions the plan and PR gates read, so that a decision is not made again by the next contributor or agent (see [multi-phase-design.md](multi-phase-design.md#decision-records)) |
| `env-agent-contract.md` | No | Contract for an optional injectable environment agent |
| `safety-policy.md` | No | Reference only; not read by workflows |

If `complexity.md` or `risk.md` are absent, plan triage uses built-in defaults.  
If `related-repos.md` is absent, no linked-issue routing occurs.

### Repository guidance (`AGENTS.md`)

Optional, and read from the repository's own files rather than from `.github/agentic-workflows/`: `AGENTS.md` at the root (start from `shared/agents.md`), `.github/copilot-instructions.md`, and `.github/instructions/*.instructions.md` with `applyTo` globs. The Copilot coding agent loads them itself, the plan worker lists the rules that apply in its plan, and PR triage adds a "Repository rules:" line to its comment. Both gates read the default branch only, so a pull request cannot loosen the rules it is judged by. Keep `AGENTS.md` at 60 lines or fewer: it is loaded into every agent run. `check-deployment` prints a notice, and never fails, when neither `AGENTS.md` nor `.github/copilot-instructions.md` exists.

### Decision records (`docs/decisions/` or `decisions/`)

Optional, and read from the repository's own folder rather than from `.github/agentic-workflows/`: one file `NNNN-short-title.md` per decision in `docs/decisions/` (start from `shared/decision-record.md`) and an index `docs/decisions/README.md`. A repository whose `docs/` is generated output that gets rewritten (typedoc, for example) keeps them in `decisions/` at the repository root instead, with the index `decisions/README.md`. The gates look for `docs/decisions/README.md` first and then for `decisions/README.md`; the first one found wins, and records from both folders are never merged. Each record has frontmatter with `status:`, `date:`, `decision-makers:` and optionally `applies-to:` (path globs) and `issues:`; only `accepted` records bind, until a newer record supersedes them. The plan worker lists the ones that apply to a request under "Decisions that apply" (and a request that conflicts with one under "Conflicts with NNNN", which makes plan triage add the `plan-approval-required` hold), the PR worker tells the coding agent to follow them, and PR triage adds a "Decisions:" line to its comment. Both gates read the default branch only. Records are as public as the repository: no secrets. `check-deployment` prints a notice, and never fails, when neither `docs/decisions/` nor `decisions/` exists.

### related-repos.md schema

```yaml
this: owner/this-repo
related:
  - role: library          # free-form
    repo: owner/other-repo
    secret: OTHER_REPO_ISSUES_TOKEN   # Actions secret that can create issues there
    when: |
      When an issue reported here should be tracked in the other repository.
notes: |
  Optional free text.
```

`secret` is optional. Set it when the worker should open the canonical issue in that repository. Each related repository can name a different secret.

When the worker links an issue it creates a canonical issue in the related repository, cross-links both sides, applies the internal label `related-repo` to the original, and opens the canonical issue with `original-in-related-repo`, so each issue shows in a list that it has a counterpart in the other repository. The original stays open until the canonical issue is closed, at which point `related-repo-closer` updates it. The closer is a plain workflow with a script and no model ([multi-phase-design.md](multi-phase-design.md#split-repo-routing-linked-issues), "The closer is code, not a model"). It starts only for a closed issue that carries `original-in-related-repo`, so a canonical issue opened by hand needs that label too. It acts only when the canonical issue was closed as completed: it closes the original with a short notice, or, when the original's `related-repos.md` sets `release.requires_consumer_release`, labels it `waiting-for-release` and comments. Installing it: copy `workflows/related-repo-closer.yml` to `.github/workflows/` and `scripts/related-repo-closer.mjs` to `.github/scripts/` (with `dependency-watch.mjs`, `reporter-notify.mjs` and `janitor.mjs`, which it imports).

The canonical issue starts with the labels `plan-approval-required` and `original-in-related-repo`, so a maintainer reads its plan and removes the hold before a coding agent starts. Install the Concierge in the related repository too (the updater creates the labels), or create the labels there, so the hold exists and is honored and the closer can start. Why, and how to switch it off: [multi-phase-design.md](multi-phase-design.md#split-repo-routing-linked-issues).



The related-repo closer runs in the repository that owns the fix and writes to the original issue, in the other repository. `SIGNAL_TOKEN` cannot do that. It reads with the workflow's own token and writes with the secret named in this repository's `related-repos.md` for the other repository, which its step receives as the environment variables `CROSS_REPO` (the other repository) and `CROSS_REPO_TOKEN`:

```yaml
env:
  GH_TOKEN: ${{ github.token }}
  CROSS_REPO: owner/related-repo
  CROSS_REPO_TOKEN: ${{ secrets.OTHER_REPO_ISSUES_TOKEN }}
```

(With the Concierge updater these two lines are generated from `related-repos.md` into the workflow's `# concierge:cross-repo-env` marker; the manual wiring is for deployments that do not use it. See [updater.md](updater.md).)

The script writes only to the repository in `CROSS_REPO`, and only to an issue that proves it is the original of the closed one (it carries `related-repo` and has a comment from the harness that names it). The token needs Issues: Read and write on the other repository, which the check below cannot verify. A closer without the token fails its run with a message and writes nothing.


## Release token

The release closer runs on `release: published` and `release: prereleased`. A release created with `GITHUB_TOKEN` does not trigger other workflows.

Create the GitHub release with a fine-grained token, stored as `RELEASE_TOKEN`:

- Resource owner: the account or organization that owns the repository
- Repository access: the repositories that publish releases
- Permission: Contents: Read and write

Use it only for the step that creates the release:

```yaml
token: ${{ secrets.RELEASE_TOKEN }}
```

Pre-filled forms (select the repositories on the form):

- [rockcarver](https://github.com/settings/personal-access-tokens/new?name=RELEASE_TOKEN&description=Create+releases+so+the+release+closer+runs&target_name=rockcarver&expires_in=90&contents=write)
- [vscheuber](https://github.com/settings/personal-access-tokens/new?name=RELEASE_TOKEN&description=Create+releases+so+the+release+closer+runs&target_name=vscheuber&expires_in=90&contents=write)

### Release coupling

Some split-repo projects need a release of the repository where the issue was reported before the reporter is done. Frodo is the example: a library fix is not usable from the CLI until a CLI release pins that library version. Releases are created by a maintainer. The harness does not create them.

Set this on the related entry in the consumer repository:

```yaml
release:
  requires_consumer_release: true
  pins: "@owner/package"
```

GitHub's close-on-merge stays in place. `Fixes #N` may close the issue. Release state is tracked with labels.

- When an issue is closed by a merged pull request, `waiting-for-release` (a plain workflow, no model) adds that label and a comment. The comment is the pull request's `## Resolution` section, the explanation for the person who reported the issue (see "Waiting for Release and the resolution" below), or one line when the pull request has none.
- An issue a maintainer closes by hand (already fixed, no closing pull request or commit), as not planned or as a duplicate, or by a commit, gets neither the label nor a comment: the workflow reads the close event and posts nothing.
- When a release includes it, `release-closer` replaces `waiting-for-release` with `released` and comments.
- A delegated CLI issue stays open. When the library issue closes, it gets `waiting-for-release`. It is closed only when a CLI release pins the library version that contains the fix, and then it gets `released`.

## 3. Compile

After the workflow files are on the default branch (or on the branch you will merge):

```bash
gh aw compile
git add .github/workflows
git commit -m "Compile agentic workflows"
git push
```

`gh aw compile` generates the lock files that GitHub Actions actually runs. Re-run it whenever the markdown sources change.

### Permissions

Workflows must declare read-only GitHub permissions (`contents: read`, `issues: read`). All writes (comments, labels, creating or closing issues, opening pull requests) go through `safe-outputs`. Declaring `issues: write` (or similar) fails compilation in strict mode.

### Label filters

Each gate workflow listens only for its own signal label via `names:` under the trigger. Other label events are skipped and do not start the agent. The exception is `pr-triage`: it is a `pull_request_target` workflow, gh-aw accepts `names:` only under `pull_request`, so it filters with an `if:` on the label name instead (see "Ready signal" in `multi-phase-design.md`).

| Workflow | Runs when labeled |
|----------|-------------------|
| `issue-triage` | `issue-worker-ready` |
| `plan-worker` | `issue-triage-handoff` |
| `plan-triage` | `plan-worker-ready` |
| `pr-worker` | `plan-triage-handoff` |
| `pr-triage` | `pr-worker-ready` (on the pull request) |

### Copilot engine credential

With `engine: copilot`, each run needs a Copilot credential. Without it, activation fails with `None of the following secrets are set: COPILOT_GITHUB_TOKEN`.

#### Option A — fine-grained personal access token (works today)

The token **must** be a fine-grained PAT owned by a **personal account** that has a Copilot subscription. The Copilot Requests permission is not available on organization-owned tokens or classic PATs.

1. Open the pre-filled form:  
   https://github.com/settings/personal-access-tokens/new?name=COPILOT_GITHUB_TOKEN&description=GitHub+Agentic+Workflows+-+Copilot+engine+authentication&user_copilot_requests=read
2. Confirm:
   - **Resource owner** is your user account, not an organization.
   - **Repository access** is **Public repositories**. This setting is required for the Copilot Requests permission to appear; the token can still be used from private organization repositories once stored as a secret.
   - **Account permissions → Copilot Requests** is **Read**.
3. Generate the token and copy the value. GitHub shows it only once.

##### Where to store it

| Scope | When to use | How |
|-------|-------------|-----|
| **Organization secret** | Several repos in the same org (recommended for rockcarver) | One place to rotate. Restrict visibility to the repos that run the harness. |
| **Repository secret** | A single user-owned repo, or when you do not want the token shared | Set it on each repository. |

Organization secret (selected repositories):

```bash
gh secret set COPILOT_GITHUB_TOKEN --org rockcarver --repos frodo-lib,frodo-cli
```

All organization repositories:

```bash
gh secret set COPILOT_GITHUB_TOKEN --org rockcarver --visibility all
```

Repository secret:

```bash
gh secret set COPILOT_GITHUB_TOKEN --repo owner/repo
```

**Recommendation**

- **Organization repositories** (rockcarver): use an **organization secret**, restricted to the repos that run the harness. One rotation point, no per-repo setup. The token is still tied to the person who created it and their Copilot plan; if that person leaves, create a new token from another member and update the org secret.
- **User repositories** (vscheuber): use **repository secrets**. There is no organization to share a secret with. Setting the same token on each repo is fine for a small set.

Usage is billed to the account that owns the token.

#### Option B — organization Copilot billing (no PAT)

If the organization has centralized Copilot billing and allows Copilot CLI to be billed to the organization:

- Add `copilot-requests: write` to the workflow permissions.
- Recompile.

No `COPILOT_GITHUB_TOKEN` is required. Prefer this when available, because it is not tied to a personal account.

## Cost controls

The gates that classify or route use a light model and tight turn limits. The plan worker, which writes the plan, and PR triage, which reads a diff, keep the default model.

| Workflow | Model | max-turns | Extra |
|----------|-------|-----------|-------|
| issue-worker | small | 14 | rate-limit issues and comments |
| issue-triage | small | 8 | |
| plan-triage | small | 8 | |
| release-closer | small | 8 | |
| plan-worker | default | — | |
| pr-worker | small | — | only assigns the coding agent |
| pr-triage | default | — | |

`issue-worker` also rate-limits `issues` and `issue_comment` events to 5 runs per user per 30 minutes, so a chatty reporter, or one who edits an issue over and over, does not restart the agent every time. People with write access are exempt.




## Copilot coding agent token

The PR worker assigns the Copilot coding agent. The default `GITHUB_TOKEN` cannot do that.

Create a fine-grained token owned by a user with an active Copilot subscription:

- Resource owner: the organization that owns the repositories
- Repository access: the repositories that run the PR worker
- Permissions: Actions, Contents, Issues, and Pull requests: Read and write

Store it as a secret named `GH_AW_AGENT_TOKEN`. That name is read automatically by the assignment step. `pr-worker.md` also references it explicitly.

Pre-filled form for the frodo repositories (select `rockcarver/frodo-lib` and `rockcarver/frodo-cli`):

[Create GH_AW_AGENT_TOKEN](https://github.com/settings/personal-access-tokens/new?name=GH_AW_AGENT_TOKEN&description=Assign+the+Copilot+coding+agent+from+the+PR+worker&target_name=rockcarver&expires_in=90&actions=write&contents=write&issues=write&pull_requests=write)

Copilot cloud agent must also be enabled for those repositories: `https://github.com/organizations/<org>/settings/copilot/cloud_agent`.


## Threat detection

Threat detection is a second model call before safe outputs are applied. It is on for the two workflows that read untrusted content and then write:

- `issue-worker` reads the raw report and can comment, label, and create an issue.
- `pr-triage` reads a pull request, including its check results (`checks: read`, `statuses: read`).

It is off on the other gates. Those classify our own comments or apply a fixed label list, and they do not write code.

## Who can start a gate

gh-aw only lets users with the `admin`, `maintainer` or `write` role start a workflow. The check runs in the `pre_activation` job, and a user without one of those roles is skipped without a comment, a label or an error: the run is green and the `agent` job never starts. Being a member of the organization does not count, because the check reads the repository permission, and on a public repository every account has `read`.

- **`issue-worker` is open to everyone** (`roles: all` under `on:`). Reporters are its audience and most have no write access, so with the default check a reporter's issue, and each of their replies, would be ignored. The agent treats the report as untrusted input: no shell, `min-integrity: none` on the GitHub tool, threat detection before any output is applied, and outputs limited to two comments, the labels `issue-worker-ready` and `related-repo`, and one linked issue. The rate limit above bounds the cost: about 1.2 AIC per run.
- **Every other gate keeps the default.** They start from a label, and the label is added by a token with write access (`SIGNAL_TOKEN`, or a maintainer by hand), so the check passes.
- **Symptom of the gate:** a gate run that is green with every job after `pre_activation` skipped, and the `pre_activation` log saying `User permission 'read' does not meet requirements`. For an issue that is already open, dispatch `issue-worker` with its number: the dispatch runs with your permissions.
- **To tighten `issue-worker`** replace `roles: all` with `roles: [admin, maintainer, write]` (the default) or add `triage` and grant that role to the people who should be heard. `read` cannot be used to mean "members": everyone has it.

## Signal token

Gate handoffs are labels. The next workflow starts on the `labeled` event.

GitHub does not start a workflow from an event created by the default `GITHUB_TOKEN`. Safe-outputs apply labels as `github-actions[bot]`, so the next gate never runs unless the label is applied with a different token.

Every deployment needs a secret named `SIGNAL_TOKEN` (rename it in the workflow frontmatter if you prefer another name). It is used as `github-token` on the `add-labels` safe-outputs. The related-repo closer does not use it: it writes to another repository with that repository's secret. The dependency watcher and plan approval resume (below) also use it, outside gh-aw, to change labels so the next gate starts. Issues and Pull requests: Read and write cover all of it. The pull requests permission is needed because the PR gate labels a pull request (`pr-worker-ready`, `pr-triage-handoff`, complexity and risk), and GitHub answers a label change on a pull request with `403 Resource not accessible by personal access token` when the token has only Issues. Observed on frodo-lib#771.

Create a fine-grained token:

- Resource owner: the organization or user that owns the repository
- Repository access: only the repositories that run the harness
- Permissions: Issues: Read and write, and Pull requests: Read and write

Pre-filled form for the frodo repositories (select only `rockcarver/frodo-lib` and `rockcarver/frodo-cli`):

[Create SIGNAL_TOKEN](https://github.com/settings/personal-access-tokens/new?name=SIGNAL_TOKEN&description=Apply+and+remove+harness+labels+so+the+next+gate+starts&target_name=rockcarver&expires_in=90&issues=write&pull_requests=write)

Store it as an organization secret named `SIGNAL_TOKEN`, visible to the repositories that run the harness. Or store a repository secret of that name in each repository.

After the secret exists, remove and re-add the handoff label (or re-run the worker) so the next gate starts.

## Dependency watcher

Issues can declare `Depends on: owner/repo#N`. Issue triage applies `dependency-required` and the issue waits. A plain GitHub Actions workflow, with no LLM, resolves the dependencies and resumes the issue. Rules and edge cases: [shared/dependencies.md](../shared/dependencies.md).

Install it in every deployment. Copy these files:

| From this repository | To the consuming repository |
|----------------------|-----------------------------|
| `workflows/dependency-watch.yml` | `.github/workflows/dependency-watch.yml` |
| `scripts/dependency-watch.mjs` | `.github/scripts/dependency-watch.mjs` |
| `scripts/opt-out.mjs` | `.github/scripts/opt-out.mjs` (the one label check every script shares) |

It is not a gh-aw workflow, so `gh aw compile` does not touch it. Update it by copying the files again.

It runs hourly, on demand, when `dependency-required` is added, and on the events a dependency can be waiting for (an issue closes, a pull request merges, a release is published, `package.json` changes on the default branch), so a merged dependency does not wait for the next scheduled run.

### Plan approval resume

When a maintainer removes `plan-approval-required` from an issue plan triage has classified (high complexity or high risk, which plan triage holds itself, or any classification when the maintainer added the hold by hand), a second plain Actions workflow (no LLM) hands the issue to the PR gate. Without it, removing the label does nothing. The hold itself is enforced by the PR worker, which assigns no coding agent to an issue that carries it. Install it in every deployment. Copy two files:

| From this repository | To the consuming repository |
|----------------------|-----------------------------|
| `workflows/plan-approval-resume.yml` | `.github/workflows/plan-approval-resume.yml` |
| `scripts/plan-approval-resume.mjs` | `.github/scripts/plan-approval-resume.mjs` |

### Waiting for Release and the resolution

When an issue is closed because a pull request merged, a plain Actions workflow (no LLM) tells the reporter how it was resolved and marks the issue as waiting for the release that will contain the fix. The text is the `## Resolution` section of the pull request's description, which a maintainer read before merging; code copies it, so no model reads or writes it ([record 0029](https://github.com/vscheuber/repo-concierge/blob/main/docs/decisions/0029-the-reporter-is-told-how-an-issue-was-resolved.md)).

| From this repository | To the consuming repository |
|----------------------|-----------------------------|
| `workflows/waiting-for-release.yml` | `.github/workflows/waiting-for-release.yml` |
| `scripts/resolution.mjs` | `.github/scripts/resolution.mjs` |
| `scripts/opt-out.mjs` | `.github/scripts/opt-out.mjs` |

It imports `opt-out.mjs`, so install that too; the related-repo closer imports `resolution.mjs`. It needs no secret: its label and comment are written with the workflow token (`issues: write`, `pull-requests: read`). The updater installs all of this with the release.

Write the section in every pull request that closes an issue, for the person who reported it: what was wrong, what changed, what they will see now and how to use it, in three to eight plain sentences. No labels, workflow names or decision numbers; cite a decision record by its full URL. The PR worker tells the coding agent to do this and PR triage reports on it. A pull request without a usable section (none, a placeholder such as `TBD`, or under 20 characters) gets the old one-line comment. The text is used only when a person merged the pull request, and the copy removes HTML, images and `@` mentions and is cut at 1,500 characters. Run it by hand for one closed issue (`dry_run` shows the comment without posting it) from the Actions tab.

### Reporter notify

When an issue was opened from another repository (a split-repo case, see below), nothing written on it reaches the person who reported the original, because they do not take part in the linked issue. A plain Actions workflow (no LLM) mentions them, with the login read from the original issue, after the original confirms the link: once when the issue is linked, and once for each request for information. Install it in every repository that has a `related-repos.md` and receives linked issues.

| From this repository | To the consuming repository |
|----------------------|-----------------------------|
| `workflows/reporter-notify.yml` | `.github/workflows/reporter-notify.yml` |
| `scripts/reporter-notify.mjs` | `.github/scripts/reporter-notify.mjs` |

It imports `janitor.mjs` and `opt-out.mjs`, so install those too. It needs no secret: it reads the original issue with the workflow token, so it works for public related repositories only (a private original is skipped). It runs when a linked issue (one with a `Reported from` line) is opened or gets `plan-approval-required`, `issue-worker-ready` or `needs-info`, or by hand for one issue. It waits a few seconds, at most four checks 15 seconds apart, for the original to confirm the link, because the issue worker labels the original just after it creates the linked issue. It does not run for issues that are not linked. The rules are in [multi-phase-design.md](multi-phase-design.md#split-repo-routing-linked-issues). To stop notifications for a pair of linked issues, remove `related-repo` from the original issue.

### Stalled issue sweep

An issue the issue worker analysed can end up outside the pipeline: its run ended before it signalled, or its request for the gate label was held back as a suggestion, so issue triage never started. A plain Actions workflow (no LLM) finds such issues every hour and gives them `issue-worker-ready` again, so triage reads the analysis that is already there. Install it with the other plain workflows.

| From this repository | To the consuming repository |
|----------------------|-----------------------------|
| `workflows/stalled-issue-sweep.yml` | `.github/workflows/stalled-issue-sweep.yml` |
| `scripts/stalled-issue-sweep.mjs` | `.github/scripts/stalled-issue-sweep.mjs` |

It imports `janitor.mjs` and `opt-out.mjs`, so install those too. It needs `SIGNAL_TOKEN` (Issues: Read and write), because a label added with the workflow token starts no workflow, and it reads pull requests with the workflow token. It leaves alone issues without an analysis of this repository's issue worker, issues that show any progress past issue triage (the hold `plan-approval-required` does not count), originals marked `related-repo`, issues an open pull request closes, bot-authored issues and issues that carry `no-auto-processing`; it waits until the last sign of life is older than a run of issue triage can take, and it stops after a bounded number of re-entries. It never lifts a hold, never comments and never starts the issue worker. Run it by hand with `issue_number` for one issue, and with `dry_run` to see what it would do. The rules are in [multi-phase-design.md](multi-phase-design.md#stalled-issues).

### PR ready signal

The coding agent cannot add labels, so a plain Actions workflow (no LLM) adds `pr-worker-ready` to its pull request when it finishes, which starts PR triage. Install it with the other plain workflows. It needs `SIGNAL_TOKEN` (Issues and Pull requests: Read and write) so the label event starts triage. It sweeps every 15 minutes, so triage starts up to 15 minutes after the agent finishes. Triage itself (a `pull_request` run on a pull request the coding agent opened) then waits for a maintainer's "Approve and run workflows" like CI does, because of the repository's "Require approval for workflow runs" policy; that is the intended human step, and one click covers both.

| From this repository | To the consuming repository |
|----------------------|-----------------------------|
| `workflows/pr-ready-signal.yml` | `.github/workflows/pr-ready-signal.yml` |
| `scripts/pr-ready-signal.mjs` | `.github/scripts/pr-ready-signal.mjs` |

It imports `janitor.mjs` and `opt-out.mjs`, so install those too. The triggers and what each one means are in [multi-phase-design.md](multi-phase-design.md#3-pr-gate). To signal a pull request by hand, run the workflow with its number.

### Janitor

A plain Actions workflow (no LLM) keeps issues and pull requests showing where they are: it removes an earlier gate label once the next signal exists, and the labels that describe open work when an issue closes. It also deletes the runs GitHub holds for approval that approving could only turn into a skipped run or into CI for a commit that is no longer the head: the `Issue Worker` run that each comment by the coding agent on its own pull request leaves behind, the `Dependabot Auto-Merge` run of each of its pushes (only while the repository's workflow still conditions every job on the Dependabot actor), and the runs of pushes its pull request has moved past or of a pull request that is closed. It never deletes the held run for a pull request's current head, which is the approval that matters, and none caused by anyone but the coding agent. Install it with the other plain workflows; it needs no secret. The deletion is a second job that declares `actions: write` and `pull-requests: read` for itself; the label job keeps its smaller token.

| From this repository | To the consuming repository |
|----------------------|-----------------------------|
| `workflows/janitor.yml` | `.github/workflows/janitor.yml` |
| `scripts/janitor.mjs` | `.github/scripts/janitor.mjs` |

`plan-approval-resume.mjs` imports `janitor.mjs` and `opt-out.mjs`, so install the three together; the janitor imports `opt-out.mjs` as well. To tidy issues that closed before the janitor existed, run the workflow once with `include_closed` (use `dry_run` first; it also lists the held runs it would delete and why). The rules are in [multi-phase-design.md](multi-phase-design.md#label-lifecycle) and [multi-phase-design.md](multi-phase-design.md#held-runs).

Requirements: `SIGNAL_TOKEN` with Issues: Read and write (it applies `plan-triage-handoff` so the PR gate starts), and the existing `plan-triage-handoff` label. It acts only on an open issue that has `complexity/high` or `risk/high`, has no `plan-triage-handoff`, and is not labeled `dependency-required`, and it ignores a removal made by a bot account (approval is a human decision). To resume an issue whose label was removed before the workflow was installed, run it from the Actions tab with the issue number.

Requirements:

- `SIGNAL_TOKEN` (see below) with Issues: Read and write. The watcher uses it to remove and re-add `issue-worker-ready` so issue triage starts again.
- The labels `dependency-required` and `dependency-satisfied` (step 4). The watcher cannot add a label that does not exist.
- Read access to the repositories named in dependencies. `github.token` is enough for public repositories.
- For a related repository that needs a release before work can start, set `release.requires_consumer_release` and `release.pins` in `related-repos.md`. The watcher then also requires a published release and a matching pin in `package.json`.

Run it on demand from the Actions tab, optionally with an issue number.

## Deployment check

`check-deployment` catches the configuration mistakes that otherwise surface as a failed run weeks later. It reads the compiled `.lock.yml` of the issue worker and the text of the related-repo closer's workflow (what actually runs) and compares them with `.github/agentic-workflows/related-repos.md`. For every related repository that names a `secret`, it requires that:

- `issue-worker` has `create-issue` enabled with `allowed-repos` containing the repository and `github-token` set to that secret;
- `related-repo-closer.yml` has `CROSS_REPO` set to the repository and `CROSS_REPO_TOKEN` set to that secret (the updater writes both).

It reports a warning for a related repository without a secret, or for an allowed repository that `related-repos.md` does not list. It also prints notices, never failures, when the repository has neither `AGENTS.md` nor `.github/copilot-instructions.md` (see "Repository guidance" above) and when it has neither a `docs/decisions/` nor a `decisions/` folder (see "Decision records" above). It runs on pull requests that touch the workflows or `related-repos.md`, and on demand. Install it in every deployment, even those without related repositories (it then passes immediately). Copy three files:

| From this repository | To the consuming repository |
|----------------------|-----------------------------|
| `workflows/check-deployment.yml` | `.github/workflows/check-deployment.yml` |
| `scripts/check-deployment.mjs` | `.github/scripts/check-deployment.mjs` |
| `scripts/dependency-watch.mjs` | `.github/scripts/dependency-watch.mjs` (already installed for the watcher; the check imports its parser) |

Run it locally with `node .github/scripts/check-deployment.mjs` after `gh aw compile`.

What it cannot check, and you must: that the secret exists (`gh secret list`, or organization settings) and that the token has Issues: Read and write on the target repository and may be used by this repository.

## Cross-repository issue creation

If a repo uses `related-repos.md` and the worker creates the canonical issue in another repository, the default `GITHUB_TOKEN` cannot do that. It is scoped to the repository that runs the workflow.

Each related repository names its own Actions secret in the `secret` field. The name is chosen by the deployment. Create a fine-grained token that can write issues in that repository, and store it under that name.

### Token requirements

- Owner: a user who can create issues in the target repository (an org owner is simplest).
- Type: fine-grained personal access token, or a GitHub App installation token.
- Resource owner: the organization or user that owns the target repository.
- Repository access: only the repository that will receive the issues.
- Permissions: Issues: Read and write. Nothing else is required.
- Expiration: set one. Record the date; the linked-issue flow stops when the token expires.

`create-issue` accepts one token. If several related repositories need different tokens, either give one token access to all of them and reuse that secret name, or use a custom safe-output job that selects the token from the `secret` field.

### Create a fine-grained token

1. Open https://github.com/settings/personal-access-tokens/new
2. Token name: something you will recognize, for example `frodo-lib issues from cli`.
3. Expiration: pick a date. Note it.
4. Resource owner: the organization or user that owns the target repository (`rockcarver` for the frodo repos).
5. If the organization requires approval for fine-grained tokens, enter a justification. Org owners are approved automatically. Until approval, the token can only read public resources.
6. Repository access: **Only select repositories**, then select only the target repository.
7. Permissions → Repository permissions → **Issues**: **Read and write**.
8. Generate the token and copy it. GitHub shows it once.

### Store the secret

Prefer an organization secret when several repositories in the org need the same token. Prefer a repository secret when only one repository uses it.

Organization secret:

1. Open `https://github.com/organizations/<org>/settings/secrets/actions`
2. New organization secret.
3. Name: the `secret` value from `related-repos.md`.
4. Value: the token.
5. Repository access: only the repository that runs the workflow (the one that creates the issue), not the target.

Repository secret:

1. Open `https://github.com/<owner>/<repo>/settings/secrets/actions`
2. New repository secret.
3. Name: the `secret` value from `related-repos.md`.
4. Value: the token.

### Wire the workflow

In the repository that runs the worker, set `create-issue` to the same secret name and allowlist the target repository:

```yaml
create-issue:
  max: 1
  allowed-repos: ["owner/related-repo"]
  github-token: ${{ secrets.OTHER_REPO_ISSUES_TOKEN }}
```

Then recompile (`gh aw compile`) and commit the lock file.

### Frodo

Two tokens, one in each direction. The form links pre-fill the name, description, resource owner (`rockcarver`), a 90-day expiration, and Issues: Read and write. Repository access cannot be pre-filled: on each form, choose **Only select repositories** and select only the target listed below.

| Worker repo | Creates issues in | Secret name | Select only this repository | Form |
|-------------|-------------------|-------------|-----------------------------|------|
| `rockcarver/frodo-cli` | `rockcarver/frodo-lib` | `FRODO_LIB_ISSUES_TOKEN` | `rockcarver/frodo-lib` | [create](https://github.com/settings/personal-access-tokens/new?name=FRODO_LIB_ISSUES_TOKEN&description=Create+issues+in+rockcarver/frodo-lib+from+the+frodo-cli+issue+worker&target_name=rockcarver&expires_in=90&issues=write) |
| `rockcarver/frodo-lib` | `rockcarver/frodo-cli` | `FRODO_CLI_ISSUES_TOKEN` | `rockcarver/frodo-cli` | [create](https://github.com/settings/personal-access-tokens/new?name=FRODO_CLI_ISSUES_TOKEN&description=Create+issues+in+rockcarver/frodo-cli+from+the+frodo-lib+issue+worker&target_name=rockcarver&expires_in=90&issues=write) |

Store each secret on the worker repository (or as an org secret visible to that repository). The `secret` field in that repo's `related-repos.md` must match, and `issue-worker.md` must reference `${{ secrets.<that name> }}`.

## 4. Create labels

The workflows apply and react to specific labels. Create them once per repository:

| Label | Color | Description |
|-------|-------|-------------|
| `complexity/low` | `0e8a16` | Mechanical or minimal design impact; high autonomy possible |
| `complexity/medium` | `fbca04` | Bounded design decisions; moderate autonomy |
| `complexity/high` | `d93f0b` | Significant design impact |
| `risk/low` | `0e8a16` | Limited blast radius |
| `risk/medium` | `fbca04` | Normal code changes |
| `risk/high` | `d93f0b` | Security, auth, data integrity, availability, or public API impact |
| `plan-approval-required` | `b60205` | Hold for approval (also by hand): nothing is assigned; remove to resume (`plan-approval-resume`) |
| `needs-info` | `d4c5f9` | Missing reproduction steps or details |
| `backlog` | `c5def5` | Valid but not urgent; do not plan or implement now |
| `low-hanging-fruit` | `bfdadc` | Valid but not urgent, small and low risk; handed to the plan gate anyway |
| `out-of-scope` | `e4e669` | Matches an explicit exclusion in the project's scope; closed as not planned |
| `scope-review` | `fbca04` | May not fit the scope; a maintainer decides. To accept, remove it and add `issue-triage-handoff` |
| `dependency-required` | `b60205` | Waiting for a dependency; the watcher removes it when the dependency is finished |
| `dependency-satisfied` | `0e8a16` | Dependencies finished or cleared by a maintainer; issue triage lets the issue through |
| `related-repo` | `fbca04` | Original issue; the work is tracked in a related repository |
| `original-in-related-repo` | `fef2c0` | Opened from an issue in a related repository; closing it updates that original |
| `no-auto-processing` | `6a737d` | Concierge never touches this item; remove the label to hand it over |
| `waiting-for-release` | `c5def5` | Fix is merged; waiting for a release that includes it |
| `released` | `0e8a16` | A release includes this fix |
| `issue-worker-ready` | `c2e0c6` | Issue worker finished |
| `issue-triage-handoff` | `bfd4f2` | Issue triage finished; plan worker may run |
| `plan-worker-ready` | `c2e0c6` | Plan worker finished |
| `plan-triage-handoff` | `bfd4f2` | Plan triage finished; PR worker may run |
| `pr-worker-ready` | `c2e0c6` | Coding agent finished |
| `pr-triage-handoff` | `bfd4f2` | PR triage finished; merge rules may act |
| `duplicate` | `cfd3d7` | Strong duplicate match |
| `already-fixed` | `0e8a16` | A later change addresses the report; closed |
| `invalid` | `e4e669` | Cannot reproduce; nothing relevant changed after the issue was opened |
| `priority/p0` | `b60205` | Critical urgency |
| `priority/p1` | `d93f0b` | High urgency |
| `priority/p2` | `fbca04` | Normal urgency |

Example bulk creation (requires `gh`):

```bash
gh label create "complexity/low" --color 0e8a16 --description "Mechanical or minimal design impact; high autonomy possible" --force
# … repeat for the remaining labels
```

### Keeping an item out of the Concierge (`no-auto-processing`)

An issue or pull request with the label `no-auto-processing` is never touched by the Concierge ([the decision record](https://github.com/vscheuber/repo-concierge/blob/main/docs/decisions/0028-an-item-labelled-no-auto-processing-is-never-touched.md)). Create it with the other labels (it is in the table above). A maintainer adds it by hand to anything they handle themselves; removing it from an open issue starts intake once.

A repository that adopts the Concierge with issues of its own should label them once, because a comment on an old issue starts the issue worker like a new one. Label every issue created before the adoption date, open and closed (a reopened old issue would otherwise start intake), in small batches:

```bash
REPO=owner/repo; BEFORE=YYYY-MM-DD   # the day the Concierge was installed
gh issue list --repo "$REPO" --state all --limit 1000 --search "created:<$BEFORE" --json number --jq '.[].number' \
  | while read -r n; do gh issue edit "$n" --repo "$REPO" --add-label no-auto-processing; sleep 1; done
```

Labelling fires `labeled` events: every workflow skips an event for an item that carries the label, so no gate and no agent run starts.

## 5. Branch protection / rulesets

Recommended settings on the default branch:

| Setting | Value |
|---------|-------|
| Require a pull request before merging | On |
| Required approving reviews | 0 |
| Dismiss stale pull request approvals | Off |
| Require status checks to pass | On (your existing CI) |
| Allow force pushes | Off |
| Allow deletions | Off |
| Auto-merge | Off |

These can be applied with classic branch protection or with a ruleset. Required reviews stay at 0 so that low-complexity / low-risk pull requests could auto-merge after checks pass, once auto-merge is enabled. Human review for medium and high items is enforced by the label gates and by maintainers, not by a blanket review requirement.

## 6. Enable auto-merge (optional)

Auto-merge is aspirational and not enabled anywhere yet: the harness is new and has not proven reliable, and it must first stop out-of-scope issues reliably. The Concierge does not enable it or need it, and a maintainer merging by hand is the default.

To allow it, once you decide to: Repository Settings → General → Pull Requests → Allow auto-merge.

Low/low pull requests that carry `pr-triage-handoff` and pass required checks can then merge without further intervention, once auto-merge is switched on for the pull request (by a person, or by a workflow of your own).

## 7. Verify

- Open a test issue (or dispatch `issue-worker` with an issue number). Do it once from an account without write access as well: the agent job must run, and the `pre_activation` log must not say `does not meet requirements`.
- Confirm only `issue-worker` starts. Other gates stay idle until their signal label is applied.
- Confirm the issue receives `issue-worker-ready`, then `issue-triage-handoff` (or `backlog` / `needs-info`), and that each gate label disappears when the next one appears, so only one shows at a time. A small, low-risk issue that is not urgent gets `low-hanging-fruit` together with `issue-triage-handoff`.
- To promote a `backlog` issue by hand, remove `backlog` and add `issue-triage-handoff`; that is the same signal triage would have sent.
- If the repository has an `AGENTS.md` or instruction files, confirm that the plan for an issue in an area an instruction file covers has a "Repository rules that apply" heading of at most five lines naming that file, that a pull request from the coding agent gets a "Repository rules:" line in the triage comment, and that a pull request which edits `AGENTS.md` is flagged for a maintainer instead of being judged by its own edit.
- If the repository has `docs/decisions/` (or `decisions/` at the root) with an accepted record, confirm that the plan for an issue in an area the record covers has a "Decisions that apply" heading of at most five lines naming its number, and that an issue asking for the opposite gets a "Conflicts with NNNN" line, the `plan-approval-required` hold, no hand-off and one comment. Confirm that a pull request which deletes or reverses what a record binds gets a "Decisions:" violation line in the triage comment, and that a pull request which edits a record is flagged for a maintainer instead of being judged by its own edit.
- If the repository has a `scope.md`, open a request that is clearly excluded and confirm it is declined and closed as not planned (`out-of-scope`), and one near the boundary and confirm it gets `scope-review` and stays open.
- For an actionable issue, confirm a plan comment appears (its raw body ends with the hidden `gh-aw-workflow-call-id: owner/repo/plan-worker` comment, with the real repository), that complexity/risk labels are applied, and that the plan triage run did not end in a `noop` saying it could not identify the plan.
- For an issue that plan triage rates high risk (a change to authentication, say) even though its complexity is low, confirm it gets `plan-approval-required` and the comment "High risk. Remove the plan-approval-required label to resume.", and no `plan-triage-handoff`; then remove the label yourself and confirm `plan-approval-resume` hands the issue to the PR gate. For a bug report that contains an error or stack trace, confirm the plan says how the cause was checked, or marks it "Hypothesis (unverified)".
- Add `plan-approval-required` by hand to an open, low-risk issue that has a plan comment, then add `plan-worker-ready` so that plan triage classifies it: confirm it gets complexity and risk labels, no `plan-triage-handoff` and no comment. Add `plan-triage-handoff` by hand and confirm the PR worker run ends without an assignment and the label is gone again. Remove the hold and confirm `plan-approval-resume` hands the issue to the PR gate and the coding agent is assigned. A hold added to an issue that plan triage has not classified is not resumed by removing it: re-add `plan-worker-ready` first.
- Add `no-auto-processing` to an open issue and comment on it: confirm the issue worker is skipped. Remove the label and confirm the issue worker starts once, and that removing a different label starts it not at all.
- Add a gate label (for example `plan-triage-handoff`) to a closed issue and confirm no workflow runs an agent. Open an issue that an open pull request already closes (`Fixes #N` in its body), add `plan-triage-handoff`, and confirm no coding agent is assigned and the issue gets one comment naming the pull request that already closes the issue; close that pull request, add the label again and confirm the hand-off goes through.
- For a low/low item, confirm a pull request is opened. If you enabled auto-merge, confirm it can merge after checks.
- For a split-repo case, confirm a canonical issue is created with `plan-approval-required` and `original-in-related-repo`, the original receives `related-repo`, and the original is closed when the canonical issue closes. Open the test report from an account that is not a maintainer and confirm that the linked issue gets one comment right after it is created that starts `Original report:` and mentions the reporter. Make the linked issue ask for more information (leave out a required detail), and confirm that one comment on the linked issue mentions the reporter and points at the request. Remove `related-repo` from the original and confirm no further comment appears.

## Updating deployments

### While the install PR is still open

Overwrite the workflow files on the PR branch and push:

```bash
git checkout add-agentic-workflows   # or whatever branch the PR uses
for wf in issue-worker issue-triage plan-worker plan-triage pr-worker pr-triage; do
  curl -fsSL "https://raw.githubusercontent.com/vscheuber/repo-concierge/main/workflows/${wf}.md" \
    -o ".github/workflows/${wf}.md"
done
git add .github/workflows/*.md
git commit -m "Update agentic workflows to latest harness"
git push
```

### After the workflows are on the default branch

```bash
gh aw update
gh aw compile
git add .github/workflows
git commit -m "Update agentic workflows"
git push
```

`gh aw update` pulls the latest markdown from the central repository and preserves local edits via a 3-way merge. Always recompile after an update.

## Organization vs user repositories

- User-owned repositories work with a token or GitHub App installation on the user account.
- Organization repositories require the GitHub App (or a token with sufficient scopes) to be installed on the organization. Install it at:
  https://github.com/apps/grok-by-xai/installations/new
  and select the organization.
- Ruleset and branch-protection changes need `administration` permission on the repository.

## Checklist

- [ ] Issues enabled
- [ ] `COPILOT_GITHUB_TOKEN` set (org secret for orgs, repo secret for user repos) or org Copilot billing enabled
- [ ] Workflow `.md` files added (and, if split-repo routing is used, `related-repo-closer.yml` and its script, see above)
- [ ] Optional `.github/agentic-workflows/` config files added only if needed
- [ ] Issue template present (or optional completeness override)
- [ ] `gh aw compile` run and lock files committed
- [ ] All recommended labels created (including `related-repo`, `original-in-related-repo`, `no-auto-processing`, `dependency-required`, `dependency-satisfied`)
- [ ] Issues from before the adoption labelled `no-auto-processing` (see "Keeping an item out of the Concierge")
- [ ] Dependency watcher installed (`dependency-watch.yml` and `dependency-watch.mjs`)
- [ ] Waiting for Release installed (`waiting-for-release.yml` and `resolution.mjs`; the updater does it)
- [ ] Deployment check installed (`check-deployment.yml` and `check-deployment.mjs`) and passing; for each related repository the secret exists and its token has Issues: Read and write on that repository
- [ ] Plan approval resume installed (`plan-approval-resume.yml` and `plan-approval-resume.mjs`)
- [ ] Reporter notify installed where there is a `related-repos.md` (`reporter-notify.yml` and `reporter-notify.mjs`)
- [ ] Stalled issue sweep installed (`stalled-issue-sweep.yml` and `stalled-issue-sweep.mjs`; needs `SIGNAL_TOKEN`; the updater does it)
- [ ] Janitor installed (`janitor.yml` and `janitor.mjs`)
- [ ] PR ready signal installed (`pr-ready-signal.yml` and `pr-ready-signal.mjs`; needs `SIGNAL_TOKEN`)
- [ ] Branch protection / ruleset configured (require PR, status checks, no force-push)
- [ ] Auto-merge enabled (if low/low unattended merge is desired)
- [ ] Test issue processed end-to-end
