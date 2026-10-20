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

## Gates

### 1. Issue gate
**Worker** (`workflows/issue-worker.md`)  
Emit `issue-worker-ready`.

**Triage** (`workflows/issue-triage.md`)  
Apply quality and priority labels. Emit `issue-triage-handoff` when the issue is actionable.  
Does **not** assign complexity or risk of a fix.

### 2. Plan gate
**Worker** (`workflows/plan-worker.md`)  
Triggered by `issue-triage-handoff`. Emit `plan-worker-ready`.

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
