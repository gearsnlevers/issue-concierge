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

Two independent axes are applied by the triage agents:

- **Complexity** — design impact / autonomy
- **Risk** — blast radius

## Plan comment identity

The plan lives as a single comment on the issue.  
gh-aw injects a non-spoofable marker into every comment created by a workflow:

```html
<!-- gh-aw-workflow-id: plan-worker -->
```

`plan-triage` must classify only the newest comment that contains that exact marker.  
Any other comment, even one that looks like a plan, is ignored.

## Human intervention

Low-complexity + low-risk issues are expected to move through the gates with little or no human comment.

For medium, high-complexity, or high-risk items, humans may comment on the plan.  
The plan worker listens for `issue_comment` events. When a relevant human comment appears, it revises the plan and posts a new comment (again carrying the workflow-id marker). Plan triage then re-runs against the newest marked comment.

No label is required to request a revision.

## Timing / waiting policy

The central harness does not impose a waiting period.  
Consuming repositories control timing by editing the local copies of the workflow files (the files installed by `gh aw add`). Typical local changes:

- Add a condition that skips plan triage while a certain label is present.
- Add a short delay or a separate timeout workflow.
- Tighten or loosen the credit and timeout caps.

These are ordinary edits to the markdown workflow files in the consuming repository. `gh aw update` preserves local changes via a 3-way merge. There is no separate configuration-property system; the workflow files themselves are the control surface.

## Gates

### 1. Issue gate
**Worker** (`workflows/issue-worker.md`)  
Emit `issue-worker-ready`.

**Triage** (`workflows/issue-triage.md`)  
Apply quality and priority labels. Emit `issue-triage-handoff` when the issue is actionable.  
Does **not** assign complexity or risk of a fix.

### 2. Plan gate
**Worker** (`workflows/plan-worker.md`)  
Triggered by `issue-triage-handoff` or by a later human comment. Emit `plan-worker-ready`.

**Triage** (`workflows/plan-triage.md`)  
Assign complexity and risk. Emit `plan-triage-handoff` only when coding may proceed (not when high complexity is waiting for `design-approved`).

### 3. PR gate
**Worker** (`workflows/pr-worker.md`)  
Triggered by `plan-triage-handoff`. Assigns a coding agent and instructs it to emit `pr-worker-ready` on the pull request.

**Triage** (`workflows/pr-triage.md`)  
Triggered by `pr-worker-ready`. Re-evaluates complexity and risk against the diff. Emit `pr-triage-handoff` when complete.

### Environment agent (optional, injectable)
Not a gate. Any worker in any phase may invoke it if the consuming repository has defined it. See `shared/env-agent-contract.md`.

### Merge
Normally non-agentic. Branch protection and auto-merge rules act on the labels present after `pr-triage-handoff`.
