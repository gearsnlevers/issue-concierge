# Multi-Gate Design

Each stage is a gate. A worker agent produces an artifact and signals completion with a label. A separate triage agent reacts to that label, classifies the artifact, and decides whether the next gate may open.

## Label convention

Worker completion signals use the form `<worker-name>-ready`:

| Worker | Completion label |
|--------|------------------|
| `issue-worker` | `issue-worker-ready` |
| `plan-worker` | `plan-worker-ready` |
| `pr-worker` (via coding agent) | `pr-worker-ready` |

Triage agents react only to their matching `*-ready` label.

Two independent axes are applied by the triage agents:

- **Complexity** — design impact / autonomy
- **Risk** — blast radius

## Gates

### 1. Issue gate
**Worker** (`workflows/issue-worker.md`)  
Read the issue and comments. Produce a short analysis. Emit `issue-worker-ready`.

**Triage** (`workflows/issue-triage.md`)  
Apply quality and priority labels. Emit `ready-for-plan` when actionable.  
Does **not** assign complexity or risk of a fix.

### 2. Plan gate
**Worker** (`workflows/plan-worker.md`)  
Produce a short, cheap, rough plan. Emit `plan-worker-ready`.

**Triage** (`workflows/plan-triage.md`)  
Assign the first `complexity/*` and `risk/*` labels.  
High complexity stops here pending `design-approved`.

### 3. PR gate
**Worker** (`workflows/pr-worker.md`)  
Assign a coding agent when the plan triage has opened the gate.  
Instruct the coding agent to add the label `pr-worker-ready` to the pull request when the PR is opened or updated and ready for review.

**Triage** (`workflows/pr-triage.md`)  
Triggered by `pr-worker-ready` on the pull request.  
Re-evaluate complexity and risk against the real diff.

### Environment agent (optional, injectable)
Not a gate. A repository-specific capability that **any worker agent in any phase** may invoke if the consuming repository has defined it.

See `shared/env-agent-contract.md`. If omitted, workers proceed without it.

### Merge
Normally non-agentic. Branch protection and auto-merge rules act on the labels left by PR triage.
