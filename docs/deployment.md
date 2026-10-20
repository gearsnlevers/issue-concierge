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
    when: |
      When an issue reported here should be tracked in the other repository.
notes: |
  Optional free text.
```

When the worker links an issue it creates a canonical issue in the related repository, cross-links both sides, and applies the internal label `related-repo` to the original. The original stays open until the canonical issue is closed, at which point `related-repo-closer` closes it.

## 3. Compile

After the workflow files are on the default branch (or on the branch you will merge):

```bash
gh aw compile
git add .github/workflows
git commit -m "Compile agentic workflows"
git push
```

`gh aw compile` generates the lock files that GitHub Actions actually runs. Re-run it whenever the markdown sources change.

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
- [ ] Workflow `.md` files added (including `related-repo-closer` if split-repo routing is used)
- [ ] Optional `.github/agentic-workflows/` config files added only if needed
- [ ] Issue template present (or optional completeness override)
- [ ] `gh aw compile` run and lock files committed
- [ ] All recommended labels created (including `related-repo`)
- [ ] Branch protection / ruleset configured (require PR, status checks, no force-push)
- [ ] Auto-merge enabled (if low/low unattended merge is desired)
- [ ] Test issue processed end-to-end
