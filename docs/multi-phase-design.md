# Multi-Phase Triage Design

Classification of complexity and risk is most accurate when performed against concrete artifacts (a plan, a diff). Early stages should stay cheap and limited.

## Phases

### 1. Issue triage (always on, cheap)
- Trigger: issue opened / edited
- Purpose: validity, completeness, priority, type, duplicate detection
- Does **not** assign complexity or risk of a fix
- Output: labels such as `needs-info`, `duplicate`, `priority/*`, `ready-for-plan`
- Cost: low (small credit budget, short timeout)

### 2. Environment agent (optional, custom, injectable)
- Trigger: label such as `needs-reproduction` or explicit command, only if the consuming repo supplies the capability
- Purpose: deeper integration tasks that require a richer environment than a standard GitHub Actions sandbox
  - Attempt reproduction of reported issues
  - Generate or update tests (including recordings / snapshots)
  - Interact with external systems, configuration stores, or MCP servers
- Implementation is repository-specific. Examples:
  - frodo-lib / frodo-cli: Polly.js recordings and snapshots for configuration-management tests
  - Other repos: whatever local or self-hosted environment they provide
- The harness only defines the contract (inputs, expected outputs, how it is invoked). The consuming repo injects the actual agent or workflow.
- If the repo does not provide this capability, the phase is skipped and later stages proceed with reduced confidence.

### 3. Plan triage
- Trigger: after issue triage (and optionally after environment agent)
- Purpose: produce or accept a short plan, then assign the first complexity and risk labels
- High complexity stops here pending `design-approved`
- Output: plan comment or file + `complexity/*` and `risk/*` labels

### 4. PR triage
- Trigger: pull request opened or synchronized
- Purpose: re-evaluate complexity and risk against the real diff; apply deterministic path and size rules where possible
- Can invoke the same environment agent when complex test generation or validation is required
- Output: refined labels; may request changes or block auto-merge

### 5. Merge (usually non-agentic)
- Handled by branch protection, required checks, and auto-merge rules based on the labels left by PR triage
- A separate agentic merge step is optional and usually unnecessary for a first version

## Cost control
Issue triage stays small and fast. Later phases run only when earlier gates pass and only when the repository has enabled them. Credit caps and timeouts are set per workflow.

## Research note: environment agent options
Thoroughly research how a consuming repository can supply a richer agent environment for reproduction and test generation. Options to evaluate:

- Self-hosted GitHub Actions runners with pre-installed tools, credentials, and MCP servers
- Reusable workflow or composite action that the harness calls and that the consuming repo overrides
- External agent (OpenHands, custom container, etc.) invoked via a webhook or `workflow_dispatch`
- gh-aw engine configuration that points at a self-hosted OpenAI-compatible endpoint with additional tools
- How to keep the agent read-only or tightly sandboxed even when it needs limited write access for test fixtures

The harness must remain usable in repos that provide none of these capabilities.
