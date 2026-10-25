# repo-concierge: instructions for coding agents

Repo Concierge is an issue-to-release harness for GitHub, built on GitHub Agentic Workflows (`gh-aw`): gated triage, planning and tiered fixing, dependency gating and release tracking. Repositories ("deployments") pin a released version and an updater workflow keeps them on it. This repository holds the sources of the gates, the plain workflows and scripts that support them, the release pipeline and its tests. Read [README.md](README.md) first, then [docs/multi-phase-design.md](docs/multi-phase-design.md) (the gates, labels and the incidents behind each rule).

## Layout

- `workflows/`: the sources a deployment installs. `*.md` are gh-aw definitions (frontmatter, then the prompt); `*.yml` are plain workflows. **This repository holds no lock files**: a deployment compiles the definitions itself, with the gh-aw version in `requirements.json`.
- `scripts/`: Node scripts behind the plain workflows (`concierge-updater`, `janitor`, `dependency-watch`, ...), each with its test beside it. `shared/`: prompt fragments the gates read.
- `aw.yml`: the list of files a deployment installs. `requirements.json`: the labels and secrets a release needs, and the gh-aw version.
- `tools/`: tests for the workflows and prompts, `build-release-manifest.mjs`, `ci-compile-smoke.sh`, `check-currency.mjs`, `validate-decision-records.mjs`.
- `.github/workflows/`: this repository's own `ci.yml`, `release.yml` and `currency-check.yml`. They are not delivered to deployments.
- `docs/`: `deployment.md` and `multi-phase-design.md` are delivered; `releases.md`, `updater.md` and `decisions/` are not.

## Checks

- `npm test` runs every `scripts/*.test.mjs` and `tools/*.test.mjs` (`node:test`, no dependencies).
- `XDG_DATA_HOME="$(mktemp -d)" bash tools/ci-compile-smoke.sh` compiles every definition with the pinned gh-aw. It needs `gh` and the network, prints warnings and still passes; a workflow that does not compile fails it.
- `node tools/build-release-manifest.mjs --version 0.0.0-ci --out "$M"` and then `--verify "$M"` build and check the manifest.
- `node tools/check-currency.mjs --dry-run` lists pinned actions and the gh-aw pin that are behind. `node tools/validate-decision-records.mjs` checks `docs/decisions/`.

## Rules

- **Change a gate with the skill.** [change-a-gate-workflow](.claude/skills/change-a-gate-workflow/SKILL.md) is the procedure: edit the source, never a lock file or a deployment's copy; put a guarantee in an `if:` or a script, not in a prompt; pin the behaviour with a test and prove the test fails without the change; update the docs.
- **Stop and ask a maintainer** before a change that lets a gate merge, approve a run or lift a hold; that makes a writing gate read untrusted text, enables a shell, adds `min-integrity: none` or widens a safe-output cap; that adds or changes `roles:`; or that needs a new required secret, label or setting in every deployment (that makes the next release a major).
- **A new deployable file goes in `aw.yml`**, a new label in `requirements.json` and the table in `docs/deployment.md`, and a new workflow takes the next free `Concierge <phase><step>` name. Tests refuse each omission.
- **Do not edit `CHANGELOG.md` or the version in `package.json`.** The release workflow writes both. Do not cut a release: [cut-a-concierge-release](.claude/skills/cut-a-concierge-release/SKILL.md) is for a maintainer.
- **A maintainer reads every change to the release pipeline and the updater** (`.github/workflows/release.yml`, `workflows/concierge-updater.yml`, `scripts/concierge-updater.mjs`). Propose, do not decide.
- **Never approve or delete a held run, remove a hold, or merge agent work.** A gate behaviour that has not run live is "not yet seen live" in a pull request, never "works".
- **This repository is public.** No credentials, tenant details or names of people in prompts, docs, records or pull requests.

## Decisions

Accepted records are binding for humans and agents until a newer record supersedes them. If your task conflicts with one, stop and say so in the issue or pull request. A pull request that changes a decided behaviour adds or supersedes a record. Decisions for this repository are in [docs/decisions/](docs/decisions/README.md); the ones to read before changing a gate: To write one, use the [record-a-decision](.claude/skills/record-a-decision/SKILL.md) skill.

- [0005](docs/decisions/0005-a-maintainer-holds-the-levers-of-the-pipeline.md): a maintainer holds the levers: holds, approvals and merges are never the Concierge's.
- [0007](docs/decisions/0007-only-the-issue-worker-is-open-to-every-reporter.md): only the issue worker is open to every reporter, within fixed limits.
- [0011](docs/decisions/0011-code-decides-what-code-can-decide-before-a-model-runs.md): conditions go in the activation job, not in a prompt.
- [0013](docs/decisions/0013-the-gh-aw-version-moves-only-by-release-and-the-pins-stay-current.md) and [0014](docs/decisions/0014-the-concierge-does-not-configure-dependabot-in-deployments.md): the gh-aw version moves only by release, and the Concierge forces nothing about Dependabot into a deployment.

The frodo repositories record the same rule on agent work as core 0002 and the role of the gates as core 0004, in [frodo-cli](https://github.com/rockcarver/frodo-cli/tree/main/docs/decisions/core).
