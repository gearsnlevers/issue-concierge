# Releases

Issue Concierge is consumed by pinned release, never by branch. `main` is work in progress; a release is the point where the maintainers say "this is safe to adopt". Deployments learn about new releases by polling (the harness knows nothing about its deployments) and adopt them through a pull request they merge themselves.

## What a release contains

- A semver **tag** (`v1.2.0`) and a GitHub release. The notes of the release are its body, and they are the changelog: [`CHANGELOG.md`](../CHANGELOG.md) keeps the history up to `v2.4.0` and points to the releases from there on.
- **`release-manifest.json`** attached to the release (built by `tools/build-release-manifest.mjs`):
  - `version`, `tag`, `commit`: the exact commit the release was cut from.
  - `ghAw.version`: the gh-aw version the definitions were compiled and tested with. Deployments compile with the same version, so lock files do not change by accident.
  - `files`: every file a deployment installs (the list in `aw.yml`), each with its SHA-256 digest and size. A deployment verifies what it downloaded against this list.
  - `requires`: the labels, secrets and per-related-repository secrets the release needs (from `requirements.json`).

## Versioning

| Bump | When |
|---|---|
| **patch** | Fixes, wording, prompt adjustments and documentation that need nothing from the deployment. |
| **minor** | New optional workflows or features; new labels or secrets that are optional; behavior that changes what runs but needs no action. |
| **major** | Something a human has to do: a new **required** secret, label or setting, a removed or renamed workflow, a change to the deployment configuration schema. |

Prereleases (`premajor`, `prerelease`) are marked as prereleases on GitHub. Deployments on the default channel ignore them.

**The version comes from the tags.** No release changes `package.json`: it says `2.4.0`, the version of the last release that wrote it, and it stays so. Nothing reads a version from it (the manifest takes the version from the tag); only a repository with no tag at all would start from the version in `package.json`.

## Keeping the pins current

Dependabot cannot see the workflow files the Concierge delivers (they live in `workflows/`, and it only reads `.github/workflows/`) or the gh-aw version in `requirements.json`. A deployment that runs Dependabot then finds the stale pins first and proposes edits to files the Concierge owns, which the next update overwrites. So the Concierge keeps its own pins current: the `Currency check` workflow runs weekly (and by hand), compares them with the latest releases and keeps one open issue listing what is behind; it closes the issue when nothing is. Look at that issue before cutting a release. Moving gh-aw is a release like any other: change `ghAw.version`, run `tools/ci-compile-smoke.sh`, compare the compiled lock files, read the gh-aw release notes.

The Concierge does not configure Dependabot in a deployment and does not require any exclusion: what a deployment does with Dependabot is its maintainers' choice. The update pull request lists an edited managed file under "Local changes this update overwrites"; the compiled lock files are rebuilt from the definitions, so a hand edit there is replaced without being listed.

## Cutting a release

The release workflow (`Actions > Release`) is modeled on the release workflows of the `gearsnlevers/*-action` repositories and uses the same actions. **It writes nothing to the default branch.** No commit, no push of a branch, no file created through the API. Every change to the default branch comes by a pull request, and a bot that pushed a commit there would need a bypass of that rule; this workflow needs none, and none should be given. What it writes to the repository is the tag, and then the release:

- **The tag** is on the commit that the run started from, which is the commit that the manifest names.
- **The notes** are the body of the release, and they are the changelog. `CHANGELOG.md` points to the releases and no release writes to it.
- **The version** comes from the tags. `package.json` keeps its value.
- **The manifest** is the one asset of the release.

The steps, in order:

1. **Require the default branch** for a real release. A dry run may run from any branch.
2. `npm test` and a compile of every workflow definition with the pinned gh-aw (`tools/ci-compile-smoke.sh`).
3. `version-bump-action`: the next version, from the tags and the release type.
4. `release-preflight-action`: the tag does not exist yet, and the version computed from the tags is not behind the latest tag. It does not read `package.json`.
5. **The release notes.** `ai-changelog-action` writes them to `RELEASE_NOTES.md` when the repository secret `LLM_API_KEY` is set; it works on a file of its own (`release-changelog-work.md`) and does not commit. Otherwise GitHub generates the notes (from the previous tag to the commit of the run), and an empty body becomes the line `Release v1.2.0.`.
6. **The files are the files of the commit.** `git diff --quiet HEAD` must find nothing, so that no step has changed a file that the tag will not hold.
7. **Build and verify `release-manifest.json`** for the commit that the run started from.
8. **Tag** that commit with an annotated tag and push the tag and nothing else (a real release only). It first checks that the manifest names the commit that is to be tagged, and it sets the name and the e-mail of the tagger, because no other step does.
9. **Publish the GitHub release** with the manifest attached (a real release only; as a prerelease when the version is one). The release is created as a draft from the tag that exists (`--verify-tag`, so that creating the release never makes a tag), the manifest is attached, and only then is it published, because an immutable release cannot take assets after publication.

`tools/release-workflow.test.mjs` reads the workflow file and states these rules line by line: no commit, no push but the tag, the one permission, the order of the steps, and the guard of the dry run on every write.

The steps around the workflow (what to check on main, how to verify the published release, dispatching the updater in every deployment, inspecting and merging the update pull requests, verifying the default branches) are written as the maintainer-only skill [`cut-an-issue-concierge-release`](../.claude/skills/cut-an-issue-concierge-release/SKILL.md), with read-only scripts for the checks.

**Dry run.** Enable the `dry-run` input to compute everything without tagging or publishing; like a real release, it writes nothing to the repository. The manifest and the notes are uploaded as the `release-dry-run` artifact and the run summary shows the version it would cut. The manifest names the commit that the run started from: from the default branch that is the commit that a real release would tag, from another branch it is the head of that branch.

**First release.**
1. Run it with `release-type: major` and `dry-run` enabled. Check the summary shows `v1.0.0` and read the notes.
2. Optional rehearsal: run `premajor` for real (`v1.0.0-1`, a prerelease). It can still be deleted at this stage.
3. Run `major` without `dry-run`.
4. Then enable immutable releases (below).

**If it fails midway.** A run that stopped before the tag changed nothing in the repository: run it again. A run that stopped after the tag and before the release was published has put the tag there. The version is computed from the tags, so a run again computes the version after it and leaves the tag of the stopped run without a release; a dry run shows the version before it is cut. A draft release left behind by the failed run is deleted and recreated by a run that computes the same version, and a published release is never touched. To make the same release again, a person deletes the tag first; a tag on the wrong commit is deleted by a person before the run is repeated. The `release-tags` ruleset refuses to delete or move a `v*` tag, so removing a tag is the maintainer's to do: lift the rule, delete the tag, and put the rule back. A tag of a published immutable release cannot be moved or reused, so a mistake in one costs a version number.

**Secrets.** None is required. `LLM_API_KEY` (and optionally the repository variables used by `ai-changelog-action`) switches the notes to the AI changelog. The workflow uses the default `GITHUB_TOKEN` with `contents: write`, which writes the tag and the release and nothing else. It needs no token that can bypass a ruleset, and none should be given.

## Immutable releases

Turn on immutable releases for this repository (Settings, General) **after the first real release succeeds**. From then on a published release's tag and assets cannot be changed or deleted, which is what lets deployments pin a tag and a commit and trust them. The cost: a botched release cannot be reused or removed, so a mistake means a new version. That is why it is not enabled before the pipeline has proven itself.

## Adding to a release

- **A new deployable file** (workflow, script or shared template) must be listed in `aw.yml`. The unit tests fail if a file under `workflows/`, `scripts/` or `shared/` is missing from it, and the release build refuses to run.
- **A new label** goes in the label table in `docs/deployment.md` and in `requirements.json`; a test keeps the two identical.
- **A new secret** goes in `requirements.json`.
- **Release tooling** lives in `tools/` and is not deployed.

## Consuming releases

Each deployment pins a release (tag and commit) and checks for newer ones with the Concierge updater, which opens one update pull request per deployment. See [updater.md](updater.md).
