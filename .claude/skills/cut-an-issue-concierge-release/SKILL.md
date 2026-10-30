---
name: cut-an-issue-concierge-release
description: Cut an Issue Concierge release and roll it out to every repository that consumes it. Verify main, run the Release workflow, verify the published release, prove it in the sandbox when the release needs it, dispatch the Issue Concierge updater in each deployment, check the update pull requests, merge them, then verify every default branch. Use when a maintainer asks to release, ship or deploy a new version of the harness, or to check that a rollout went through. Maintainer-only: it publishes an immutable release and merges pull requests.
disable-model-invocation: true
---

**Only run when a maintainer asks. If you are a coding agent without the needed access, stop and say so in the issue or pull request.**

A release is how a gate change reaches the repositories that run the harness. Nothing here is undoable: a published release is immutable (a mistake is fixed forward with a new version) and the update pull requests change every deployment's workflows. Take the steps in order and stop at the first surprise.

Read first: [docs/releases.md](../../../docs/releases.md) (what a release contains, versioning, what to do when the workflow fails midway) and [docs/updater.md](../../../docs/updater.md) (what the update pull request is and what it trusts). The rules this procedure serves are the cross-repository records [the Repo Concierge runs the issue, plan and PR gates](https://github.com/rockcarver/frodo/blob/main/docs/decisions/0004-the-repo-concierge-runs-the-issue-plan-and-pr-gates.md) (gate changes are released, never patched in a deployment) and [a maintainer stays the last lever on agent work](https://github.com/rockcarver/frodo/blob/main/docs/decisions/0002-a-maintainer-stays-the-last-lever-on-agent-work.md) (you never approve a held run, never remove a hold, never merge agent work).

## Before you start

- Get from the maintainer: which merged changes go into the release, the release type, and whether "release" also means "merge the update pull requests". Without a clear yes to the rollout, stop after step 3 and report.
- Release type (table in docs/releases.md): `patch` for fixes, wording, prompt changes; `minor` for new optional workflows or features; `major` when a human must do something (a new required secret or label, a removed or renamed workflow). A change that needs a human action in every deployment is a `major`: ask before choosing anything else.
- Tools: `gh` (recent enough for `gh release verify`), logged in with write access to this repository and to every deployment; Node 20 or newer; the gh-aw version in `requirements.json` for the compile smoke.
- Deployments are not listed anywhere in this repository (the harness knows nothing about its deployments). List them from the pin file each one carries, for every owner that has some:

```bash
for owner in <owner> [<another-owner> ...]; do
  for r in $(gh repo list "$owner" --no-archived --source -L 200 --json nameWithOwner -q '.[].nameWithOwner'); do
    for pin in .github/issue-concierge.yml .github/concierge.yml; do
      gh api -H 'Accept: application/vnd.github.raw+json' "repos/$r/contents/$pin" 2>/dev/null \
        | grep -qE '^source: (gearsnlevers/issue-concierge|vscheuber/repo-concierge)' && { echo "$r"; break; }
    done
  done
done
```

A deployment that has not yet followed the move of the Concierge still names its old home (`vscheuber/repo-concierge`), which redirects, and one that has not had an update by an updater of this naming still keeps its pin in the file `concierge.yml` of the `.github` folder, where the updater moves it to `issue-concierge.yml`; the loop above finds both. Compare the result with the maintainer's list. A deployment missing from one of them is a question to ask, not to settle yourself. GitHub code search does not index these files, so do not rely on it.

## 1. Check main

```bash
git fetch origin --tags && git checkout main && git pull --ff-only
git log --oneline "$(git describe --tags --abbrev=0)"..origin/main   # exactly the changes the maintainer named
gh run list -R gearsnlevers/issue-concierge --branch main -L 3 --json workflowName,conclusion,headSha,status
npm test
XDG_DATA_HOME="$(mktemp -d)" bash tools/ci-compile-smoke.sh
```

- Every change in the log is one the maintainer named, and CI on the head commit is green. An unexpected commit stops the release.
- `XDG_DATA_HOME` points the gh-aw extension install at a scratch directory so your own `gh` setup is untouched. The smoke prints warnings (toolset permissions, new restricted secrets) and still passes; what must not appear is a workflow that failed to compile. It ends with `compiled N workflow definitions with gh-aw <version>`.

## 2. Cut the release

Run the Release workflow from `main`. A dry run first is cheap when anything is unclear; it commits, tags and publishes nothing and shows the version it would cut.

```bash
gh workflow run release.yml -R gearsnlevers/issue-concierge --ref main -f release-type=patch -f dry-run=true   # optional
gh workflow run release.yml -R gearsnlevers/issue-concierge --ref main -f release-type=patch
gh run list -R gearsnlevers/issue-concierge --workflow release.yml -L 1 --json databaseId,status,conclusion
gh run watch <databaseId> -R gearsnlevers/issue-concierge --exit-status
```

- Dispatch it once. Runs are serialized by a concurrency group, and a second dispatch only queues behind the first.
- If a runner step hangs (an `apt-get` install that never ends has happened), cancel that run and run it again once. If it fails twice, stop and report. If it fails midway, read "If it fails midway" in docs/releases.md before touching tags or releases; never delete a published release or move a tag.

## 3. Verify the release

```bash
node .claude/skills/cut-an-issue-concierge-release/scripts/verify-release.mjs vX.Y.Z
```

It changes nothing. It checks that the release is published and immutable, that `gh release verify` and `gh release verify-asset` pass (attestation), that the manifest is for this tag and names the tag's commit, and prints the files the manifest adds, removes and changes compared with the previous stable release.

- Any `FAIL` stops the rollout.
- Read the comparison against the changes the maintainer named. A changed file nobody expected is a surprise to report, not to explain away. A different gh-aw version means every lock file in every deployment changes; that is expected only when the release says so.

If the maintainer did not ask for the rollout, stop here and report the tag, the commit and the comparison.

## 3b. Prove it in the sandbox

[Record 0039](../../../docs/decisions/0039-the-concierge-is-tested-end-to-end-on-demand-in-proportion-to-what-changed.md) says what proof a release needs before any other deployment gets it. Every release: the four sandbox repositories (`gearsnlevers/e2e-lib`, `e2e-app`, `e2e-lib-private`, `e2e-app-private`) are deployments like any other, so they take steps 4 to 7 first, on their own, and the deployment check, the janitor dry run and the status page are clean there. A release that changes how a gate behaves: also the suite on the public pair, and the scenario that exercises the changed behaviour repeated. A release that changes secrets, tokens, permissions or anything that depends on a repository being private: also the private pair. A release that changes nothing a gate reads needs no suite. Say which tier you chose and why.

- Tell the maintainer before a run starts. The runner files its issues under their account, so they get a mail for each comment the Concierge leaves (two to seven per scenario, about fifty for a full suite); a full suite takes about three hours and spends model credits.
- The public pair is free. The private pair uses the organisation's Actions minutes and rests paused: check the budget first (`gh api organizations/gearsnlevers/settings/billing/budgets`, and the usage with `gh api "organizations/gearsnlevers/settings/billing/usage/summary?repository=gearsnlevers/e2e-lib-private"`), delete the pause in both private repositories before the run, and set it again when the run ends, whatever its result.

```bash
gh variable delete ISSUE_CONCIERGE_PAUSED -R gearsnlevers/e2e-lib-private   # and e2e-app-private, only for a run on the private pair
gh variable set ISSUE_CONCIERGE_PAUSED --body true -R gearsnlevers/e2e-lib-private   # and e2e-app-private, after it
```

- Run the pairs the tier calls for, from a checkout of this repository at the release tag, or with the E2E workflow (`gh workflow run e2e.yml -R gearsnlevers/issue-concierge --ref main -f profile=public -f scenario=10`; its `profile` input defaults to `public`). Scenario 10 takes about twenty minutes, so run several samples one after another, not side by side.

```bash
node tools/e2e/run.mjs --yes --profile public --scenario 10 --out s10-1.json   # one sample; repeat
node tools/e2e/run.mjs --yes --profile public --out full.json                  # the suite
```

- Clean means every scenario passed on its first attempt. One that passed only on the second attempt is flaky: read its report and say so. One that failed twice is a result: stop and report. An attempt that ends in `error` because the runner lost its connection to GitHub is the runner's, not the release's, and the retry decides.
- A job annotated "The job was not started because recent account payments have failed or your spending limit needs to be increased" is a billing stop, not a result: stop, do not count that run, and tell the maintainer, who owns the budget.
- Afterwards each sandbox has only its status issue open (`gh issue list -R <repo> --state open`), and the private pair is paused again.

The rollout of the other deployments continues with steps 4 to 7.

## 4. Dispatch the updater in every deployment

```bash
gh workflow run issue-concierge-updater.yml -R <owner/repo>                       # latest release of the pinned channel
gh workflow run issue-concierge-updater.yml -R <owner/repo> -f target=vX.Y.Z      # a specific release
gh run list -R <owner/repo> --workflow issue-concierge-updater.yml -L 1 --json databaseId,status,conclusion
gh pr list -R <owner/repo> --head issue-concierge/update --state open --json number,title,url   # older deployments: --head concierge/update
```

Each deployment gets one pull request titled `chore: update Issue Concierge vA → vB` from the branch `issue-concierge/update` (a deployment whose updater predates the rename still produces `chore: update Repo Concierge vA → vB` from `concierge/update` once more; `compare-update-prs.mjs` accepts both). When the version is already current but files or the pin are still in their old places, the updater opens `chore: move the Issue Concierge's files to their new places` from the same branch, and it closes an old pull request still open from `concierge/update`. The updater rebuilds and force-pushes that branch itself, which is by design; you never push to it.

- No pull request and a log that only reports: the deployment's `ISSUE_CONCIERGE_TOKEN` (called `CONCIERGE_TOKEN` before the rename, which still works) is missing or expired. Tell the maintainer; do not push the update by hand.
- `no stable release of … found, but vX is pinned` is a transient GitHub API problem: run the workflow again once.
- `digest mismatch` means a file at the release commit differs from the manifest. Stop and report; do not work around it.

## 5. Inspect every update pull request

```bash
node .claude/skills/cut-an-issue-concierge-release/scripts/compare-update-prs.mjs <owner/repo>#<N> [<owner/repo>#<N> ...]
```

It changes nothing. It prints each pull request's title, branch and check results, groups the diffs after masking the lines that differ per repository on purpose (gh-aw's frontmatter hash and secret list, git index lines, hunk line numbers), and lists the `permissions:` of every workflow file the update adds.

- Expect one group: the same files in every deployment, namely the pin, the changed gate definitions with their lock files and the changed scripts from the release comparison. A second group, a file that is not in the release comparison, or a title or branch that is not the updater's, stops the rollout.
- A new workflow file brings new token scopes into the repository. Read the permissions it prints and check them against what the release notes say the workflow does.
- Read the "local changes it overwrites" section of each pull request body (`gh pr view <N> -R <owner/repo> --json body -q .body`). A deployment that edited a managed file is a conversation with the maintainer.

## 6. Merge the update pull requests

Only with the maintainer's go for the rollout, and only when every check on every pull request is green.

```bash
gh pr checks <N> -R <owner/repo>
gh pr merge <N> -R <owner/repo> --merge
```

- Merge each one with a merge commit. Do not use `--admin` or any bypass; if branch protection blocks, stop and report.
- A check that hangs for many minutes (the same flaky runner step as in step 2): cancel that run and re-run it once (`gh run cancel`, `gh run rerun`). If it fails again, stop.
- Never approve or delete a held run, and never remove a hold, during a rollout. Held runs belong to the maintainer. Update pull requests opened with the deployment's own token run their checks normally.

## 7. Verify every default branch

```bash
node .claude/skills/cut-an-issue-concierge-release/scripts/verify-rollout.mjs vX.Y.Z <owner/repo> [<owner/repo> ...]
```

It changes nothing. For each deployment it checks the pin (tag and commit), that every file the manifest installs is there and byte-identical (files with a cross-repository marker are compared without the generated token lines), that files this release dropped are gone, that every lock file was compiled with the manifest's gh-aw version, and that the role gate holds (`issue-worker` has no membership check, every other gate keeps the default roles; see "Who can start a gate" in docs/deployment.md).

Then check what this particular release changed, which no generic script can know. Take each changed behaviour in the comparison from step 3 and read it where it takes effect in a deployment. Examples that earlier releases needed:

```bash
# a budget
gh api -H 'Accept: application/vnd.github.raw+json' repos/<owner/repo>/contents/.github/workflows/pr-triage.md | grep -m1 '^max-ai-credits:'
# a condition that has to survive compilation
gh api -H 'Accept: application/vnd.github.raw+json' repos/<owner/repo>/contents/.github/workflows/pr-worker.lock.yml | grep -c existing_fix_result
```

Read the compiled lock, not the source: a setting that does not take effect shows only there. State in your report which of these you checked and which behaviour you could not observe (for example a gate that has not met a real case yet).

## 8. Smoke the plain workflows

The janitor and the deployment check change nothing when told to report only:

```bash
gh workflow run janitor.yml -R <owner/repo> -f dry_run=true
gh workflow run check-deployment.yml -R <owner/repo>
gh run list -R <owner/repo> --workflow janitor.yml -L 1 --json databaseId,status,conclusion
```

Expect green runs. `check-deployment` ends with `0 error(s), 0 warning(s)` and may print notices (no `AGENTS.md`, no decision records) that are not failures. A janitor dry run that reports held runs it would delete lists them; it deletes nothing.

## Report

Give the maintainer: the tag and commit; the verification result of step 3 and the release comparison in one line; the proof you ran (tier, runs, clean or not); the update pull requests (number, check state, merged or not); the result of step 7; and what you did not verify. Keep claims to what you saw. Do not say a gate behaves differently live until a real case has run through it.

## Pitfalls

- GitHub caps label descriptions at 100 characters; a longer one made an update fail in every deployment. The manifest builder and the tests check it, so a failure there is real.
- A release created from a branch other than `main` is refused for real runs; use the dry run for other branches.
- The updater runs daily by itself, so a deployment may already have the update pull request when you arrive. Inspect and merge that one; do not open another.
- Merging an update pull request is not releasing anything: the release already exists. Releasing is never triggered by a merge.
- A release that adds a setting the updater generates (a new `# concierge:cross-repo...` marker; the updater reads `# issue-concierge:cross-repo...` as the same marker, and the delivered files keep the older spelling until every deployment reads both) reaches a deployment one release late: the update is made by the updater it already has. Dispatch the updater a second time with `-f target=<the tag>` after merging the first pull request, merge the second, and only then verify the rollout. The rename of the pin file and of the folder of a repository's own files works the same way: the first update is made by the updater the deployment already has, which leaves them where they were, and the next run of the new updater (the daily one, or a dispatch) opens `chore: move the Issue Concierge's files to their new places`. Nothing is asked of the deployment; merge it, and `verify-rollout.mjs` stops saying that the pin is in its old place.
- Do not edit managed files in a deployment to "fix" an update. Fix the harness, release again.
