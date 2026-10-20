# Agentic Workflows Harness

Centralized, portable GitHub Agentic Workflows (`gh-aw`) setup for AI-assisted issue triage and tiered fixing.

Two independent axes control autonomy and blast radius:

- **Complexity** — measures design impact. Higher complexity reduces autonomy and requires more human design input before code is written.
- **Risk** — measures blast radius. Higher risk tightens constraints on what may be changed automatically and requires stronger review gates.

The axes are applied at multiple stages. Early stages stay cheap; later stages have more concrete artifacts to classify.

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

See `docs/multi-phase-design.md` for the full multi-phase model. Summary:

1. **Issue triage** (always on, cheap) — validity, priority, completeness. Does not assign fix complexity/risk.
2. **Environment agent** (optional, custom) — injectable deeper capability for reproduction, test generation (e.g. Polly.js recordings/snapshots), or interaction with external systems. Skipped if the repo does not provide it.
3. **Plan triage** — first assignment of complexity and risk against a plan. High complexity gates on `design-approved`.
4. **PR triage** — re-evaluate against the real diff; deterministic path/size rules preferred. Can again call the environment agent.
5. **Merge** — normally handled by branch protection and auto-merge rules driven by the final labels.

### Safety Model
- The agent job runs read-only unless an explicitly injected environment agent is granted additional capabilities.
- All writes from standard agents occur through validated safe-outputs (allowlists, maxima, sanitization).
- A threat-detection job scans proposed outputs and patches for prompt injection, secret leaks, and malicious changes before any write is applied.
- Network access, credit budgets, and execution time are capped per workflow.
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
- Adjust the allowed label lists and credit caps in the local workflow files.
- Add repository-specific instructions in the markdown body.
- Import shared components and pass parameters where `import-schema` is declared.
- Inject a custom environment agent for reproduction and test generation.
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

- Inference cost depends on the chosen engine (Copilot AI Credits by default or a provider API key).
- Set `max-ai-credits` and `timeout-minutes` on every workflow. Early phases use smaller budgets.
- Monitor usage with `gh aw logs` and `gh aw audit`.
- Public repositories use free GitHub Actions minutes; private repositories consume plan minutes.

## Next Steps

1. Create the recommended labels in each target repository.
2. Install and compile the workflows.
3. Configure branch protection and auto-merge rules that respect the risk and complexity labels.
4. Optionally inject an environment agent for reproduction and test generation (see `docs/multi-phase-design.md`).
5. Point engines at a self-hosted OpenAI-compatible endpoint if required.
