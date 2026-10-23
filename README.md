# Repo Concierge

Repo Concierge is an agentic issue-to-release harness for GitHub: a centralized, portable GitHub Agentic Workflows (`gh-aw`) setup for AI-assisted issue triage, planning and tiered fixing, with dependency gating and release tracking. Deployments pin a released version; see [docs/releases.md](docs/releases.md).

Two independent axes control autonomy and blast radius:

- **Complexity** — measures design impact. Higher complexity reduces autonomy and requires more human design input before code is written.
- **Risk** — measures blast radius. Higher risk tightens constraints on what may be changed automatically and requires stronger review gates.

Each stage is a gate.

- Workers signal completion with `<worker-name>-ready`.
- Triage agents signal the next gate with `<triage-name>-handoff`.
- Blocking conditions use `<thing>-required`. Removing the label resumes processing. `dependency-required` is removed automatically by the dependency watcher when the work the issue depends on is finished.

## Releases

Deployments pin a released version, not `main`. Each release carries notes and a `release-manifest.json` with a digest for every deployable file. Versioning rules, the release procedure and what a release contains: [docs/releases.md](docs/releases.md). Deployments pick releases up with the Concierge updater: [docs/updater.md](docs/updater.md).

## Quick Start (Consuming Repo)

```bash
# One-time
gh extension install github/gh-aw

# Install core workflows (pin to a released tag in production, for example @v1.0.0)
gh aw add vscheuber/repo-concierge/issue-worker@main
gh aw add vscheuber/repo-concierge/issue-triage@main
gh aw add vscheuber/repo-concierge/plan-worker@main
gh aw add vscheuber/repo-concierge/plan-triage@main
gh aw add vscheuber/repo-concierge/pr-worker@main
gh aw add vscheuber/repo-concierge/pr-triage@main

# Compile and commit the generated lock files
gh aw compile
git add .github/workflows
git commit -m "Add agentic workflows"
git push
```

Update later while preserving local customizations:
```bash
gh aw update
```

For the full procedure (labels, branch protection, verification, organization installs) see [docs/deployment.md](docs/deployment.md).

## Architecture

See `docs/multi-phase-design.md` for the full model.

| Gate | Worker | Ready label | Triage | Handoff label |
|------|--------|-------------|--------|---------------|
| Issue | `issue-worker` | `issue-worker-ready` | `issue-triage` | `issue-triage-handoff` |
| Plan | `plan-worker` | `plan-worker-ready` | `plan-triage` | `plan-triage-handoff` |
| PR | `pr-worker` | `pr-worker-ready` | `pr-triage` | `pr-triage-handoff` |

The workflows are named `Concierge <code> [▸ ]<Name>` so they sort in the order they run and show which ones can be started by hand (`▸`); see [docs/multi-phase-design.md](docs/multi-phase-design.md#workflow-names).

Gate labels are signals, not history: when the next signal exists the earlier gate label is removed, so an issue shows where it is now, and when an issue closes the labels that describe open work go too (the janitor, plain Actions, no LLM). The janitor also deletes the held runs the coding agent leaves behind that approving cannot make useful (the `Issue Worker` run per comment, the `Dependabot Auto-Merge` run per push, and the runs of commits its pull request has moved past), so the one run left to approve is the pipeline run for the newest commit. See [docs/multi-phase-design.md](docs/multi-phase-design.md#label-lifecycle) for the full table.

High complexity adds `plan-approval-required`. When a maintainer removes that label, `plan-approval-resume` (plain Actions, no LLM) applies `plan-triage-handoff` and the PR gate starts. See [docs/multi-phase-design.md](docs/multi-phase-design.md).

Valid but non-urgent issues receive `backlog` and do not enter the plan gate, with one exception: a low-hanging fruit (the issue worker judges the change small and low in risk, which is low complexity and low risk) receives `low-hanging-fruit` and is handed to the plan gate anyway. Plan triage then makes the real complexity and risk call. To move a `backlog` issue forward by hand, remove `backlog` and add `issue-triage-handoff`.

A repository can add `.github/agentic-workflows/scope.md` (template: [shared/scope.md](shared/scope.md)) to state what the project is for and what it will not do. A request that matches an explicit exclusion is declined with a short reason and closed as not planned (`out-of-scope`). A request that only looks like it may not fit is held for a maintainer (`scope-review`) and nothing is closed. Without the file the check is off. See [docs/multi-phase-design.md](docs/multi-phase-design.md#scope-check).

A repository can also tell coding agents how to work on it, in the files they already load: `AGENTS.md` at the root (template: [shared/agents.md](shared/agents.md)), `.github/copilot-instructions.md`, and `.github/instructions/*.instructions.md` with `applyTo` globs. The plan worker lists the rules that apply to a change in its plan, the PR worker tells the coding agent to follow them, and PR triage adds a "Repository rules:" line to its comment. Both gates read the default branch only, so a pull request cannot weaken the rules it is judged by, and the guidance stays advisory: it never changes a label, a gate or an approval. Without the files nothing changes, and `check-deployment` only prints a notice. See [docs/multi-phase-design.md](docs/multi-phase-design.md#repository-guidance).

The harness only processes work from people. `issue-worker`, `issue-triage`, `plan-worker`, `plan-triage`, `pr-worker`, `related-repo-closer` and `waiting-for-release` skip issues authored by a bot (for example the `[aw] ... failed` issues gh-aw files about its own failures), and `issue-worker` also skips bot comments and comments on pull requests. The check is an activation condition, so a skipped event costs no AI credits. To process a bot-authored issue on purpose, run **Issue Worker** from the Actions tab with its issue number.

An issue that declares `Depends on:` an unfinished issue or pull request receives `dependency-required` and stops at the issue gate. `dependency-watch` resolves it deterministically (no LLM) and resumes the issue, within a minute of a same-repository dependency merging or closing. For split-repo projects, a library dependency counts only when it is merged, released, installable, and pinned by the consuming repository. See [shared/dependencies.md](shared/dependencies.md).

### Safety Model
- Standard agents run read-only; writes go through validated safe-outputs.
- Threat detection scans proposed outputs before application.
- Network access, credit budgets, and execution time are capped per workflow.
- Auto-merge is reserved for the lowest complexity and risk combinations and still depends on repository branch protection.

## Recommended Labels

Create these in consuming repositories (full list and colors in [docs/deployment.md](docs/deployment.md)):

| Label | Axis | Meaning |
|-------|------|---------|
| `complexity/low` | Complexity | Mechanical or minimal design impact; high autonomy possible |
| `complexity/medium` | Complexity | Bounded design decisions; moderate autonomy |
| `complexity/high` | Complexity | Significant design impact |
| `risk/low` | Risk | Limited blast radius |
| `risk/medium` | Risk | Normal code changes |
| `risk/high` | Risk | Security, auth, data integrity, availability, or public API impact |
| `plan-approval-required` | Gate | Added by plan triage for high complexity. Removing it resumes the issue (`plan-approval-resume` hands it to the PR gate) |
| `needs-info` | Quality | Missing reproduction steps or details |
| `dependency-required` | Gate | Issue declares a dependency that is not finished; the watcher removes it (see [shared/dependencies.md](shared/dependencies.md)) |
| `dependency-satisfied` | Gate | Dependencies finished (or cleared by a maintainer); issue triage lets the issue through |
| `backlog` | Quality | Valid but not urgent; do not plan or implement now |
| `low-hanging-fruit` | Quality | Valid but not urgent, small and low risk; handed to the plan gate anyway |
| `out-of-scope` | Quality | Matches an explicit exclusion in the project's `scope.md`; closed as not planned |
| `scope-review` | Quality | May not fit the project's scope; a maintainer decides |
| `issue-worker-ready` | Gate | Issue worker finished |
| `issue-triage-handoff` | Gate | Issue triage finished; plan worker may run |
| `plan-worker-ready` | Gate | Plan worker finished |
| `plan-triage-handoff` | Gate | Plan triage finished; PR worker may run |
| `pr-worker-ready` | Gate | Coding agent finished |
| `pr-triage-handoff` | Gate | PR triage finished; merge rules may act |
| `duplicate` | Quality | Strong duplicate match |
| `priority/p0` … `priority/p2` | Priority | Urgency |

## Routing Matrix (default)

| Complexity \ Risk | Low | Medium | High |
|-------------------|-----|--------|------|
| Low | Agent + auto-merge eligible | Agent + human review | Agent + human review + tight path limits |
| Medium | Agent + human review | Agent + human review | Human review required |
| High | Stop until `plan-approval-required` is removed, then hand off | Stop until `plan-approval-required` is removed, then hand off | Stop until `plan-approval-required` is removed, then hand off |

Repositories may override the matrix locally.

## Repository configuration

The harness relies on ordinary GitHub branch protection and auto-merge. Recommended settings for the default branch (details in [docs/deployment.md](docs/deployment.md)):

| Setting | Value | Reason |
|---------|-------|--------|
| Require a pull request before merging | On | Direct pushes bypass the PR gate |
| Required approving reviews | 0 | Allows low/low auto-merge; human review for medium/high is enforced by labels and process, not by a blanket review requirement |
| Dismiss stale pull request approvals | Off | Only relevant when required reviews > 0 |
| Require status checks to pass | On (your CI) | Auto-merge waits for green checks |
| Require conversation resolution | Off | Optional; not required for the harness |
| Allow force pushes | Off | Protects history |
| Allow deletions | Off | Protects the branch |
| Auto-merge | Enabled | Lets eligible low/low PRs merge when checks pass |

Also create the labels listed above. Without the labels the workflows cannot signal or classify.

## Fine-tuning per Repository

Consuming repositories can:
- Adjust allowed label lists and credit caps.
- Add repository-specific instructions.
- Import shared components.
- Inject a custom environment agent (see `shared/env-agent-contract.md`).
- Keep core routing and safety logic in this central repository.

Local edits are preserved by the 3-way merge performed by `gh aw update`.

## Structure

```
.
├── README.md
├── aw.yml
├── docs/
│   ├── deployment.md
│   └── multi-phase-design.md
├── workflows/
│   ├── issue-worker.md
│   ├── issue-triage.md
│   ├── plan-worker.md
│   ├── plan-triage.md
│   ├── pr-worker.md
│   ├── pr-triage.md
│   ├── dependency-watch.yml
│   ├── plan-approval-resume.yml
│   ├── janitor.yml
│   ├── pr-ready-signal.yml
│   └── check-deployment.yml
├── scripts/
│   ├── dependency-watch.mjs
│   ├── plan-approval-resume.mjs
│   ├── janitor.mjs
│   ├── pr-ready-signal.mjs
│   └── check-deployment.mjs
└── shared/
    ├── dependencies.md
    ├── safety-policy.md
    ├── complexity.md
    ├── risk.md
    ├── env-agent-contract.md
    └── agents.md
```

## Operational Notes

- Inference cost depends on the chosen engine.
- Set `max-ai-credits` and `timeout-minutes` on every workflow. Early gates use smaller budgets.
- Monitor with `gh aw logs` and `gh aw audit`.

## Next Steps

1. Follow [docs/deployment.md](docs/deployment.md) to install, compile, label, and protect the target repository.
2. Optionally inject an environment agent (see `shared/env-agent-contract.md` and `docs/multi-phase-design.md`).
3. Point engines at a self-hosted OpenAI-compatible endpoint if required.
