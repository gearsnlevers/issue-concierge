# The Issue Concierge updater

The updater keeps a deployment on a released version of Issue Concierge. It is the only way a deployment learns about a release: the harness knows nothing about its deployments, so deployments watch the harness.

## What it does

A plain Actions workflow (`issue-concierge-updater.yml`, no LLM) runs daily and on demand:

1. Reads `.github/issue-concierge.yml`, the deployment's pin (source repository, version, commit, channel). A deployment whose pin is still in its old place, `.github/concierge.yml`, is read from there.
2. Asks the source repository for its latest release on the pinned channel (`stable` ignores prereleases). Nothing newer: done.
3. Downloads the release's `release-manifest.json` and checks it: the manifest is for that tag and names the tag's commit. Then it downloads every installed file **at that commit** and verifies its SHA-256 digest against the manifest. Any mismatch aborts the run before anything is written.
4. Builds the desired state: definitions, plain workflows and scripts at their destinations, the cross-repository settings generated from `related-repos.md` (below), the new pin.
5. Compiles the definitions with the gh-aw version the manifest names (and only for that version), so lock files change only when a release says they should.
6. Creates any label the release needs that is missing. It never changes an existing label.
7. Rebuilds the branch `issue-concierge/update` from the default branch, commits, force-pushes it, and opens or updates **one** pull request titled `chore: update Issue Concierge v1.0.0 → v1.1.0`.

The branch is rebuilt from scratch every run and is never merged into. That is why lock-file conflicts between update pull requests cannot happen: a pull request that waited for a week simply contains everything since the last merge. Merge it (squash is fine) or close it; the next run rebuilds it.

The pull request body has the release notes, the files added, changed and removed, the labels created, the secrets the release needs (the updater cannot see secrets, so it lists them), and **local changes it overwrites**: managed files that differ from what the pinned release installs.

## What is managed

Everything the manifest installs: the gh-aw definitions (`.github/workflows/*.md` with their `.lock.yml`), the plain workflows and the scripts. Do not edit these files in a deployment; the next update reverts the edit and says so in the pull request. Reference material (`shared/`, `docs/`) is not installed.

To customize, use the places that are yours: `.github/issue-concierge/` (complexity, risk and completeness definitions, `related-repos.md`) and `.github/issue-concierge.yml` (`channel`).

**When the Concierge moves.** The pin's `source:` names the repository the updater reads. The Concierge moved from `vscheuber/repo-concierge` to `gearsnlevers/issue-concierge` (transferred, then renamed). GitHub redirects a transferred and renamed repository by its identity, for the API, git and the web, so a deployment that still names the old source keeps working: its updater reads releases, tags and files through the redirect. Change the `source:` line by hand once, in a pull request that touches that line only; the version, the commit and the channel stay as they are, and the updater reads the new source from then on. Never create a repository at the old name: that ends the redirect.

## Names that changed, and how the updater moves them

The product is named for its kind, Issue Concierge, because more than one kind of concierge may share a repository. A deployment that was set up under the earlier names keeps working, and **nothing is asked of its maintainers**. The updater does the moving, in the pull request you already review:

| Was | Is | How it moves |
| --- | -- | ------------ |
| `.github/concierge.yml` | `.github/issue-concierge.yml` | the pin is written in the new place and the old file is removed |
| `.github/agentic-workflows/` (`scope.md`, `related-repos.md`, `settings.yml` and the other optional files) | `.github/issue-concierge/` | each file is moved with its content unchanged |
| the secret `CONCIERGE_TOKEN` | `ISSUE_CONCIERGE_TOKEN` | the workflow uses the new secret and falls back to the old one; create the new one when it suits you, no run stops meanwhile |
| the pinned issue "Concierge status" | "Issue Concierge status" | the status workflow finds the issue by its marker (either spelling) or by the old title, renames it and rewrites it; there is never a second one |
| the hidden lines of the Concierge's own comments (`<!-- concierge:options`, `:status`, `:mention`, `:accepted`, `:resolution`) | the same with `issue-concierge:` in front | new comments are written with the new lines; **every reader accepts both**, because the comments an earlier version wrote stay in the issues (an options menu is rewritten with the new line at its next edit) |
| the branch `concierge/update`, titled `chore: update Repo Concierge ...` | `issue-concierge/update`, titled `chore: update Issue Concierge ...` | a pull request still open from the old branch is closed with a comment that points to the new one, and the old branch is deleted |

The move happens in the first update pull request that the new updater makes. The update that first installs the new updater is made by the updater the deployment already has, which leaves the old places alone, so the next run (the daily one, or a dispatch) opens one more pull request, titled `chore: move the Issue Concierge's files to their new places`, with the version unchanged. It only moves files; merge it.

Until the files are moved, the gates and scripts read the old places, so nothing is switched off in between. A file that exists in both places is left alone: the new one is read, the old one is ignored, and the pull request lists it as a warning so that a person can delete it. The old places are read until the next major release.

## Cross-repository settings come from `related-repos.md`

Two workflows write to another repository: the issue worker (`create-issue`) and the related-repo closer.

The issue worker is a gh-aw definition. A safe output can only write to another repository when it has both a `github-token` and an `allowed-repos` list. In the harness the place carries a `# concierge:cross-repo` marker (the updater also accepts `# issue-concierge:cross-repo`; see the note after the closer's marker below). The updater replaces it with

```yaml
github-token: ${{ secrets.<secret> }}
allowed-repos: ["<owner/repo>"]
```

The closer is a plain workflow, so it takes the same two facts as the environment of its step. Its marker is `# concierge:cross-repo-env`, and the updater replaces it with

```yaml
CROSS_REPO: <owner/repo>
CROSS_REPO_TOKEN: ${{ secrets.<secret> }}
```

Both come from the related repository in `related-repos.md` that names a `secret`, and a marker is removed when there is none. One related repository with a secret is supported (a safe output takes one token); two is an error. `check-deployment` verifies the compiled result of the first and the generated lines of the second.

**The two spellings.** The updater accepts both `# concierge:cross-repo` and `# issue-concierge:cross-repo` (and the `-env` pair), and treats a file with the older marker exactly as one with the newer, so comparing a deployment with the previous release's files shows no false local changes. The workflow files the Concierge delivers keep the older spelling for now, for the reason in the next paragraph: an update is made by the updater the deployment already has, and one that does not know the newer spelling would leave the line in the file and write no `CROSS_REPO`. The delivered files take the newer spelling in the release after every deployment can read both.

A marker takes effect one release late. The update that first installs a marker is made by the updater the deployment already has, the previous release's, which does not know it: the file arrives with the marker line left in and nothing generated, and `check-deployment` says so as a warning. Run the updater once more with the pinned release as the target (`gh workflow run issue-concierge-updater.yml -f target=vX.Y.Z`): the updater that the first update installed writes the lines, in a second pull request. A deployment without a related repository needs no second run, and its marker line is only a comment until the next update removes it.

## Setting it up

**The token.** The updater needs one repository secret, `ISSUE_CONCIERGE_TOKEN` (it was called `CONCIERGE_TOKEN`, and a repository that still has the old name keeps working): a fine-grained personal access token limited to **this repository** with Contents, Pull requests and Workflows write. Workflows write is required because the update changes files under `.github/workflows/`, which the default token cannot push. A pull request opened with the default token would also not run its checks. Without the secret the updater runs as a dry run and only reports. Fine-grained tokens expire; put the expiry in your calendar.

**Your CI.** Every update pull request changes `.github/issue-concierge.yml` (the pin) and sometimes `.github/aw/actions-lock.json` (when the gh-aw version moves), besides the workflow definitions, their lock files and the scripts. If your code pipeline skips its tests for pull requests that touch no code, put `.github/issue-concierge.yml` and `.github/aw/` on its non-code list next to `.github/workflows/` and `.github/scripts/`; otherwise each update runs the full test matrix. Keep the match exact (`concierge\.yml$`, not a prefix) so a stray file next to them still counts as code.

**First adoption** (once per deployment, by hand):

```bash
export GH_TOKEN="$(gh auth token)"   # the updater reads GitHub unauthenticated (60 requests/hour) without one
TAG="$(gh release list -R gearsnlevers/issue-concierge --exclude-pre-releases -L 1 --json tagName -q '.[0].tagName')"   # or the release you want to adopt
git checkout -b issue-concierge/first-adoption
mkdir -p .github/scripts
for f in issue-concierge-updater issue-concierge-paths dependency-watch opt-out; do
  gh api "repos/gearsnlevers/issue-concierge/contents/scripts/$f.mjs?ref=$TAG" --jq .content | base64 -d > ".github/scripts/$f.mjs"
done
node .github/scripts/issue-concierge-updater.mjs --local --source gearsnlevers/issue-concierge --target "$TAG"
git add -A .github .gitattributes && git commit -m "chore: adopt Issue Concierge $TAG" && git push -u origin HEAD
```

`--local` writes the verified files and the pin and compiles, without touching git; it makes a few dozen API calls per deployment, which is why the token is exported first (a run without one stops with `API rate limit exceeded` partway through); the bootstrap copies above are replaced by the verified ones. Open the pull request, check the diff (the first one shows every difference between the hand-installed files and the release), then add the `CONCIERGE_TOKEN` secret. From then on updates arrive as pull requests.

## Commands

```
node .github/scripts/issue-concierge-updater.mjs                  update to the latest release of the pinned channel
node .github/scripts/issue-concierge-updater.mjs --dry-run        show what would change, change nothing
node .github/scripts/issue-concierge-updater.mjs --target v1.2.0  a specific release; the pinned one repairs drift
node .github/scripts/issue-concierge-updater.mjs --local          write the working tree and compile; no branch, push or pull request
```

In Actions the workflow is **Concierge 4e ▸ Updater**; `workflow_dispatch` takes `target` and `dry-run`.

## What it trusts

Only a release's tag, its manifest and the files at the tag's commit, checked against the manifest's digests. It downloads data and never runs it; the only thing it executes is the pinned gh-aw CLI, to compile. Turn on immutable releases for the harness repository so a published tag and manifest cannot be changed. A compromised release would still need you to merge the pull request, which shows every changed definition and script.

## Troubleshooting

- **"digest mismatch"**: a file at the release commit differs from the manifest. Do not work around it; report it to the harness maintainers.
- **"supports one" related repository**: `related-repos.md` lists more than one repository with a secret. Remove or merge until one remains.
- **Lock files change in every definition**: the release moved to a different gh-aw version; the pull request says so. That is expected for such releases.
- **The pull request has no checks**: the branch was pushed with a token that cannot trigger them. Use `ISSUE_CONCIERGE_TOKEN`.
- **"no stable release of … found, but vX is pinned"**: the run failed on purpose. The release list came back empty or without a usable release, which cannot be right for a pinned deployment. It is usually a transient GitHub API problem; run the workflow again. If it persists, the pinned release was deleted or the channel in `.github/concierge.yml` does not match any release.
- **The full test suite runs on every update pull request**: the deployment's code pipeline does not know `.github/issue-concierge.yml` and `.github/aw/` are non-code. See "Your CI" under Setting it up.
