# Agentic Workflows Harness

Centralized, portable GitHub Agentic Workflows (`gh-aw`) setup for AI-assisted issue triage and tiered fixing.

Two independent axes control autonomy and blast radius:

- **Complexity** — measures design impact. Higher complexity reduces autonomy and requires more human design input before code is written.
- **Risk** — measures blast radius. Higher risk tightens constraints on what may be changed automatically and requires stronger review gates.

Each stage is a gate. A worker agent produces an artifact; a separate triage agent classifies it and decides whether the next gate opens.

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

See `docs/multi-phase-design.md` for the full model. Summary of gates:

1. **Issue gate** — Analyze, then triage for validity, priority, and completeness. Does not assign fix complexity/risk. May be collapsed into one step.
2. **Plan gate** — Worker produces a cheap rough plan for almost every actionable issue; triage assigns the first complexity and risk labels. High complexity waits for `design-approved`.
3. **PR gate** — Worker implements; triage re-evaluates against the real diff (deterministic rules preferred).
4. **Environment agent** (optional, injectable) — called by workers when deeper integration (reproduction, test generation, external systems) is required. Skipped if the repo does not provide it.
5. **Merge** — normally branch protection and auto-merge rules driven by the final labels.

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
| `needs-reproduction` | Gate | Optional signal to invoke the environment agent |
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
- Adjust allowed label lists and credit caps.
- Add repository-specific instructions.
- Import shared components.
- Inject a custom environment agent.
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

- Inference cost depends on the chosen engine.
- Set `max-ai-credits` and `timeout-minutes` on every workflow. Early gates use smaller budgets.
- Monitor with `gh aw logs` and `gh aw audit`.

## Next Steps

1. Create the recommended labels in each target repository.
2. Install and compile the workflows.
3. Configure branch protection and auto-merge rules.
4. Optionally inject an environment agent (see `docs/multi-phase-design.md`).
5. Point engines at a self-hosted OpenAI-compatible endpoint if required.
