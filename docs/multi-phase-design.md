# Multi-Gate Design

Each stage is a gate. A worker agent produces an artifact; a separate triage agent classifies that artifact and decides whether the next gate may open. Classification is never mixed into the same step that creates the artifact (except possibly the first issue gate).

Two independent axes are applied by the triage agents:

- **Complexity** — design impact / autonomy
- **Risk** — blast radius

## Gates

### 1. Issue gate
**Worker (Analyze)**  
Read the issue and comments. Assess completeness and actionability.

**Triage**  
Apply quality and priority labels (`needs-info`, `duplicate`, `priority/*`, `ready-for-plan`).  
Does **not** assign complexity or risk of a fix.

This gate may be collapsed into a single agent for cost reasons; the later gates must not be.

### 2. Plan gate
Runs for almost every issue that passes the issue gate with enough actionable detail.

**Worker (Analyze and create the plan)**  
Produce a short, cheap, rough plan: expected touch points, rough size, notable risks, and whether a design discussion is likely. No code.

**Triage**  
Assign the first `complexity/*` and `risk/*` labels against the plan.  
High complexity stops here pending `design-approved`.

### 3. PR gate
**Worker (Analyze and code)**  
Implement the change (or the portion allowed by the plan triage).

**Triage**  
Re-evaluate complexity and risk against the real diff. Prefer deterministic path and size rules where possible.  
Output refined labels; may request changes or block auto-merge.

### Environment agent (optional, injectable)
Not a gate. A repository-specific capability that **any worker agent in any phase** may invoke if the consuming repository has defined it.

Typical uses:
- Attempt reproduction of a reported issue
- Generate or update tests (Polly.js recordings/snapshots in frodo-lib / frodo-cli, or equivalent elsewhere)
- Interact with external systems or MCP servers

The harness defines only the contract (how a worker requests the call, what inputs are passed, what outputs are expected). The consuming repository supplies the implementation or omits it entirely. If omitted, workers proceed without it and later triages reflect the reduced confidence.

### Merge
Normally non-agentic. Branch protection, required checks, and auto-merge rules act on the labels left by the PR triage.

## Cost control
- Issue gate: small credit budget, short timeout.
- Plan worker: still cheap; only a rough plan.
- Later workers and triages run only when earlier gates open them.
- Credit caps and timeouts are set per workflow.

## Research note: environment agent options
Thoroughly research how a consuming repository can supply a richer agent environment. Options to evaluate:

- Self-hosted GitHub Actions runners with pre-installed tools, credentials, and MCP servers
- Reusable workflow or composite action that the harness calls and that the consuming repo overrides
- External agent (OpenHands, custom container, etc.) invoked via webhook or `workflow_dispatch`
- gh-aw engine configuration that points at a self-hosted OpenAI-compatible endpoint with additional tools
- How to keep the agent tightly constrained even when it needs limited write access for test fixtures

The harness must remain usable in repositories that provide none of these capabilities.
