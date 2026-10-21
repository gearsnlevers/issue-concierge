# Dependencies

Reference for the dependency gate. The triage workflow detects declarations. The watcher (`workflows/dependency-watch.yml` with `scripts/dependency-watch.mjs`) resolves them. No LLM resolves a dependency.

## Declaring a dependency

A dependency counts only when the issue body or any comment has a line that starts with one of:

- `Depends on:`
- `Blocked by:`
- `Requires:`

followed by one or more references. A reference is `#N`, `owner/repo#N`, or a full GitHub issue or pull request URL.

These are **not** dependencies: `Fixes`, `Closes`, `Resolves`, `Reported from`, and any reference in ordinary prose. Dependencies are never inferred from free text.

## Who does what

Nothing here needs a maintainer in the normal case. Both labels are set automatically.

| Step | Done by |
|------|---------|
| Notice the `Depends on:` line and add `dependency-required` | Issue triage (an agent) |
| Check whether the dependencies are finished | The watcher (plain Actions, no LLM), hourly, on demand, and when the label is added |
| Post and update the status comment | The watcher |
| Add `dependency-satisfied`, remove `dependency-required`, restart triage | The watcher |
| Hand off to planning once the gate is cleared | Issue triage |

Issue triage cannot check the registry or the pin (it has no shell or network access), so it never decides whether a dependency is finished. It only detects the declaration and sees `dependency-satisfied` as the signal that the watcher has cleared it.

Maintainers only step in for the cases under "Needs a maintainer", or to skip the gate on purpose by adding `dependency-satisfied` by hand. That is an override, not part of the normal flow.

## Labels

| Label | Meaning |
|-------|---------|
| `dependency-required` | Gate. The issue waits for its dependencies. Added by issue triage; removed by the watcher. |
| `dependency-satisfied` | Added by the watcher when every dependency is finished. Issue triage lets an issue with this label through. A maintainer can add it by hand to skip the gate. |

## Resolution rules

A dependency's required state depends on where it lives.

1. **Same repository.**
   - A pull request is satisfied when merged.
   - An issue is satisfied when closed as completed.
2. **A related repository whose entry in `.github/agentic-workflows/related-repos.md` has `release.requires_consumer_release: true`** (for example a CLI issue that depends on a library issue or pull request). Merged or closed is not enough. All four must hold, checked in this order:
   1. **Merged.** The pull request is merged. For an issue, the change that closed it is found from the `closed` event or a merged cross-referenced pull request. An issue closed as completed with no linkable change needs a maintainer.
   2. **Released.** A release of the related repository contains the merge commit. Prereleases count. The oldest such release is used.
   3. **Installable.** The package named by `release.pins` is resolvable on the npm registry at that release's version. A GitHub release alone is not enough, because publishing lags it.
   4. **Pinned.** This repository's `package.json` pins that package at that version or later. Versions are compared with semver precedence, never as strings (`5.0.0-10` is newer than `5.0.0-9`). A range such as `^5.0.0-9` cannot be judged; it needs a maintainer.
3. **A related repository without `requires_consumer_release`.** Same as case 1.

With several dependencies, all must be satisfied.

"Satisfied" means the dependent work can start. It does not mean the dependent issue is done; that is the existing `waiting-for-release` flow.

## Needs a maintainer

The watcher never resumes these on its own. It keeps the gate closed and says so in its comment.

- A pull request closed without merging, or an issue closed as not planned.
- An issue closed as completed with no linkable change.
- A pin it cannot compare (a range or a non-semver value).
- Two issues that depend on each other.

## What the watcher does

Runs hourly, on demand, and when `dependency-required` is added to an issue.

1. For each open issue labeled `dependency-required`, resolve every declared dependency.
2. If all are satisfied: add `dependency-satisfied`, remove `dependency-required`, then remove and re-add `issue-worker-ready` with `SIGNAL_TOKEN`. Re-adding the label starts issue triage again; re-adding a label that is already present would not.
3. Otherwise keep the label and keep one plain-language status comment up to date. The comment carries a hidden marker so it is edited in place, never repeated.
4. A failed lookup (API, registry, network) changes nothing. The issue is retried on the next run.

Cross-repository dependencies are found by polling, because a workflow cannot subscribe to events in another repository. The hourly interval is enough: registry publishing alone lags a release by about half an hour.

## Edge cases

- A reference that cannot be read (private, deleted, mistyped) is unsatisfied, and the comment says so.
- A self-reference is ignored. A direct cycle (A depends on B and B depends on A) needs a maintainer. Longer cycles are not detected.
- Issues labeled `related-repo` are non-canonical pointers and are never gated.
- Read access to private related repositories needs a token with that access in place of `github.token`.
- Dependencies added to an issue after `dependency-satisfied` was applied are not gated. Remove the label to re-arm the gate.
