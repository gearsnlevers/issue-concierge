# Agentic Workflows Harness

Centralized, portable GitHub Agentic Workflows (`gh-aw`) setup for AI-assisted issue triage and tiered fixing.

Two independent axes control autonomy and blast radius:

- **Complexity** — measures design impact. Higher complexity reduces autonomy and requires more human design input before code is written.
- **Risk** — measures blast radius. Higher risk tightens constraints on what may be changed automatically and requires stronger review gates.

The two axes are assessed and labeled separately so each can be tuned independently per repository.

## Quick Start (Consuming Repo)

```bash
# One-time
gh extension install github/gh-aw

# Install the triage workflow (pin to a tag in production)
gh aw add vscheuber/agentic-workflows/issue-triage@main

# Install the routing workflow
gh aw add vscheuber/agentic-workflows/tiered-fixer@main

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

## Architecture

### Layers
1. **Triage** (`workflows/issue-triage.md`) — runs on new or edited issues. Classifies type, priority, complexity, and risk. Applies labels and posts a summary via safe-outputs.
2. **Routing** (`workflows/tiered-fixer.md`) — reacts to the complexity and risk labels and decides the next action:
   - High complexity without `design-approved` → request design discussion only
   - High risk → assign agent only under tight constraints; human review always required
   - Low complexity + low risk → highest autonomy path (agent PR eligible for auto-merge after checks)
   - Other combinations → agent assignment with appropriate review requirements
3. **Shared components** (`shared/`) — reusable safety defaults, axis definitions, and prompt fragments.

### Safety Model
- The agent job runs read-only.
- All writes occur through validated safe-outputs (allowlists, maxima, sanitization).
- A threat-detection job scans proposed outputs and patches for prompt injection, secret leaks, and malicious changes before any write is applied.
- Network access, credit budgets, and execution time are capped.
- Auto-merge is reserved for the lowest complexity and risk combinations and still depends on repository branch protection and required status checks.

## Recommended Labels

Create these in consuming repositories:

| Label | Axis | Meaning |
|-------|------|---------|
| `complexity/low` | Complexity | Mechanical or minimal design impact; high autonomy possible |
| `complexity/medium` | Complexity | Bounded design decisions; moderate autonomy |
| `complexity/high` | Complexity | Significant design impact; design discussion required before code |
| `risk/low` | Risk | Limited blast radius |
| `risk/medium` | Risk | Normal code changes |
| `risk/high` | Risk | Security, auth, data integrity, availability, or public API impact; tight constraints |
| `design-approved` | Gate | Human signal that design discussion is complete |
| `needs-info` | Quality | Missing reproduction steps or details |
| `duplicate` | Quality | Strong duplicate match |
| `priority/p0` … `priority/p2` | Priority | Urgency |
| `ready-for-agent` | Gate | Explicit go-ahead for agent assignment |

## Routing Matrix (default)

| Complexity \ Risk | Low | Medium | High |
|-------------------|-----|--------|------|
| Low | Agent + auto-merge eligible | Agent + human review | Agent + human review + tight path limits |
| Medium | Agent + human review | Agent + human review | Human review required; agent only if explicitly approved |
| High | Design discussion first | Design discussion first | Design discussion first; extra review gates |

Repositories may override the matrix locally.

## Fine-tuning per Repository

Consuming repositories can:
- Adjust the allowed label lists and credit caps in the local workflow files.
- Add repository-specific instructions in the markdown body.
- Import shared components and pass parameters where `import-schema` is declared.
- Keep core routing and safety logic in this central repository.

Local edits are preserved by the 3-way merge performed by `gh aw update`.

## Structure

```
.
├── README.md
├── aw.yml
├── workflows/
│   ├── issue-triage.md
│   └── tiered-fixer.md
└── shared/
    ├── safety-policy.md
    ├── complexity.md
    ├── risk.md
    └── prompts/
        └── triage-core.md
```

## Operational Notes

- Inference cost depends on the chosen engine (Copilot AI Credits by default or a provider API key).
- Set `max-ai-credits` and `timeout-minutes` on every workflow.
- Monitor usage with `gh aw logs` and `gh aw audit`.
- Public repositories use free GitHub Actions minutes; private repositories consume plan minutes.

## Next Steps

1. Create the recommended labels in each target repository.
2. Install and compile the workflows.
3. Configure branch protection and auto-merge rules that respect the risk and complexity labels.
4. Optionally add an independent reviewer workflow for medium and high-risk changes.
5. Point the engine at a self-hosted OpenAI-compatible endpoint if required.
