# Agentic Workflows Harness

Centralized, portable GitHub Agentic Workflows (`gh-aw`) setup for AI-assisted issue triage and tiered fixing.

Two independent axes control autonomy and blast radius:

- **Complexity** — measures design impact. Higher complexity reduces autonomy and requires more human design input before code is written.
- **Risk** — measures blast radius. Higher risk tightens constraints on what may be changed automatically and requires stronger review gates.

Each stage is a gate.

- Workers signal completion with `<worker-name>-ready`.
- Triage agents signal the next gate with `<triage-name>-handoff`.

## Quick Start (Consuming Repo)

```bash
# One-time
gh extension install github/gh-aw

# Install core workflows (pin to a tag in production)
gh aw add vscheuber/agentic-workflows/issue-worker@main
gh aw add vscheuber/agentic-workflows/issue-triage@main
gh aw add vscheuber/agentic-workflows/plan-worker@main
gh aw add vscheuber/agentic-workflows/plan-triage@main
gh aw add vscheuber/agentic-workflows/pr-worker@main
gh aw add vscheuber/agentic-workflows/pr-triage@main

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

See `docs/multi-phase-design.md` for the full model.

| Gate | Worker | Ready label | Triage | Handoff label |
|------|--------|-------------|--------|---------------|
| Issue | `issue-worker` | `issue-worker-ready` | `issue-triage` | `issue-triage-handoff` |
| Plan | `plan-worker` | `plan-worker-ready` | `plan-triage` | `plan-triage-handoff` |
| PR | `pr-worker` | `pr-worker-ready` | `pr-triage` | `pr-triage-handoff` |

The environment agent is optional and injectable. Any worker in any phase may invoke it if the consuming repository has defined an implementation.

### Safety Model
- Standard agents run read-only; writes go through validated safe-outputs.
- Threat detection scans proposed outputs before application.
- Network access, credit budgets, and execution time are capped per workflow.
- Auto-merge is reserved for the lowest complexity and risk combinations and still depends on repository branch protection.

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
| `issue-worker-ready` | Gate | Issue worker finished |
| `issue-triage-handoff` | Gate | Issue triage finished; plan worker may run |
| `plan-worker-ready` | Gate | Plan worker finished |
| `plan-triage-handoff` | Gate | Plan triage finished; PR worker may run |
| `pr-worker-ready` | Gate | Coding agent finished |
| `pr-triage-handoff` | Gate | PR triage finished; merge rules may act |
| `duplicate` | Quality | Strong duplicate match |
| `priority/p0` … `priority/p2` | Priority | Urgency |

## Routing Matrix (default)

| Complexity \ Risk | Low | Medium | High |
|-------------------|-----|--------|------|
| Low | Agent + auto-merge eligible | Agent + human review | Agent + human review + tight path limits |
| Medium | Agent + human review | Agent + human review | Human review required; agent only if explicitly approved |
| High | Design discussion first | Design discussion first | Design discussion first; extra review gates |

Repositories may override the matrix locally.

## Fine-tuning per Repository

Consuming repositories can:
- Adjust allowed label lists and credit caps.
- Add repository-specific instructions.
- Import shared components.
- Inject a custom environment agent (see `shared/env-agent-contract.md`).
- Keep core routing and safety logic in this central repository.

Local edits are preserved by the 3-way merge performed by `gh aw update`.

## Structure

```
.
├── README.md
├── aw.yml
├── docs/
│   └── multi-phase-design.md
├── workflows/
│   ├── issue-worker.md
│   ├── issue-triage.md
│   ├── plan-worker.md
│   ├── plan-triage.md
│   ├── pr-worker.md
│   └── pr-triage.md
└── shared/
    ├── safety-policy.md
    ├── complexity.md
    ├── risk.md
    └── env-agent-contract.md
```

## Operational Notes

- Inference cost depends on the chosen engine.
- Set `max-ai-credits` and `timeout-minutes` on every workflow. Early gates use smaller budgets.
- Monitor with `gh aw logs` and `gh aw audit`.

## Next Steps

1. Create the recommended labels in each target repository.
2. Install and compile the workflows.
3. Configure branch protection and auto-merge rules.
4. Optionally inject an environment agent (see `shared/env-agent-contract.md` and `docs/multi-phase-design.md`).
5. Point engines at a self-hosted OpenAI-compatible endpoint if required.
