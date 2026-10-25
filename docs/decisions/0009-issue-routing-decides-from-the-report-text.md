---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/issue-worker.md
  - workflows/plan-worker.md
  - shared/related-repos.md
issues:
  - vscheuber/repo-concierge#41
---

# Issue routing decides from the report text

## Context and problem statement

The issue worker can move an issue to a related repository. A repository's own routing hint ("send authentication flows to the library") was applied by keyword, and a wrapper error from one layer sent an issue to the layer that only reports it. The routed issue then got a plan and a coding agent for the wrong code. Recorded retroactively from #41, which replayed 33 historical issues whose right repository is known.

## Decision

- The worker takes the innermost cause, applies the layering the repository states, and keeps the issue by default; keeping needs no tool call.
- It routes only when the report itself names the failing component in the related repository, and it quotes those words in its rationale. The hints in `related-repos.md` say where to look and are never evidence by themselves.
- No search decides. Searching both repositories added turns and a failure mode and no accuracy: a command that wraps a library function matches in both, and the variant that used the searches routed 1 of 9 library issues with the small model and 3 of 9 with the larger one.
- A routed issue starts held for plan approval, and the plan gate checks the layer before any code is planned.

## Consequences

- About a third of true library issues stay in the CLI repository; a maintainer moves them. That costs less than a wrong-layer fix.
- Measured on 33 issues with one pass per cell, so the percentages are coarse.
