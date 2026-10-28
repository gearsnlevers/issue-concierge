<!--
Template and guide for decision records in the CONSUMING repository, under `docs/decisions/` (not under
.github/issue-concierge/). One file per decision: `docs/decisions/NNNN-short-title.md`, numbered in order, plus an
index `docs/decisions/README.md`. If the repository's `docs/` is generated output that gets rewritten, use `decisions/`
at the repository root instead (same file names, index `decisions/README.md`). The gates use the first of the two
folders that has a `README.md` and never both. Delete this comment before you commit a record.

The Concierge's plan and PR gates read the records from the default branch: the plan worker lists the ones that apply
to a request (and says when the request conflicts with one), PR triage flags a change that does the opposite of an
accepted record. Nothing else needs wiring. See docs/multi-phase-design.md, "Decision records".
-->
---
status: proposed
date: YYYY-MM-DD
decision-makers: <names or roles who decided>
applies-to:
  - <path glob the decision binds, for example src/utils/interactive/RealmPickers.ts; leave the whole key out for a repository-wide decision>
issues:
  - <issue or pull request numbers or links this came from, optional>
---

# NNNN: <short title in the form of the decision, for example "The realm picker stays and opens only when other mandatory connection settings are missing">

## Context and problem statement

<The situation and the forces at work, in two to six sentences. Write for someone who was not there: say what the code
did before, what went wrong or was unclear, and why it had to be decided.>

## Decision

<What was decided, as plain statements an implementer can check a change against. Name the behaviour, not the tool that
was used to discuss it.>

## Consequences

<What becomes easier, what becomes harder, what must now be true of new code, and what is deliberately not decided.>

## Alternatives considered

<Optional. Each alternative in one or two lines, with the reason it was not chosen.>

<!--
Guide

When to write one: a decision whose effect lasts and that a newcomer, human or agent, could undo without knowing it:
behaviour users rely on, a structure or layering rule, a process rule, a rule about what must never happen. Not for routine
refactors, bug fixes or choices that the code makes obvious.

Status: `proposed` while it is discussed, `accepted` when it binds, `rejected` or `deprecated` when it no longer does,
`superseded by NNNN` when a newer record replaces it. Only `accepted` records bind; the gates ignore the others.

Accepted records are not edited. To change a decision, write a new record that says what it replaces, and change only the
`status:` line of the old one to `superseded by NNNN`. A pull request that changes a decided behaviour must add or
supersede a record in the same change, so that review sees both.

Scope: `applies-to:` lists the paths the decision binds, so a gate reads it only when a change touches them. Leave it out
for a repository-wide decision. A decision that binds several repositories is written once, in the repository the others
list in their `AGENTS.md`, with a `repos:` list in its frontmatter; each repository's `AGENTS.md` names the ones that bind it.

Language: write for any contributor and any tool. No tool names, no "as discussed in the session", no instructions to a
particular assistant. State the decision and why.

No secrets: records are public wherever the repository is. No credentials, tokens, private URLs, customer or partner
details, or security findings that have not been disclosed. Keep those out of the record and refer to them as "a
private note" if the decision depends on them.

The index `docs/decisions/README.md` (or `decisions/README.md` at the repository root when `docs/` is generated) is a table with the number, the title (linked), the status and `applies-to`, one row
per record, newest last, kept in step by the pull request that adds the record.
-->
