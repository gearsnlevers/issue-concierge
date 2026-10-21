# Deploying the Harness

Step-by-step instructions for installing the agentic-workflows harness in a consuming repository.

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
gh aw add vscheuber/agentic-workflows/issue-worker@main \
         vscheuber/agentic-workflows/issue-triage@main \
         vscheuber/agentic-workflows/plan-worker@main \
         vscheuber/agentic-workflows/plan-triage@main \
         vscheuber/agentic-workflows/pr-worker@main \
         vscheuber/agentic-workflows/pr-triage@main \
         vscheuber/agentic-workflows/related-repo-closer@main
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
| `related-repos.md` | No | Enable linked-issue routing for split-repo projects |
| `env-agent-contract.md` | No | Contract for an optional injectable environment agent |
| `safety-policy.md` | No | Reference only; not read by workflows |

If `complexity.md` or `risk.md` are absent, plan triage uses built-in defaults.  
If `related-repos.md` is absent, no linked-issue routing occurs.

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

When the worker links an issue it creates a canonical issue in the related repository, cross-links both sides, and applies the internal label `related-repo` to the original. The original stays open until the canonical issue is closed, at which point `related-repo-closer` closes it.



The related-repo closer runs in the repository that owns the fix and writes to the original issue. `SIGNAL_TOKEN` cannot do that. Set `github-token` on `add-comment`, `add-labels`, and `close-issue` to the secret named in this repository's `related-repos.md` for the other repository.


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

- When an issue is closed by a merged pull request, `waiting-for-release` adds that label and a comment.
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

Each gate workflow listens only for its own signal label via `names:` under the trigger. Other label events are skipped and do not start the agent.

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

Early gates use a light model and tight turn limits. Later gates keep the default model.

| Workflow | Model | max-turns | Extra |
|----------|-------|-----------|-------|
| issue-worker | small | 10 | skip if related-repo/duplicate/spam; rate-limit comments |
| issue-triage | small | 8 | skip if related-repo/duplicate/spam |
| plan-triage | small | 8 | |
| related-repo-closer | small | 6 | |
| plan-worker | default | — | |
| pr-worker | default | — | |
| pr-triage | default | — | |

`issue-worker` also rate-limits `issue_comment` to 3 runs per user per 30 minutes so a chatty reporter does not restart the agent on every reply.




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

## Signal token

Gate handoffs are labels. The next workflow starts on the `labeled` event.

GitHub does not start a workflow from an event created by the default `GITHUB_TOKEN`. Safe-outputs apply labels as `github-actions[bot]`, so the next gate never runs unless the label is applied with a different token.

Every deployment needs a secret named `SIGNAL_TOKEN` (rename it in the workflow frontmatter if you prefer another name). It is used as `github-token` on every `add-labels` safe-output.

Create a fine-grained token:

- Resource owner: the organization or user that owns the repository
- Repository access: only the repositories that run the harness
- Permissions: Issues: Read and write

Pre-filled form for the frodo repositories (select only `rockcarver/frodo-lib` and `rockcarver/frodo-cli`):

[Create SIGNAL_TOKEN](https://github.com/settings/personal-access-tokens/new?name=SIGNAL_TOKEN&description=Apply+harness+handoff+labels+so+the+next+gate+starts&target_name=rockcarver&expires_in=90&issues=write)

Store it as an organization secret named `SIGNAL_TOKEN`, visible to the repositories that run the harness. Or store a repository secret of that name in each repository.

After the secret exists, remove and re-add the handoff label (or re-run the worker) so the next gate starts.

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
| `plan-approval-required` | `b60205` | Remove to resume after high-complexity classification |
| `needs-info` | `d4c5f9` | Missing reproduction steps or details |
| `backlog` | `c5def5` | Valid but not urgent; do not plan or implement now |
| `related-repo` | `fbca04` | Non-canonical issue; tracked in a related repository |
| `waiting-for-release` | `c5def5` | Fix is merged; waiting for a release that includes it |
| `released` | `0e8a16` | A release includes this fix |
| `issue-worker-ready` | `c2e0c6` | Issue worker finished |
| `issue-triage-handoff` | `bfd4f2` | Issue triage finished; plan worker may run |
| `plan-worker-ready` | `c2e0c6` | Plan worker finished |
| `plan-triage-handoff` | `bfd4f2` | Plan triage finished; PR worker may run |
| `pr-worker-ready` | `c2e0c6` | Coding agent finished |
| `pr-triage-handoff` | `bfd4f2` | PR triage finished; merge rules may act |
| `duplicate` | `cfd3d7` | Strong duplicate match |
| `priority/p0` | `b60205` | Critical urgency |
| `priority/p1` | `d93f0b` | High urgency |
| `priority/p2` | `fbca04` | Normal urgency |

Example bulk creation (requires `gh`):

```bash
gh label create "complexity/low" --color 0e8a16 --description "Mechanical or minimal design impact; high autonomy possible" --force
# … repeat for the remaining labels
```

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
| Auto-merge | Enabled |

These can be applied with classic branch protection or with a ruleset. Required reviews stay at 0 so low-complexity / low-risk pull requests can auto-merge after checks pass. Human review for medium and high items is enforced by the label gates and by maintainers, not by a blanket review requirement.

## 6. Enable auto-merge (optional)

Repository Settings → General → Pull Requests → Allow auto-merge.

Low/low pull requests that carry `pr-triage-handoff` and pass required checks can then merge without further intervention.

## 7. Verify

- Open a test issue (or dispatch `issue-worker` with an issue number).
- Confirm only `issue-worker` starts. Other gates stay idle until their signal label is applied.
- Confirm the issue receives `issue-worker-ready`, then `issue-triage-handoff` (or `backlog` / `needs-info`).
- For an actionable issue, confirm a plan comment appears with the `<!-- gh-aw-workflow-id: plan-worker -->` marker and that complexity/risk labels are applied.
- For a low/low item, confirm a pull request is opened and can auto-merge after checks.
- For a split-repo case, confirm a canonical issue is created, the original receives `related-repo`, and the original is closed when the canonical issue closes.

## Updating deployments

### While the install PR is still open

Overwrite the workflow files on the PR branch and push:

```bash
git checkout add-agentic-workflows   # or whatever branch the PR uses
for wf in issue-worker issue-triage plan-worker plan-triage pr-worker pr-triage related-repo-closer; do
  curl -fsSL "https://raw.githubusercontent.com/vscheuber/agentic-workflows/main/workflows/${wf}.md" \
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
- [ ] Workflow `.md` files added (including `related-repo-closer` if split-repo routing is used)
- [ ] Optional `.github/agentic-workflows/` config files added only if needed
- [ ] Issue template present (or optional completeness override)
- [ ] `gh aw compile` run and lock files committed
- [ ] All recommended labels created (including `related-repo`)
- [ ] Branch protection / ruleset configured (require PR, status checks, no force-push)
- [ ] Auto-merge enabled (if low/low unattended merge is desired)
- [ ] Test issue processed end-to-end
