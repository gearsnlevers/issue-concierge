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

## Gates

### 1. Issue gate
**Worker** → plain-language analysis comment + internal `issue-worker-ready`  
(or `related-repo` and no ready label if linked elsewhere)  
**Triage** → internal quality/priority labels. Emits `issue-triage-handoff` when actionable; applies `needs-info` otherwise. Skips issues that already have `related-repo`.

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
The PR worker never reads the issue: its activation condition (an `if:` on the label event) already excludes bot-authored issues and issues labeled `dependency-required`, and the instructions it passes to the coding agent are static. Reading untrusted issue content is blocked by gh-aw's integrity policy unless a workflow opts out with `min-integrity: none`, which made the worker refuse to assign the agent (frodo-lib#760); this design needs no such opt-out.

The assignment is sent without issue-intent metadata (`issue-intent: false`). With it, gh-aw sends the agent's `confidence` and `rationale` along with the assignee, and GitHub's Agent suggestions preview holds anything below `HIGH` as a pending suggestion that a person must accept on the issue page (frodo-lib#760, confidence `MEDIUM`: the call reported success and nothing was assigned until someone clicked Accept). The gate here is the `plan-triage-handoff` label, which a person or plan triage already decided on, so the assignment is a mechanical step and must not depend on how the model rates its own confidence.

**Triage** → re-evaluates against the diff, emits `pr-triage-handoff`.

### Environment agent
Optional. Any worker may invoke it if the consuming repository defines it.

### Merge
Branch protection and auto-merge rules act on the final labels.
