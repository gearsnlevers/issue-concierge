# Releases

Repo Concierge is consumed by pinned release, never by branch. `main` is work in progress; a release is the point where the maintainers say "this is safe to adopt". Deployments learn about new releases by polling (the harness knows nothing about its deployments) and adopt them through a pull request they merge themselves.

## What a release contains

- A semver **tag** (`v1.2.0`) and a GitHub release with notes.
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

## Cutting a release

The release workflow (`Actions > Release`) is modeled on the release workflows of the `vscheuber/*-action` repositories and uses the same actions:

1. `npm test` and a compile of every workflow definition with the pinned gh-aw (`tools/ci-compile-smoke.sh`).
2. `version-bump-action`: next version from the release type. With no tags yet it bootstraps from `package.json` (`0.0.0`): `major` gives `v1.0.0`, `premajor` gives `v1.0.0-1`.
3. `release-preflight-action`: the tag does not exist yet, the version does not drift.
4. `manifest-version-update-action`: writes the version into `package.json`.
5. Release notes and `CHANGELOG.md`: `ai-changelog-action` when the repository secret `LLM_API_KEY` is set, otherwise GitHub's generated release notes.
6. Commit `CHANGELOG.md` and `package.json`, build and verify `release-manifest.json` for that commit, create the annotated tag, publish the GitHub release with the manifest attached (as a prerelease when the version is one). The release is created as a draft, the manifest is uploaded, and only then is it published, because an immutable release cannot take assets after publication.

The steps around the workflow (what to check on main, how to verify the published release, dispatching the updater in every deployment, inspecting and merging the update pull requests, verifying the default branches) are written as the maintainer-only skill [`cut-a-concierge-release`](../.claude/skills/cut-a-concierge-release/SKILL.md), with read-only scripts for the checks.

**Dry run.** Enable the `dry-run` input to compute everything without committing, tagging or publishing. The manifest, notes and changelog are uploaded as the `release-dry-run` artifact and the run summary shows the version it would cut.

**First release.**
1. Run it with `release-type: major` and `dry-run` enabled. Check the summary shows `v1.0.0` and read the notes.
2. Optional rehearsal: run `premajor` for real (`v1.0.0-1`, a prerelease). It can still be deleted at this stage.
3. Run `major` without `dry-run`.
4. Then enable immutable releases (below).

**If it fails midway.** The tag step is idempotent for the same commit and refuses to move an existing tag. If the commit was pushed but the release was not published, run the workflow again with the same release type after deleting the tag if it was created on the wrong commit; the version is recomputed from the tags. A draft release left behind by the failed run is deleted and recreated; a published release is never touched.

**Secrets.** None is required. `LLM_API_KEY` (and optionally the repository variables used by `ai-changelog-action`) switches the notes to the AI changelog. The workflow uses the default `GITHUB_TOKEN`; if `main` ever gets branch protection that blocks the changelog commit, give the workflow a token that can bypass it, as the Frodo release pipelines do.

## Immutable releases

Turn on immutable releases for this repository (Settings, General) **after the first real release succeeds**. From then on a published release's tag and assets cannot be changed or deleted, which is what lets deployments pin a tag and a commit and trust them. The cost: a botched release cannot be reused or removed, so a mistake means a new version. That is why it is not enabled before the pipeline has proven itself.

## Adding to a release

- **A new deployable file** (workflow, script or shared template) must be listed in `aw.yml`. The unit tests fail if a file under `workflows/`, `scripts/` or `shared/` is missing from it, and the release build refuses to run.
- **A new label** goes in the label table in `docs/deployment.md` and in `requirements.json`; a test keeps the two identical.
- **A new secret** goes in `requirements.json`.
- **Release tooling** lives in `tools/` and is not deployed.

## Consuming releases

Each deployment pins a release (tag and commit) and checks for newer ones with the Concierge updater, which opens one update pull request per deployment. See [updater.md](updater.md).
