---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/*.md
  - shared/safety-policy.md
  - docs/deployment.md
---

# Agents are read-only, and threat detection runs where untrusted text meets a write

## Context and problem statement

Gates read issue bodies, comments and pull requests that anyone can write. Prompt injection is an open problem, so the design cannot count on a model refusing. It limits what a model that has been fooled can do. Recorded retroactively from the founding design discussion and the workflow frontmatter.

## Decision

- Agent jobs hold read permissions only. Every write, a comment, a label, creating or closing an issue, goes through gh-aw's safe outputs, which apply it in a separate job with a maximum count and, for labels, an allow-list. gh-aw's strict mode refuses a workflow that declares write permissions.
- Gates that read issue text have no shell (`bash: false`, `cli-proxy: false`).
- Threat detection, a second model pass over what the agent asked to publish, runs before any output is applied and blocks on a finding. It is on for the issue worker, which reads the raw report and can comment, label and open an issue in another repository, and for PR triage, which reads a pull request that an agent wrote. It is off for the other gates, which classify a comment our own worker wrote or write from structured data, and cannot exceed their allow-lists.
- A new gate that reads untrusted text and writes turns detection on, or a record says why not.

## Consequences

- Detection costs about a minute and a model call per run, which is why it stays on two gates.
- It sees only what the agent asked to publish, not what the agent did during the run. Our gates write no code, so its patch check rarely applies. It is a second opinion on top of the allow-lists, not a guarantee.
- The issue worker is open to every reporter ([0007](0007-only-the-issue-worker-is-open-to-every-reporter.md)), which is why it keeps every layer above.

## Alternatives considered

- Detection on every gate: rejected. It adds a minute and a model call to gates that cannot exceed a fixed list of labels.
- Detection nowhere: rejected. The issue worker's input is public.
