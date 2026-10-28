---
status: accepted
date: 2026-10-27
decision-makers:
  - maintainers
applies-to:
  - workflows/issue-worker.md
  - workflows/issue-triage.md
  - workflows/plan-worker.md
  - workflows/plan-triage.md
  - workflows/pr-worker.md
  - workflows/pr-triage.md
  - workflows/release-closer.md
  - workflows/janitor.yml
  - workflows/dependency-watch.yml
  - workflows/plan-approval-resume.yml
  - workflows/pr-ready-signal.yml
  - workflows/related-repo-closer.yml
  - workflows/reporter-notify.yml
  - workflows/waiting-for-release.yml
  - workflows/stalled-issue-sweep.yml
  - docs/multi-phase-design.md
---

# The Concierge is paused by a repository variable

## Context and problem statement

When a model misbehaves, a cost climbs or a maintainer wants to work on a set of issues undisturbed, the Concierge has to be stopped in that repository, quickly, by someone who is not the person who set it up. The levers that exist are blunt (disable Actions for the repository, which stops the CI too) or many (disable twelve workflows one by one). A stop that has to be read from another issue, a file or a comment cannot be checked before a run starts.

## Decision

- The repository variable `CONCIERGE_PAUSED`, with the value `true`, pauses the Concierge in that repository. Deleting it, or setting it to anything else, resumes it.
- Every gate and every workflow that acts on an issue or a pull request reads the variable in its own `if:`, so that a paused run is skipped before it starts: no runner, no model, no credits. The two gates with a deterministic step before the agent that writes read it in that step as well.
- A run started by hand (`workflow_dispatch`) still works: it is a maintainer's override. Runs already in flight finish.
- Not paused: the status issue (it shows that the Concierge is paused, and since when), the commands (those that would hand an issue on are refused with a reply, because no gate would start; declining and listing still work), the updater and the deployment check.
- Nothing is replayed on resume. A gate label that was applied meanwhile started nothing; the stalled-issue sweep heals an analysed issue, and `/retry` gives any gate label again.
- A new workflow must read the variable or be listed as not paused, with the reason; a test refuses a workflow that does neither.

## Consequences

- Editing a repository variable needs write access in an organisation repository and collaborator access in a personal one, so the people who maintain the repository can pause it without being administrators.
- The pause is per repository. Pausing several repositories means setting the variable in each (or as an organisation variable shared with them, which a workflow reads the same way).
- An issue that was in a gate when the Concierge was paused may sit there after it resumes until someone gives `/retry` or the sweep reaches it.

## Alternatives considered

- A label on the status issue: the most natural click, but an `if:` cannot read another issue, so every gate would need a job to look it up, on every event.
- A file in the repository: it needs a commit, which is slow for an emergency, and an `if:` cannot read a file.
- Disabling workflows in the Actions tab: native, but twelve clicks, and a disabled workflow is easy to forget.
- A `/pause` command: it would need a token that can write variables, which the tokens do not have today. The command may follow when they do.
