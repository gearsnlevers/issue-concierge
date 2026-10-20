# Multi-Gate Design

Each stage is a gate. A worker agent produces an artifact and signals completion with a label. A separate triage agent reacts to that label, classifies the artifact, and decides whether the next gate may open.

Two independent axes are applied by the triage agents:

- **Complexity** — design impact / autonomy
- **Risk** — blast radius

## Completion signals

| Gate | Worker emits | Triage reacts to |
|------|----------------|------------------|
| Issue | `analysis-ready` | `analysis-ready` |
| Plan | `plan-ready` | `plan-ready` |
| PR | `pr-ready` (on the pull request) | `pr-ready` |

## Gates

### 1. Issue gate
**Worker** (`workflows/issue-worker.md`)  
Read the issue and comments. Produce a short analysis. Emit `analysis-ready`.

**Triage** (`workflows/issue-triage.md`)  
Apply quality and priority labels. Emit `ready-for-plan` when actionable.  
Does **not** assign complexity or risk of a fix.

### 2. Plan gate
**Worker** (`workflows/plan-worker.md`)  
Produce a short, cheap, rough plan. Emit `plan-ready`.

**Triage** (`workflows/plan-triage.md`)  
Assign the first `complexity/*` and `risk/*` labels.  
High complexity stops here pending `design-approved`.

### 3. PR gate
**Worker** (`workflows/pr-worker.md`)  
Assign a coding agent when the plan triage has opened the gate.  
Instruct the coding agent to add the label `pr-ready` to the pull request when the PR is opened or updated and ready for review.

**Triage** (`workflows/pr-triage.md`)  
Triggered by `pr-ready` on the pull request.  
Re-evaluate complexity and risk against the real diff.

### Environment agent (optional, injectable)
Not a gate. A repository-specific capability that **any worker agent in any phase** may invoke if the consuming repository has defined it.

See `shared/env-agent-contract.md`. If omitted, workers proceed without it.

### Merge
Normally non-agentic. Branch protection and auto-merge rules act on the labels left by PR triage.
