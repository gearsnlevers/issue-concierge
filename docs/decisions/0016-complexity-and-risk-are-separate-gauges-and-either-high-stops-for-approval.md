---
status: accepted
date: 2026-10-25
decision-makers:
  - maintainers
applies-to:
  - workflows/plan-triage.md
  - workflows/pr-triage.md
  - shared/complexity.md
  - shared/risk.md
issues:
  - rockcarver/frodo-lib#783
---

# Complexity and risk are separate gauges, and either one at high stops for approval

## Context and problem statement

One combined label answers two questions at once: how much design judgment a change needs (so how much autonomy an agent gets) and how much damage a wrong change does (its blast radius). They move independently: a one-line change to authentication is simple and risky. In a label-driven pipeline the classification is also the real power, because enforcement only carries out what the label says, so a wrong label enforces the wrong policy. Recorded retroactively from the founding design discussion and the plan and PR gates.

## Decision

- Two independent label sets, `complexity/low|medium|high` and `risk/low|medium|high`, separately controllable. There is no combined label.
- Plan triage sets both from the plan, because only a plan makes claims that can be judged (files touched, public API, authentication, size). The issue gate never sets them.
- High complexity, high risk or both adds `plan-approval-required` and no hand-off, and the comment names the gauge ([0005](0005-a-maintainer-holds-the-levers-of-the-pipeline.md)). Risk counts on its own because of frodo-lib#783: complexity low, risk high, handed to the coding agent on a plan whose cause was still a hypothesis.
- PR triage sets both again from what the pull request changed, such as paths in authentication, security, migrations or the public API. A diff is evidence; a plan is a forecast.
- The meaning of the levels is a repository's to tune. `shared/complexity.md` and `shared/risk.md` are the defaults; `.github/agentic-workflows/complexity.md` and `risk.md` replace them, with thresholds by path or size where a repository wants them ([0023](0023-a-repository-tunes-the-gates-with-optional-files-never-by-editing-them.md)).

## Consequences

- The definitions are qualitative. How many files, or which paths, mean which level is left to the model unless a repository writes it down. Tuning the gauges means editing those two files, not the gates.
- A label never merges anything. The stops wait for a person and the merge stays a maintainer's.

## Alternatives considered

- One label for both (the first build): rejected, the two answer different questions.
- Complexity and risk at the issue gate: rejected. With no plan, the model invents a fix in its head and classifies the invention.
- Deterministic floors by path or size at the plan gate, so that the model is not the only judge: proposed, not built. Only the PR triage prompt names risky paths.
