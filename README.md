# Agentic Workflows Harness

Centralized, portable GitHub Agentic Workflows (`gh-aw`) setup for:

- AI issue triage (classify, label, detect duplicates, ask for missing info)
- Tiered automated fixing:
  - **Small / minor**: agent proposes PR; eligible for auto-merge after checks (no human review required)
  - **Medium**: agent proposes PR; human review required
  - **Complex**: mandatory design discussion / approval before any code is written
- Strong prompt-injection protection via `gh-aw` safe-outputs + threat detection
- Reusable across multiple repositories with local fine-tuning

This repository is the **source of truth**. Consuming repos install workflows with `gh aw add` and import shared components. Local customizations (labels, paths, complexity heuristics, models, credit caps) are preserved on update via 3-way merge.

## Quick Start (Consuming Repo)

```bash
# One-time
gh extension install github/gh-aw

# Install the triage workflow (pin to a tag in production)
gh aw add vscheuber/agentic-workflows/issue-triage@main

# Or install the fixer routing workflow
gh aw add vscheuber/agentic-workflows/tiered-fixer@main

# Compile and push the generated .lock.yml files
gh aw compile
git add .github/workflows
git commit -m "Add agentic workflows"
git push
```

Update later with:
```bash
gh aw update
```

## Architecture

### Layers
1. **Triage** (`workflows/issue-triage.md`) — runs on new/edited issues. Classifies complexity, type, priority. Uses safe-outputs for labels and comments.
2. **Routing / Fixer** (`workflows/tiered-fixer.md`) — reacts to triage labels.
   - Small → assign to Copilot cloud agent + enable auto-merge path
   - Medium → assign to Copilot cloud agent (reviews still required)
   - Complex → comment requesting design discussion; do **not** assign an agent until a human adds `design-approved`
3. **Shared components** (`shared/`) — safety policy, label sets, MCP configs, prompt fragments. Imported by workflows so they stay DRY.

### Safety Model (from today’s discussion)
- Agent job is **read-only**.
- All writes go through validated **safe-outputs** (allowlists, max counts, sanitization).
- Automatic **threat detection** job scans proposed outputs and patches for prompt injection, secret leaks, and malicious changes before anything is applied.
- Network firewall, compile-time validation, and credit/turn caps.
- Auto-merge for small fixes is optional and should be paired with strict CI + independent reviewer if possible. Residual risk remains; prefer human review for anything non-mechanical.

## Recommended Labels (create these in consuming repos)

| Label | Purpose |
|-------|---------|
| `complexity/small` | Eligible for auto-fix without human review |
| `complexity/medium` | Agent fix + human review required |
| `complexity/complex` | Design discussion mandatory before code |
| `design-approved` | Human signal that design is accepted; unblocks agent |
| `needs-info` | Missing reproduction / details |
| `duplicate` | Strong duplicate match |
| `priority/p0` … `priority/p2` | Priority |
| `ready-for-agent` | Explicit go-ahead |

## Fine-tuning per Repository

In a consuming repo you can:
- Override labels, allowed paths, or credit caps in the local workflow markdown.
- Pass parameters via `imports: ... with:` if the shared component declares `import-schema`.
- Add repo-specific instructions in the markdown body after the import.
- Keep the core safety and routing logic in this central repo.

Example local override sketch:
```yaml
imports:
  - uses: vscheuber/agentic-workflows/shared/safety-policy.md@main
    with:
      max_ai_credits: 50
      allowed_paths: ["src/**", "lib/**"]
```

## Structure

```
.
├── README.md
├── aw.yml                          # package manifest (optional)
├── workflows/
│   ├── issue-triage.md
│   └── tiered-fixer.md
└── shared/
    ├── safety-policy.md
    ├── complexity-labels.md
    └── prompts/
        └── triage-core.md
```

## Cost & Ops Notes

- Inference is billed via the chosen engine (Copilot AI Credits by default, or provider API keys).
- Set `max-ai-credits` and `timeout-minutes` in every workflow.
- Public repos use free Actions minutes; private repos draw from the plan.
- Monitor with `gh aw logs` and `gh aw audit`.

## Next Steps

1. Create the recommended labels in target repositories.
2. Install and compile the workflows.
3. Configure branch protection / auto-merge rules for the small tier (bypass or auto-approve only for tightly constrained cases).
4. Optionally add an independent reviewer agent workflow.
5. Point engines at a self-hosted inference endpoint if desired (OpenAI-compatible base URL).

See the individual workflow files for the concrete prompts and safe-output configurations.
