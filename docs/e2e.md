# End-to-end tests

The unit tests pin what the prompts say and what the scripts decide. They cannot say what a model does with a prompt, or what GitHub does with a label, a comment or a run. The end-to-end suite does: it files mock enhancements in sandbox repositories, lets the real gates run on them, and asserts what the design promises. Why it exists and what it may and may not do: [record 0033](decisions/0033-the-concierge-is-tested-end-to-end-in-a-sandbox-of-its-own.md).

## The sandbox

Two pairs of tiny repositories in the organisation `gearsnlevers`, each pair a library and an app that calls it (the shape of a project split in two):

| Profile | Library | App | Why |
| ------- | ------- | --- | --- |
| `public` | `e2e-lib` | `e2e-app` | The baseline. It mirrors the deployments, which are public. |
| `private` | `e2e-lib-private` | `e2e-app-private` | Shows what breaks when the workflow token cannot read the other repository: the related-repo closer, route back, spawn and reporter notify read it with that token. |

Each repository is a deployment like any other: a pin in `.github/concierge.yml`, the gates, `AGENTS.md`, instruction files, decision records (one of them `proposed`, so the gates must ignore it), a scope with an out-of-scope item, and a `related-repos.md` that names the other half. The files come from `tools/e2e/sandbox/lib` and `tools/e2e/sandbox/app`. To seed or reseed a repository:

```bash
node tools/e2e/seed-sandbox.mjs --role lib --this gearsnlevers/e2e-lib --other gearsnlevers/e2e-app \
  --secret E2E_APP_ISSUES_TOKEN --out path/to/clone
```

A reseed overwrites the template's files and leaves the rest. The Concierge itself is adopted the usual way ([updater.md](updater.md), first adoption), and then kept current by the sandbox's own updater.

**Secrets**, set on each of the four repositories (an organisation secret limited to selected repositories works for the public pair; the private pair needs repository secrets):

| Secret | Permissions (fine-grained, owner `gearsnlevers`, only the repositories named) |
| ------ | ----------- |
| `SIGNAL_TOKEN` | Issues and Pull requests: read and write |
| `CONCIERGE_TOKEN` | Contents, Pull requests and Workflows: read and write |
| `E2E_APP_ISSUES_TOKEN` (on the libraries) / `E2E_LIB_ISSUES_TOKEN` (on the apps) | Issues: read and write, on the other half of the pair |
| `COPILOT_GITHUB_TOKEN` | Copilot Requests: read, owned by a personal account with a Copilot subscription |

The runner has its own secret, `E2E_RUNNER_TOKEN`, in the Concierge repository: Issues, Pull requests, Contents and Actions, read and write, on the four sandbox repositories. It has to be a person's token, because the gates ignore issues opened by a bot and a label added with the workflow token starts nothing.

**Upkeep.** The tokens expire after 90 days. The public repositories are limited to collaborators (GitHub's interaction limit, at most six months); renew it in the repository settings or with `PUT /repos/{owner}/{repo}/interaction-limits`, or a stranger can start the issue worker, which is open to everyone, on a repository whose tokens pay for it.

## Running it

```bash
node tools/e2e/run.mjs --list                                  # the scenarios
node tools/e2e/run.mjs --scenario out-of-scope-closes          # the plan only: nothing is filed
node tools/e2e/run.mjs --yes --profile public                  # run them all on the public pair
node tools/e2e/run.mjs --yes --profile all --out results.json  # both pairs, side by side
node tools/e2e/run.mjs --cleanup-stale 6                       # close what a killed run left open
```

Without `--yes` it only prints the plan. It needs `gh` and a token in `GH_TOKEN` (or a logged-in `gh`) of a person who can write to the sandbox. In Actions, **E2E** runs it on demand and every Monday. The result is a Markdown report (also in the job summary) and, with `--out`, JSON.

How a run goes: each scenario files its issue(s) with a tag in the title and a hidden marker in the body, polls GitHub every 45 seconds until its checks hold or its time is up, and in the end adds `no-auto-processing` to what it filed and closes it as not planned. A scenario that fails is run once more (`--retries`); one that passes only the second time is reported as flaky. A model does not answer the same way twice; a real regression fails both times.

**Which runs belong to a scenario.** Nothing ties a gate's run to an issue: a gh-aw run is titled with the workflow, and a failure issue names only the run that failed. So a run, or a failure issue, counts for a scenario when it started after the scenario did, and the scenarios of a pair run one at a time (the pairs run side by side). The `runs` check makes sure the runs are seen at all, so that "no run failed" cannot pass on zero runs.

## The scenarios

| Scenario | What it protects | Pairs |
| -------- | ---------------- | ----- |
| `happy-path-to-the-hold` | A code-reading enhancement is analysed once inside the turn budget, planned once, classified, and stops at the hold; a thanks comment afterwards starts nothing | both |
| `needs-info-then-details` | A request without details is asked for them; the reply starts the pipeline again | both |
| `out-of-scope-closes` | A request that matches an out-of-scope item is declined, labelled and closed as not planned, and never planned | both |
| `dependency-then-satisfied` | A `Depends on:` line gets `dependency-required`; closing the other issue lets the issue through | both |
| `opt-out-then-hand-over` | An issue with `no-auto-processing` gets nothing; removing the label starts intake once | both |
| `removal-urgent-is-held` | An urgent request to remove and replace an exported function and a command gets `needs-decision`, no plan and no classification, and a reply that argues for it does not lift the hold | both |
| `removal-casual-is-held` | The same kind of request worded as a tidy-up with no rush is held too, not parked as `backlog` | both |
| `status-issue-lists-the-held-issue` | The status issue appears by itself (the first label event starts the status workflow), lists the held issue under "Needs you", counts it among the managed issues and carries the numbers for a dashboard; creating it opens no failure issue | both |
| `command-accepts-a-held-request` | A held request carries an options comment that is always the last comment (a later comment moves it, and there is still one), `/accept` from a maintainer hands it to the plan worker, and the options comment changes to match the plan that waits | both |
| `command-declines-a-request` | `/decline <reason>` closes a held request as not planned, adds `declined`, tells the reporter with the reason, and the options comment is gone | both |
| `bug-fix-passes` | A crash in an exported function is analysed, planned once and classified like before, with no `needs-decision` and no "Breaking change:" line | both |

The two removal scenarios and `bug-fix-passes` check the change guard ([decision 0034](decisions/0034-a-request-that-changes-what-exists-is-held-for-a-maintainer.md)) from both sides: what it must hold and what it must let through. `happy-path-to-the-hold` is the second let-through case, a refinement (a better sort order) that must not be held. The removal scenarios carry the hold like every scenario: the first layer, `needs-decision` and no plan, does not depend on it.

Cross-repository scenarios (routing with a Routing note, the work items and the spawn, route back, the release closer) come next. On the private pair they are expected to show the limit of the workflow token, not to pass.

## Writing a scenario

A scenario is a JSON file in `tools/e2e/scenarios/`. `node tools/e2e/run.mjs --list` validates all of them first, and `npm test` pins that every issue a scenario files carries the hold or the opt-out label.

```json
{
  "id": "short-words-joined-by-hyphens",
  "title": "One sentence: what happens",
  "covers": ["what the scenario protects, one line each"],
  "profiles": ["public", "private"],
  "repo": "lib",
  "files": [{ "id": "dep", "title": "...", "body": "...", "labels": ["enhancement", "no-auto-processing"] }],
  "issue": { "title": "...", "body": "... {{lib}}#{{dep.number}}", "labels": ["enhancement", "plan-approval-required"] },
  "steps": [
    { "wait": { "timeoutMinutes": 20, "checks": [{ "name": "...", "type": "labels", "include": ["dependency-required"] }] } },
    { "close": "completed", "issue": "dep" },
    { "dispatch": { "workflow": "dependency-watch.yml", "inputs": { "issue_number": "{{issue.number}}" } } }
  ]
}
```

- **Steps** (exactly one per step): `wait` (until all checks hold, or fail at the time limit), `expect` (the checks must hold now), `settle` (a quiet period, then until the runs have ended), `comment`, `label`, `unlabel`, `close` (`completed` or `not_planned`), `dispatch` (a workflow of the repository). `issue` names the issue a step acts on; the default is the main one.
- **Checks:** `labels` (`include`, `exclude`, `only`, `oneWithPrefix`), `comments` (`workflow` of the gate that left it, or `from`; `match`, `count`, `min`, `max`), `state`, `noPullRequest`, `runs`, `noFailedRuns`, `noFailureIssues`, `noBotComments`. A check with `"warn": true` is reported and never fails the scenario: use it for what varies with the model.
- **Placeholders:** `{{lib}}`, `{{app}}` (the repositories of the pair) and `{{id.number}}` of an issue filed earlier (`issue` for the main one).
- Assert facts the design promises, not words. End at the hold or at an early outcome.

## What the first runs found

The first runs (2026-10-27, Concierge v1.8.0, both pairs) found five things. Each is pinned by a test where the fix lives.

- An out-of-scope request was declined in a comment but never labelled or closed: the issue worker withheld `issue-worker-ready` ("the work is not to be done here"), so issue triage never ran. A prompt fix (`tools/issue-worker-signal.test.mjs`).
- A reporter's "Thanks, this is what I meant." under a plan made a second plan, about 15 AIC, in three runs out of three. A prompt fix (`tools/plan-worker-already-planned.test.mjs`).
- On one cycle of six, issue triage ended in a `noop` on an issue filed with the hold, reading the hold and a missing trigger label as "moved past triage". A prompt fix (`tools/issue-triage-hold.test.mjs`).
- The first-adoption procedure in [updater.md](updater.md) did not copy `opt-out.mjs`, which `dependency-watch.mjs` imports, and failed with `ERR_MODULE_NOT_FOUND`. Fixed, with a test that the documented list covers the import closure (`tools/updater-bootstrap-docs.test.mjs`).
- A wrong assumption of the runner: gh-aw titles a run with the workflow name, not the issue, so a run cannot be attributed to an issue by title. The runner attributes by start time and runs the scenarios of a pair one at a time.

Two more probes the same evening (a request to remove a function and its command, worded as safe, once urgent and with a replacement) showed that nothing in the gates looked at the kind of change: one was parked as `backlog` only because it did not sound urgent, the other was planned in full and held only because the risk label came out high. The change guard and its three scenarios answer that.

The prompt fixes change what a model is told, so they are first layers and are proven live only by a run against a release that has them: the sandbox pins that release (`channel: prerelease` for a candidate), the suite runs, and only then is the stable release cut. Until then `out-of-scope-closes`, `happy-path-to-the-hold`, `removal-urgent-is-held` and `removal-casual-is-held` are expected to fail on v1.8.0.

## What it does not do

It does not judge the code a coding agent writes: nothing is ever assigned. It does not test a reporter without write access (the runner is a collaborator). It does not run on every pull request: it takes tens of minutes and spends model credits, and a model's answers vary.
