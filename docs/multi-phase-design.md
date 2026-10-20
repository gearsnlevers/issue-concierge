# Multi-Gate Design

Each stage is a gate. A worker agent produces an artifact; a separate triage agent classifies that artifact and decides whether the next gate may open.

Two independent axes are applied by the triage agents:

- **Complexity** — design impact / autonomy
- **Risk** — blast radius

## Gates

### 1. Issue gate
**Worker** (`workflows/issue-worker.md`)  
Read the issue and comments. Produce a short analysis of completeness and actionability. Emit `analysis-ready`.

**Triage** (`workflows/issue-triage.md`)  
Apply quality and priority labels (`needs-info`, `duplicate`, `priority/*`, `ready-for-plan`).  
Does **not** assign complexity or risk of a fix.

### 2. Plan gate
Runs for almost every issue that receives `ready-for-plan`.

**Worker** (`workflows/plan-worker.md`)  
Produce a short, cheap, rough plan. Emit `plan-ready`.

**Triage** (`workflows/plan-triage.md`)  
Assign the first `complexity/*` and `risk/*` labels against the plan.  
High complexity stops here pending `design-approved`.

### 3. PR gate
**Worker** (`workflows/pr-worker.md`)  
Assign a coding agent when the plan triage has opened the gate. The coding agent implements the change.

**Triage** (`workflows/pr-triage.md`)  
Re-evaluate complexity and risk against the real diff. Prefer deterministic path and size rules where possible.

### Environment agent (optional, injectable)
Not a gate. A repository-specific capability that **any worker agent in any phase** may invoke if the consuming repository has defined it.

Typical uses:
- Attempt reproduction of a reported issue
- Generate or update tests
- Interact with external systems or MCP servers

See `shared/env-agent-contract.md`. If the repository omits an implementation, workers proceed without it.

### Merge
Normally non-agentic. Branch protection and auto-merge rules act on the labels left by PR triage.

## Cost control
Credit caps and timeouts are set per workflow. Early gates use smaller budgets. Later gates run only when earlier ones open them.
