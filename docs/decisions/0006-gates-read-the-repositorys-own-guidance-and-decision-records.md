---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/plan-worker.md
  - workflows/pr-worker.md
  - workflows/pr-triage.md
  - scripts/check-deployment.mjs
issues:
  - vscheuber/repo-concierge#30
  - vscheuber/repo-concierge#39
---

# Gates read the repository's own guidance and decision records

## Context and problem statement

A decision taken weeks ago, or a rule in a repository's `AGENTS.md`, reached nobody who was not already in the room: plans and reviews were written without it. Repositories already keep this knowledge in files that people and coding agents load on their own. Recorded retroactively from the plan and PR gates.

## Decision

- The plan worker reads `AGENTS.md`, `.github/copilot-instructions.md` and the `.github/instructions/*.instructions.md` files whose `applyTo` matches, and the repository's decision records. Its plan lists "Repository rules that apply" and "Decisions that apply", at most five lines each, each line naming its source.
- Records are read from one folder: `docs/decisions/` when it has a `README.md`, otherwise `decisions/` at the root (for a repository whose `docs/` is generated). The index first, then at most four records whose `applies-to` matches.
- PR triage reads the same from the default branch only, never from the pull request's branch, and reports one "Decisions:" line. It is advisory: it never changes a complexity, risk or hand-off label, and records rank below the harness's safety policy.
- The PR worker only passes one static sentence to the coding agent: follow `AGENTS.md` and the matching instruction files, and run the checks they list.
- Check Deployment prints a notice, never a failure, when a repository has neither `AGENTS.md` nor `.github/copilot-instructions.md`.

## Consequences

- A repository that writes its decisions down gets them applied by the gates. One that does not is unaffected.
- A pull request cannot change the decisions that judge it.
