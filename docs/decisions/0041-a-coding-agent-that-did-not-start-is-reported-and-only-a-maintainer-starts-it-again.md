---
status: accepted
date: 2026-11-02
decision-makers:
  - maintainers
applies-to:
  - workflows/agent-start-watch.yml
  - scripts/agent-start-watch.mjs
  - workflows/commands.yml
  - scripts/commands.mjs
  - scripts/janitor.mjs
  - scripts/issue-concierge-state.mjs
  - scripts/status-issue.mjs
  - workflows/status.yml
  - docs/multi-phase-design.md
issues:
  - rockcarver/frodo-lib#783
  - rockcarver/frodo-lib#754
---

# A coding agent that did not start is reported, and only a maintainer starts it again

## Context and problem statement

Assigning the coding agent is accepted by GitHub before the agent's session has started, and the session can still fail. On 2026-11-02 an approved plan was assigned, the agent opened an empty draft pull request and wrote that it "was unable to start working", and nothing else noticed: the PR worker's run was green, the hand-off label was already gone, no workflow run exists for a session that never started, and a leftover `backlog` label made the status view list the issue as parked. The same happened on 2026-10-23 and the issue stayed assigned without work. A maintainer found it only by opening the issue.

## Decision

- A plain workflow, not a model, reads the coding agent's own comment that it could not start, from the agent's account only, on an open issue that plan triage classified and the agent is still assigned to. It labels the issue `agent-start-failed` with the signal token and does nothing else.
- The label puts the issue under "Needs you" on the status view and gives it an options comment with `/retry`. The Concierge never starts the agent again by itself: a failure can be a misconfiguration, and a loop would leave a draft pull request and a branch behind each attempt.
- `/retry` on such an issue unassigns the agent and stops if it stays assigned, closes the agent's open draft pull requests that have no changed file, deletes their `copilot/` branches in this repository, removes the label and hands the issue to the PR worker. A pull request of the agent with changes is work: the command refuses and touches nothing. Deleting a branch is done by a job that has `contents: write` and nothing else.
- The status view ranks an issue by what is working on it: a queue that waits for a person, then a gate label, then the coding agent, and `backlog` last. A maintainer's approval of a plan, by command or by removing the hold, takes `backlog` off. The coding agent's issues are listed with their pull request, and one with none after a while is marked.
- Nothing that has to show promptly relies on a scheduled run: GitHub starts one when it can. A state a maintainer must see is a label event.

## Consequences

- A failed start shows on the status view and in the issue within seconds of the agent's comment, and a maintainer can recover it with one comment.
- The watch reads GitHub's wording. If GitHub changes it the watch goes silent, and only the "no pull request" mark on the status view remains. The `copilot_work_started` event of a pull request's timeline is a sturdier signal, and a later change may use it.
- `/retry` can close and delete only the empty start of the agent, so a retry never discards work.
- The test of `agent-start-watch.yml` and the status view test keep the condition, the label lists and the order of the ranking in step.
