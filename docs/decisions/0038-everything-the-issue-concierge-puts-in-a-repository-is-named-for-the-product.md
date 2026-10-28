---
status: proposed
date: 2026-10-28
decision-makers:
  - maintainers
applies-to:
  - scripts/issue-concierge-*.mjs
  - workflows/**
  - shared/**
  - docs/deployment.md
  - docs/updater.md
---

# Everything the Issue Concierge puts in a repository is named for the product

## Context and problem statement

The names grew over three versions. A repository's own files sat in a folder called `agentic-workflows`, the pin file, the pause variable and the token were called just `concierge`, and the prose said "Repo Concierge". More than one kind of concierge may come to share a repository, such as one for issues and one for pull requests. A name that says only "concierge" would then be claimed twice, and one concierge could read or delete what another wrote.

## Decision

- The product is named for its kind: "Issue Concierge" on screen, `issue-concierge` in files, folders and branches, `ISSUE_CONCIERGE_` in variables and secrets, and `issue-concierge:` in hidden markers.
- What a repository holds for it: the pin file `.github/issue-concierge.yml`, written by the updater; the repository's own files in `.github/issue-concierge/` (the scope, the related repositories, the settings, the guard, the complexity and risk definitions, the definition of a complete report); the updater's branch `issue-concierge/update`; the pause variable `ISSUE_CONCIERGE_PAUSED`; and the secret `ISSUE_CONCIERGE_TOKEN`.
- Another kind of concierge uses its own kind in the same places, such as `.github/pr-concierge/`, and none of them reads, writes or deletes what another keeps.
- A rename never needs a person. Every reader looks in the new place first and in the old one second, for the pause either variable pauses, a reader of a hidden marker accepts both spellings, and every writer writes only the new form. The updater moves the pin file and the repository's files in a pull request that a maintainer reviews. The old forms are read until the next major release.
- At the next major release a file left in the old place is an error, not a notice, because a scope or guard file that is ignored switches a protection off without a sign.
- Names inside the code, such as functions and constants, are not part of this.

## Consequences

- This record takes over the folder rule of the record on optional files: a repository tunes the gates with files in the new folder and never by editing the managed ones. Where an older record names the old folder, read the new one. The pause variable of the record on pausing is the new one.
- Records written before this one list paths in `applies-to` that name the scripts and the skill by their old file names. A gate matches records to a change by those paths, so those records no longer match the renamed files until a maintainer corrects the paths or supersedes them.
- A deployment makes no change by hand: its next update moves what is in the old places, and a second run of the updater finishes what the first, built by the updater it already had, could not.
- The repositories that cite the old names in their own files, such as an `AGENTS.md` or a change classifier, update those in their own pull requests.

## Alternatives considered

- A shared `.github/concierge/` for every kind: shorter, but ambiguous the day a second kind arrives.
- Renaming only what a person sees: the folder and the variables are what a second concierge would collide on.
- A flag day with a major release and no fallback: simplest code, and a protection silently switched off in every repository that missed the move.
