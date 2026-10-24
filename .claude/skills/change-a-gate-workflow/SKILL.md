---
name: change-a-gate-workflow
description: Change a Repo Concierge gate workflow safely: edit the source in workflows/ (never a lock file), keep the rendered prompt intact, respect the trust and hold rules, pin the behaviour with a test and prove the test catches the regression, run the compile smoke, update the docs and budgets. Use when asked to change what a gate (issue, plan, PR, triage, closer, janitor, updater) does, add a workflow, add a label, or fix a gate that misbehaved. A change here reaches every deployment only after a release.
---

A gate is a workflow in `workflows/` that reacts to a label or an event. The files there are **sources**: a deployment compiles the gh-aw definitions (`*.md`) into lock files itself, when the updater installs a release, so this repository holds no lock files and you never edit one. Plain workflows (`*.yml`) and scripts are copied as they are.

Read before you change anything:

- [docs/multi-phase-design.md](../../../docs/multi-phase-design.md): the gates, the label lifecycle, "Who may start when", "Who can start a gate", "Repository guidance" and "Decision records". The design is written down there with the incidents behind each rule; do not restate it in a prompt or a PR, link it.
- [docs/deployment.md](../../../docs/deployment.md): what an operator sets up and how a deployment is verified.
- The cross-repository records [a maintainer stays the last lever on agent work](https://github.com/rockcarver/frodo/blob/main/docs/decisions/0002-a-maintainer-stays-the-last-lever-on-agent-work.md) and [the Repo Concierge runs the issue, plan and PR gates](https://github.com/rockcarver/frodo/blob/main/docs/decisions/0004-the-repo-concierge-runs-the-issue-plan-and-pr-gates.md). They bind this repository.

## Stop and ask a maintainer first when the change

- lets a gate merge, approve a workflow run, remove a human hold (`plan-approval-required`) or hand work on past one. Record 0002 says it never does; changing that is a new decision record, not a pull request here;
- makes a gate that writes (labels, comments, assignments) read untrusted text it did not read before, adds `min-integrity: none`, enables a shell, or widens a safe-output cap;
- adds or changes `roles:` on a workflow. Only `issue-worker` is open to everyone, and why is the safety case in "Who can start a gate";
- needs a new required secret, label or setting in every deployment (that makes the next release a `major`).

## Steps

1. **Start from `origin/main`** in a branch of your own. Look for the test that already pins the behaviour you are about to change (`ls tools/*.test.mjs scripts/*.test.mjs`; a pin starts with a comment saying which incident it guards). If it fails after your change, that is information: change the code or, for a deliberate decision, change the pin and the doc together and say so in the PR.

2. **Edit the source** in `workflows/<name>.md` (frontmatter, then the prompt) or `workflows/<name>.yml` and `scripts/<name>.mjs`.
   - A guarantee belongs in a deterministic place: an `if:` on the activation, a pre-activation step, a script. A sentence in a prompt is a first layer and the model may ignore it. The PR worker's hold check is the pattern: the `if:` and a live `existing_fix` step are the guarantee, the prompt wording only saves a plan.
   - The prompt the agent sees is the body minus its HTML comments. gh-aw removes `<!-- ... -->` when it renders a prompt, even inside a code fence, so an instruction or a marker written as an HTML comment is an empty block to the agent. Describe such text in words (see "Plan comment identity"). `tools/prompt-hazards.test.mjs` fails on an HTML comment in any prompt.
   - A prompt reaches the agent through `{{#runtime-import .github/workflows/<name>.md}}` in the lock file, so a prompt-only change moves the lock's metadata hashes but none of its steps.
   - Text the model writes is not trusted to notify anyone: gh-aw neutralizes `@handles` in outputs. A mention is a deterministic plain-Actions step (`workflows/reporter-notify.yml`).
   - gh-aw exports only the outcome of a pre-activation step, not its outputs, and rejects `${{ steps.x.outputs.y }}` in a prompt. A `needs.` reference in an `if:` applies the whole `if:` to the activation job. `names:` is only accepted under `pull_request`.
   - Every workflow sets `max-ai-credits` and `timeout-minutes`. `max-ai-credits` is not a per-run cap, but it feeds gh-aw's daily guardrail and failure report, so it has to match what runs really use. Measure before changing one (`gh aw logs`, the `agent_usage.json` in a run's `agent` artifact; figures are in "Repository guidance", Cost) and keep `tools/gate-budgets.test.mjs` in step.
   - Guidance (`AGENTS.md`, instruction files) and decision records are read from the default branch only, with no `ref`, and stay advisory: they can never change a label, a gate or an approval. Keep that when you touch the plan worker, the PR worker or PR triage.

3. **Wire new things in.**
   - A new deployable file (workflow, script or shared template) goes in `aw.yml`; the unit tests and the release build refuse a file under `workflows/`, `scripts/` or `shared/` that is not listed.
   - A new workflow takes the next free step letter in its phase for its `name:` (`Concierge <phase><step> [▸ ]<Name>`, the `▸` only when it has `workflow_dispatch`): `tools/workflow-names.test.mjs`.
   - A new label goes in `requirements.json` and the label table in `docs/deployment.md`; a test keeps them identical. GitHub caps a label description at 100 characters.
   - A plain workflow starts with a header comment saying what it does, how to install it and which secrets it needs (copy the shape of `workflows/janitor.yml`), and gets the smallest `permissions:` that work.

4. **Pin the behaviour with a test** in `tools/<topic>.test.mjs` (a script's tests sit next to it in `scripts/`). Use `node:test` and `node:assert/strict`, read the source files the way the neighbours do, and open the file with a comment that says what went wrong and where it is documented. Assert on what takes effect: a condition in the compiled lock rather than only in the source (`tools/ci-compile-smoke.sh` already reads compiled locks for the role gate, the open-issue condition and the hold labels; extend it when a setting could fail to take effect).

5. **Prove the test catches the regression** (mutation testing). In a throwaway worktree, make the change the test guards against, run the test and expect it to fail, then discard the change. Do this for every assertion you added.

```bash
W="$(mktemp -d)/mutate" && git worktree add --detach "$W" HEAD && cd "$W"
sed -i.bak '/^  roles: all$/d' workflows/issue-worker.md       # the regression, one at a time
node --test tools/issue-worker-roles.test.mjs                  # must fail now
git checkout -- . && rm -f workflows/*.bak                     # next mutation
cd - && git worktree remove --force "$W"
```

   A mutation the tests do not catch means the pin is too weak: strengthen it. Say in the PR how many mutations you ran and that all were caught.

6. **Run everything the CI runs**:

```bash
npm test
XDG_DATA_HOME="$(mktemp -d)" bash tools/ci-compile-smoke.sh     # compiles every definition with the gh-aw version in requirements.json
M="$(mktemp -d)/release-manifest.json"
node tools/build-release-manifest.mjs --version 0.0.0-ci --out "$M" && node tools/build-release-manifest.mjs --verify "$M"
```

   The smoke prints warnings about toolset permissions and new restricted secrets and still passes; a workflow that fails to compile fails it. If your change adds a secret or an action, review it and say in the PR description which one and why it is safe. For plain workflows CI also validates the YAML.

7. **Update the docs** in the same change: [docs/multi-phase-design.md](../../../docs/multi-phase-design.md) for behaviour and the reason (with the incident, in the style of the neighbouring paragraphs), [docs/deployment.md](../../../docs/deployment.md) for what an operator installs or verifies, and the README table or structure list when a workflow is added. Do not edit `CHANGELOG.md`: the release workflow writes it.

8. **Open the pull request** against `main`. In the description give what went wrong (with a link to the issue or run), what changes, what you verified and how (commands and results, mutation count), and what you could not verify. A gate behaviour that has not run live is "not yet seen live", never "works". A maintainer reviews and merges. Releasing and rolling out is a separate step that a maintainer starts: see the `cut-a-concierge-release` skill. Do not cut a release, approve a run or merge your own change.

## Pitfalls

- Editing `.lock.yml` or a file in a deployment: the next update reverts it. Fix the source here.
- A condition that exists in the source but not in the compiled lock (it was dropped or moved by gh-aw). Read the lock in the smoke.
- A label that is added by a workflow's own token does not start another workflow, while one added by `SIGNAL_TOKEN` or a person does: check which token a hand-off uses before relying on a label event.
- Several labels added in the same second start several runs; concurrency groups that ignore the label name can cancel the one that matters ("Label lifecycle").
- Runs the coding agent causes are held for a maintainer's approval. A fix cannot be proven live from a fork or by the agent; say what a maintainer should watch for on the first real case.
