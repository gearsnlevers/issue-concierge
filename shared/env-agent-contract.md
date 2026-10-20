# Environment Agent Contract

Optional, repository-specific capability. **Any worker agent in any phase** may request it if the consuming repository has defined an implementation.

## Contract
A worker requests the environment agent by:
1. Adding a comment or label that the repository’s environment-agent workflow listens for, or
2. Emitting a structured safe-output that a local workflow translates into a call.

Inputs typically include:
- Issue or PR number
- Relevant file paths or plan excerpt
- Requested action (reproduce, generate-tests, validate, etc.)

Outputs typically include:
- Success/failure
- Artifacts (recordings, snapshots, logs, new test files)
- Confidence note for later triage

## Implementation
The harness does not ship an implementation. Consuming repositories supply one (self-hosted runner, reusable workflow, external agent, etc.) or omit it. Workers must function correctly when the agent is absent.
