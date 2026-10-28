---
status: accepted
date: 2026-10-26
decision-makers:
  - maintainers
applies-to:
  - workflows/route-back.yml
  - scripts/route-back.mjs
  - workflows/issue-worker.md
  - workflows/plan-worker.md
  - docs/multi-phase-design.md
issues:
  - rockcarver/frodo-lib#803
  - rockcarver/frodo-cli#919
---

# The work of a link is routed back by one explicit act

## Context and problem statement

An issue routed to a related repository can belong where it came from: the plan gate may find a wrong layer, or a person may read the code. There was no way back. Plan triage says a maintainer has to move or re-route the issue and nothing does it, removing the link label from the original starts nothing, and the closer leaves a canonical issue closed as not planned to a maintainer. The workers of the two repositories also shared nothing but the report: the finding that made the first worker route the issue was never written down, and the second worker guessed the layer without reading the code.

## Decision

- A maintainer routes the work back by running `Route Back` by hand for the canonical issue. Nothing starts it by itself: moving work to another repository is a maintainer's decision, and the plan gate never lifts its own hold.
- It uses the same proof of the link as the closer, refuses an issue that carries `no-auto-processing`, and writes only in the two issues of the link: the original is held for plan approval, handed to the plan gate of its repository and told in plain language, loses the link label, and the canonical issue gets a comment that names the original and is closed as not planned, last.
- Every step checks first whether it was done, so a run that stopped half way is finished by running it again. The two comments name each other, because the proof ends when the link label is removed.
- Workers hand findings to each other in text, as leads and never as facts. The worker that routes writes a routing note into the canonical issue (the quoted words that name the failing component, what it read, what it did not check). The receiving workers, and the plan worker of a repository an issue was routed back to, read the note and the earlier plan, check the code they name before relying on them, and write a layer line that names no repository they did not read.

## Consequences

- A wrong routing costs one dispatch and two comments, not a hand recipe that depends on knowing the labels.
- The plan worker reads one more file on each side of a routed issue.
- The receiving worker can still be wrong; the plan is still held for a maintainer, who now sees what the first worker found.

## Alternatives considered

- Transferring the canonical issue with GitHub's issue transfer: it leaves two issues for one problem and the link labels and comments point at the wrong one.
- Starting the route back from a label: a new label in every deployment for an act that is rare and deliberate.
- Starting it from the plan gate when it finds a wrong layer: the gate would move work between repositories without a person.
