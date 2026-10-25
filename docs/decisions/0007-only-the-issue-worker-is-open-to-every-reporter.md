---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/issue-worker.md
  - tools/issue-worker-roles.test.mjs
  - docs/deployment.md
issues:
  - vscheuber/repo-concierge#31
---

# Only the issue worker is open to every reporter

## Context and problem statement

gh-aw starts a workflow only for users with the `admin`, `maintainer` or `write` role. A reporter without write access, including a member of the owning organization, was silently ignored: the run was green but only the membership check ran. On a public repository every account has `read`. Recorded retroactively from #31.

## Decision

- Every gate keeps gh-aw's default role check except the issue worker, which sets `roles: all` under `on:`. A per-user rate limit applies (5 runs per user per 30 minutes; writers are exempt).
- The later gates start from a label set by `SIGNAL_TOKEN` or by a maintainer, so the check passes for them and they stay closed to other users.
- Opening the first gate is acceptable only while the issue worker stays within its limits: it reads the report as untrusted text, has no shell, uses `min-integrity: none` on the GitHub tool, blocks on threat detection, and can only post two comments, apply `issue-worker-ready` and `related-repo`, and create one linked issue.
- `tools/issue-worker-roles.test.mjs` pins `roles: all` and those limits, and the compile smoke reads the compiled lock files: only `issue-worker` may lack `check_membership`.

## Consequences

- Widening the worker's tools or outputs, or opening another gate, needs a new record.
