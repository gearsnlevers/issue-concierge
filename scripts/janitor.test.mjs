import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  staleLabels,
  isCodingAgent,
  isDisposableHeldRun,
  isHeldByAgent,
  everyJobGuardedByDependabot,
  staleRunReason,
  sweepHeldRuns,
  DISPOSABLE_HELD_RUNS,
  run,
  TRIGGER_LABELS,
  GATE,
  TRIAGE_OUTCOMES,
  OPEN_WORK_STATE,
} from './janitor.mjs';

const issue = (labels, extra = {}) => ({ labels, state: 'open', assignees: [], ...extra });
const stale = (labels, extra) => staleLabels(issue(labels, extra)).sort();

// ------------------------------------------------------------- the rules

test('the coding agent is recognised by login, and only it', () => {
  for (const login of ['Copilot', 'copilot', 'copilot-swe-agent', 'copilot-swe-agent[bot]']) assert.equal(isCodingAgent(login), true, login);
  for (const login of ['vscheuber', 'copilot-fan', 'github-copilot', '', undefined]) assert.equal(isCodingAgent(login), false, String(login));
});

test('issue gate labels: each is removed only once the next signal exists', () => {
  assert.deepEqual(stale(['issue-worker-ready']), []);
  assert.deepEqual(stale(['issue-worker-ready', 'issue-triage-handoff']), ['issue-worker-ready']);
  assert.deepEqual(stale(['issue-triage-handoff']), []);
  assert.deepEqual(stale(['issue-triage-handoff', 'plan-worker-ready']), ['issue-triage-handoff']);
  assert.deepEqual(stale(['plan-worker-ready']), []);
  assert.deepEqual(stale(['plan-worker-ready', 'plan-triage-handoff']), ['plan-worker-ready']);
  assert.deepEqual(stale(['plan-triage-handoff']), []);
});

test('classification alone does not remove the plan worker signal, but does retire the issue-phase ones', () => {
  // Plan triage adds complexity/risk and the hand-off together; until the hand-off exists the item keeps its position.
  assert.deepEqual(stale(['plan-worker-ready', 'complexity/medium', 'risk/medium']), []);
  assert.deepEqual(stale(['issue-triage-handoff', 'complexity/medium']), ['issue-triage-handoff']);
  assert.deepEqual(stale(['issue-worker-ready', 'risk/low']), ['issue-worker-ready']);
});

test('every triage outcome consumes issue-worker-ready, not only the hand-off', () => {
  for (const outcome of TRIAGE_OUTCOMES) {
    assert.deepEqual(stale(['issue-worker-ready', outcome]), ['issue-worker-ready'], outcome);
  }
});

test('plan approval consumes the plan worker signal and leaves the approval label alone', () => {
  assert.deepEqual(stale(['plan-worker-ready', 'plan-approval-required', 'complexity/high']), ['plan-worker-ready']);
  assert.deepEqual(stale(['issue-triage-handoff', 'plan-approval-required']), ['issue-triage-handoff']);
});

test('assigning the coding agent retires every earlier gate label, including the plan hand-off', () => {
  const agent = { assignees: ['vscheuber', 'Copilot'] };
  assert.deepEqual(stale(['issue-worker-ready', 'issue-triage-handoff', 'plan-worker-ready', 'plan-triage-handoff'], agent), [
    'issue-triage-handoff',
    'issue-worker-ready',
    'plan-triage-handoff',
    'plan-worker-ready',
  ]);
  assert.deepEqual(stale(['plan-triage-handoff'], { assignees: ['vscheuber'] }), []);
});

test('state and classification labels survive on an open issue', () => {
  const keep = ['enhancement', 'complexity/medium', 'risk/medium', 'dependency-satisfied', 'dependency-required', 'backlog', 'needs-info', 'scope-review', 'low-hanging-fruit', 'plan-approval-required'];
  assert.deepEqual(stale(keep), []);
});

test('closing an issue removes gate labels and open-work state, and keeps everything that describes it', () => {
  const labels = ['enhancement', 'complexity/medium', 'risk/medium', 'low-hanging-fruit', 'out-of-scope', 'duplicate', 'related-repo', 'waiting-for-release', 'released', 'priority/p1',
    ...GATE.issue, ...OPEN_WORK_STATE];
  const removed = new Set(staleLabels(issue(labels, { state: 'closed' })));
  assert.deepEqual([...removed].sort(), [...new Set([...GATE.issue, ...OPEN_WORK_STATE])].sort());
  for (const kept of ['enhancement', 'complexity/medium', 'risk/medium', 'low-hanging-fruit', 'out-of-scope', 'duplicate', 'related-repo', 'waiting-for-release', 'released', 'priority/p1']) {
    assert.equal(removed.has(kept), false, `${kept} must stay`);
  }
});

test('pull request labels: hand-over goes with the next signal, both go when it closes', () => {
  const pr = (labels, state = 'open') => staleLabels({ labels, state, isPullRequest: true }).sort();
  assert.deepEqual(pr(['pr-worker-ready']), []);
  assert.deepEqual(pr(['pr-worker-ready', 'pr-triage-handoff']), ['pr-worker-ready']);
  assert.deepEqual(pr(['pr-triage-handoff']), []);
  assert.deepEqual(pr(['pr-worker-ready', 'pr-triage-handoff'], 'closed'), ['pr-triage-handoff', 'pr-worker-ready']);
  assert.deepEqual(pr(['complexity/low', 'risk/low', 'enhancement'], 'closed'), []);
});

test('an issue-style gate label on a pull request is not touched by the issue rules', () => {
  assert.deepEqual(staleLabels({ labels: ['issue-worker-ready', 'issue-triage-handoff'], isPullRequest: true }), []);
});

// ------------------------------------------------- a whole life, step by step

test('lifecycle: at most one gate label at a time, and the right survivors after close', () => {
  let labels = new Set(['enhancement']);
  let assignees = [];
  const settle = () => {
    for (const l of staleLabels({ labels, state: 'open', assignees })) labels.delete(l);
  };
  const gates = () => [...labels].filter((l) => GATE.issue.includes(l));
  const step = (fn, expectGates) => {
    fn();
    settle();
    assert.deepEqual(gates(), expectGates);
  };

  step(() => labels.add('issue-worker-ready'), ['issue-worker-ready']);
  step(() => labels.add('dependency-required'), []);                       // triage gated it
  step(() => { labels.add('dependency-satisfied'); labels.delete('dependency-required'); labels.add('issue-worker-ready'); }, ['issue-worker-ready']);
  step(() => labels.add('issue-triage-handoff'), ['issue-triage-handoff']);
  step(() => labels.add('plan-worker-ready'), ['plan-worker-ready']);
  step(() => ['complexity/medium', 'risk/medium', 'plan-triage-handoff'].forEach((l) => labels.add(l)), ['plan-triage-handoff']);
  step(() => assignees.push('Copilot'), []);

  // The issue closes, the waiting-for-release workflow adds its label, the janitor runs on the close.
  labels.add('waiting-for-release');
  for (const l of staleLabels({ labels, state: 'closed', assignees })) labels.delete(l);
  assert.deepEqual([...labels].sort(), ['complexity/medium', 'enhancement', 'risk/medium', 'waiting-for-release']);
  labels.delete('waiting-for-release');
  labels.add('released');
  assert.deepEqual([...labels].sort(), ['complexity/medium', 'enhancement', 'released', 'risk/medium']);
});

test('lifecycle: a backlog issue promoted by hand keeps working', () => {
  const labels = new Set(['issue-worker-ready']);
  labels.add('backlog');
  for (const l of staleLabels({ labels, state: 'open' })) labels.delete(l);
  assert.deepEqual([...labels], ['backlog']);
  labels.delete('backlog');
  labels.add('issue-triage-handoff');
  assert.deepEqual(staleLabels({ labels, state: 'open' }), []);
});

// ------------------------------------------------------------------ run()

function fake(items) {
  const removed = [];
  const logs = [];
  const failOn = new Set();
  return {
    removed,
    logs,
    failOn,
    ctx: {
      get: async (number) => items.find((i) => i.number === number) || null,
      list: async (label, state) => items.filter((i) => i.state === state && i.labels.some((l) => l.name === label)),
      remove: async (number, label) => {
        if (failOn.has(`${number}:${label}`)) throw new Error('boom');
        removed.push(`${number}:${label}`);
      },
      log: (line) => logs.push(line),
    },
  };
}
const item = (number, labels, extra = {}) => ({ number, state: 'open', labels: labels.map((name) => ({ name })), assignees: [], ...extra });

test('run on one item removes only what is stale', async () => {
  const f = fake([item(5, ['issue-worker-ready', 'issue-triage-handoff', 'enhancement']), item(6, ['issue-worker-ready', 'issue-triage-handoff'])]);
  const changed = await run({ number: 5 }, f.ctx);
  assert.deepEqual(f.removed, ['5:issue-worker-ready']);
  assert.deepEqual(changed, [{ number: 5, kind: 'issue', removed: ['issue-worker-ready'] }]);
});

test('run on an unknown item, or one with nothing stale, changes nothing', async () => {
  const f = fake([item(5, ['issue-triage-handoff'])]);
  assert.deepEqual(await run({ number: 99 }, f.ctx), []);
  assert.deepEqual(await run({ number: 5 }, f.ctx), []);
  assert.deepEqual(f.removed, []);
});

test('a dry run reports and removes nothing', async () => {
  const f = fake([item(5, ['issue-worker-ready', 'backlog'])]);
  const changed = await run({ number: 5, dryRun: true }, f.ctx);
  assert.deepEqual(f.removed, []);
  assert.equal(changed.length, 1);
  assert.match(f.logs[0], /would remove issue-worker-ready/);
});

test('a sweep covers issues and pull requests, open only by default', async () => {
  const f = fake([
    item(1, ['issue-worker-ready', 'issue-triage-handoff']),
    item(2, ['pr-worker-ready', 'pr-triage-handoff'], { pull_request: {} }),
    item(3, ['plan-triage-handoff'], { assignees: [{ login: 'Copilot' }] }),
    item(4, ['issue-triage-handoff', 'dependency-satisfied'], { state: 'closed' }),
  ]);
  await run({}, f.ctx);
  assert.deepEqual(f.removed.sort(), ['1:issue-worker-ready', '2:pr-worker-ready', '3:plan-triage-handoff']);
});

test('a sweep with includeClosed also tidies closed items, including ones that only carry open-work state', async () => {
  const f = fake([
    item(4, ['issue-triage-handoff', 'dependency-satisfied', 'enhancement'], { state: 'closed' }),
    item(7, ['backlog', 'complexity/low'], { state: 'closed' }),
  ]);
  await run({ includeClosed: true }, f.ctx);
  assert.deepEqual(f.removed.sort(), ['4:dependency-satisfied', '4:issue-triage-handoff', '7:backlog']);
});

test('one failed removal does not stop the others, and the run still fails', async () => {
  const f = fake([item(5, ['issue-worker-ready', 'issue-triage-handoff', 'plan-worker-ready'])]);
  f.failOn.add('5:issue-worker-ready');
  await assert.rejects(run({ number: 5 }, f.ctx), /5 issue-worker-ready: boom/);
  assert.deepEqual(f.removed, ['5:issue-triage-handoff']);
});

// -------------------------------------------------------- the workflow file

test('the workflow starts for exactly the label events the script cares about', () => {
  const yml = fs.readFileSync(new URL('../workflows/janitor.yml', import.meta.url), 'utf8');
  const m = yml.match(/fromJSON\('(\[.*?\])'\)/);
  assert.ok(m, 'label list not found in workflows/janitor.yml');
  assert.deepEqual(JSON.parse(m[1]).sort(), [...TRIGGER_LABELS].sort());
});

test('every label event has its own concurrency group, so a skipped run cannot cancel the one that works', () => {
  const yml = fs.readFileSync(new URL('../workflows/janitor.yml', import.meta.url), 'utf8');
  const m = yml.match(/^concurrency:\n\s+group: (.+)\n\s+cancel-in-progress: (\w+)$/m);
  assert.ok(m, 'concurrency block not found in workflows/janitor.yml');
  assert.match(m[1], /github\.event\.label\.name/);
  assert.match(m[1], /github\.event\.issue\.number \|\| github\.event\.pull_request\.number/);
  assert.equal(m[2], 'false');
});

test('the workflow needs no secret and only the permissions it uses', () => {
  const yml = fs.readFileSync(new URL('../workflows/janitor.yml', import.meta.url), 'utf8');
  assert.equal(/secrets\./.test(yml.replace(/^#.*$/gm, '')), false);
  assert.match(yml, /issues: write/);
  assert.match(yml, /pull-requests: write/);
});

// ---------------------------------------------------------------- held runs

const held = (extra = {}) => ({
  id: 1,
  name: 'Concierge 1a ▸ Issue Worker',
  path: '.github/workflows/issue-worker.lock.yml',
  event: 'issue_comment',
  status: 'completed',
  conclusion: 'action_required',
  actor: { login: 'Copilot' },
  display_title: 'Add a thing',
  ...extra,
});

function fakeRuns(runs, { prs = {}, workflows = {} } = {}) {
  const deleted = [];
  const logs = [];
  const failOn = new Set();
  const reads = { prs: [], workflows: [] };
  return {
    deleted,
    logs,
    failOn,
    reads,
    ctx: {
      listHeldRuns: async () => runs,
      getPullRequest: async (number) => {
        reads.prs.push(number);
        const pr = prs[number];
        if (!pr || pr instanceof Error) throw pr || new Error('HTTP 404');
        return pr;
      },
      readWorkflow: async (file) => {
        reads.workflows.push(file);
        const text = workflows[file];
        if (text === undefined || text instanceof Error) throw text || new Error('HTTP 404');
        return text;
      },
      deleteRun: async (id) => {
        if (failOn.has(id)) throw new Error('boom');
        deleted.push(id);
      },
      log: (line) => logs.push(line),
    },
  };
}

// The repository's own workflow, as frodo-cli and frodo-lib have it: one job, guarded on the actor.
const DEPENDABOT_WORKFLOW = `name: 'Dependabot Auto-Merge'

on: pull_request

permissions:
  contents: write
  pull-requests: write

jobs:
  dependabot:
    runs-on: ubuntu-latest
    # Guard on the actor: skips immediately for every non-Dependabot PR,
    # including all human PRs.
    if: github.actor == 'dependabot[bot]'
    steps:
      - name: Fetch Dependabot metadata
        uses: dependabot/fetch-metadata@v3
      - name: Enable auto-merge for minor and patch updates
        if: contains(fromJSON('["version-update:semver-patch"]'), steps.metadata.outputs.update-type)
        run: gh pr merge --auto --squash "$PR_URL"
`;
const DEPENDABOT_PATH = '.github/workflows/dependabot-auto-merge.yml';

/** A held pipeline run of a push to a pull request by the coding agent. */
const pushRun = (extra = {}) =>
  held({
    id: 100,
    name: 'Frodo CLI Release Pipeline',
    path: '.github/workflows/pipeline.yml',
    event: 'pull_request',
    head_sha: 'newest0000000000000000000000000000000000',
    pull_requests: [{ number: 895 }],
    ...extra,
  });
/** The held Dependabot Auto-Merge run of the same push. */
const dependabotRun = (extra = {}) =>
  pushRun({ id: 101, name: 'Dependabot Auto-Merge', path: DEPENDABOT_PATH, ...extra });
const OPEN_AT_NEWEST = { 895: { state: 'open', headSha: 'newest0000000000000000000000000000000000' } };

test('a held Issue Worker run caused by the coding agent is disposable', () => {
  assert.equal(isDisposableHeldRun(held()), true);
  assert.equal(isDisposableHeldRun(held({ actor: { login: 'copilot-swe-agent[bot]' } })), true);
});

test('no other run is: not the approvals that matter, not other people, not other outcomes', () => {
  const kept = {
    'the pipeline run of a coding agent push (the approval that matters)': {
      name: 'Frodo Library Release Pipeline',
      path: '.github/workflows/pipeline.yml',
      event: 'pull_request',
    },
    "a contributor's pipeline run on a fork pull request": {
      path: '.github/workflows/pipeline.yml',
      event: 'pull_request',
      actor: { login: 'TJShowerHandel' },
    },
    'an Issue Worker run held for someone other than the agent': { actor: { login: 'TJShowerHandel' } },
    'another gate workflow caused by the agent': { path: '.github/workflows/pr-worker.lock.yml' },
    'the Issue Worker on another event': { event: 'issues' },
    'a run that already skipped': { conclusion: 'skipped' },
    'a run that is not finished': { status: 'in_progress' },
    'a run without an actor': { actor: null },
  };
  for (const [what, extra] of Object.entries(kept)) assert.equal(isDisposableHeldRun(held(extra)), false, what);
});

test('the sweep deletes the disposable held runs and leaves every other run alone', async () => {
  const pipeline = held({ id: 2, name: 'Frodo CLI Release Pipeline', path: '.github/workflows/pipeline.yml', event: 'pull_request' });
  const fork = held({ id: 3, actor: { login: 'TJShowerHandel' } });
  const f = fakeRuns([held({ id: 1 }), pipeline, held({ id: 4 }), fork]);
  assert.deepEqual(await sweepHeldRuns({}, f.ctx), [1, 4]);
  assert.deepEqual(f.deleted, [1, 4]);
  assert.equal(f.logs.length, 2);
  assert.match(f.logs[0], /run 1 \(Concierge 1a ▸ Issue Worker, issue_comment by Copilot, "Add a thing"\): deleted/);
});

test('a dry run deletes nothing and says what it would delete', async () => {
  const f = fakeRuns([held({ id: 1 })]);
  assert.deepEqual(await sweepHeldRuns({ dryRun: true }, f.ctx), [1]);
  assert.deepEqual(f.deleted, []);
  assert.match(f.logs[0], /would delete/);
});

test('with nothing held the sweep says so', async () => {
  const f = fakeRuns([held({ id: 2, path: '.github/workflows/pipeline.yml', event: 'pull_request' })]);
  assert.deepEqual(await sweepHeldRuns({}, f.ctx), []);
  assert.deepEqual(f.logs, ['No held runs to delete.']);
});

test('one failed deletion does not stop the others, and the sweep still fails', async () => {
  const f = fakeRuns([held({ id: 1 }), held({ id: 2 })]);
  f.failOn.add(1);
  await assert.rejects(sweepHeldRuns({}, f.ctx), /could not delete: run 1: boom/);
  assert.deepEqual(f.deleted, [2]);
  assert.equal(f.logs.length, 1, 'the log must not claim a deletion that failed');
  assert.match(f.logs[0], /^run 2 /);
});

test('deleting is safe only while the Issue Worker skips comments by bots and comments on pull requests', () => {
  const md = fs.readFileSync(new URL('../workflows/issue-worker.md', import.meta.url), 'utf8');
  const guard = md.match(/^if: (.+)$/m)?.[1];
  assert.ok(guard, 'the Issue Worker has no job condition; approving a held run would start real work');
  assert.match(guard, /github\.event\.comment\.user\.type != 'Bot'/);
  assert.match(guard, /github\.event\.issue\.pull_request == null/);
});

test('the disposable workflows are the Issue Worker lock file gh-aw generates and the repository\'s Dependabot auto-merge', () => {
  assert.deepEqual(
    DISPOSABLE_HELD_RUNS.map(({ path: p, event, guard }) => ({ path: p, event, guard })),
    [
      { path: '.github/workflows/issue-worker.lock.yml', event: 'issue_comment', guard: undefined },
      { path: DEPENDABOT_PATH, event: 'pull_request', guard: 'dependabot-actor' },
    ]
  );
  assert.equal(fs.existsSync(new URL('../workflows/issue-worker.md', import.meta.url)), true);
});

test('the sweep is its own job: only it has actions: write, and it follows the label job', () => {
  const yml = fs.readFileSync(new URL('../workflows/janitor.yml', import.meta.url), 'utf8');
  const code = yml.replace(/^\s*#.*$/gm, '');
  const clean = code.indexOf('\n  clean:');
  const sweep = code.indexOf('\n  held-runs:');
  assert.ok(clean > 0 && sweep > clean, 'the held-runs job must follow the clean job');
  assert.equal(/actions:/.test(code.slice(0, clean)), false, 'workflow-level permissions must not include actions');
  assert.equal(/actions: write/.test(code.slice(clean, sweep)), false, 'the label job must not get actions: write');
  const job = code.slice(sweep);
  assert.match(job, /needs: clean/);
  const perms = job.match(/permissions:\n((?:\s{6}[\w-]+: \w+\n)+)/);
  assert.ok(perms, 'the held-runs job must declare its permissions');
  assert.deepEqual(perms[1].trim().split('\n').map((l) => l.trim()).sort(), ['actions: write', 'contents: read', 'pull-requests: read']);
  assert.equal(/pull-requests: (read|write)/.test(code.slice(clean, sweep)), false, 'the label job inherits the workflow-level token and declares no job permissions');
  assert.match(job, /node \.github\/scripts\/janitor\.mjs --held-runs/);
});

test('the sweep starts when the label job did, except for issue events', () => {
  const yml = fs.readFileSync(new URL('../workflows/janitor.yml', import.meta.url), 'utf8');
  const job = yml.slice(yml.indexOf('\n  held-runs:')).replace(/^\s*#.*$/gm, '');
  assert.match(job, /!cancelled\(\)/);
  assert.match(job, /needs\.clean\.result != 'skipped'/);
  assert.match(job, /github\.event_name != 'issues'/);
});

test('--held-runs lists held runs from the API and deletes only the disposable ones (gh stubbed)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'janitor-gh-'));
  const log = path.join(dir, 'calls.log');
  const runs = [
    held({ id: 11 }),
    held({ id: 12, name: 'Frodo CLI Release Pipeline', path: '.github/workflows/pipeline.yml', event: 'pull_request' }),
    held({ id: 13 }),
  ];
  fs.writeFileSync(path.join(dir, 'runs.jsonl'), runs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(
    path.join(dir, 'gh'),
    [
      '#!/bin/sh',
      `echo "$*" >> '${log}'`,
      'case "$*" in',
      `  *"actions/runs?status=action_required&per_page=100"*) cat '${path.join(dir, 'runs.jsonl')}' ;;`,
      '  *"--method DELETE"*"actions/runs/13") echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;',
      '  *"--method DELETE"*"actions/runs/"*) ;;',
      '  *) echo "unexpected gh call: $*" >&2; exit 1 ;;',
      'esac',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  const script = fileURLToPath(new URL('./janitor.mjs', import.meta.url));
  const out = execFileSync('node', [script, '--held-runs'], {
    env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't' },
    encoding: 'utf8',
  });
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  const deletes = calls.filter((c) => c.includes('--method DELETE')).map((c) => c.match(/actions\/runs\/(\d+)/)[1]);
  assert.deepEqual(deletes, ['11', '13'], 'run 12 (the pipeline) must not be deleted; run 13 answers 404, which counts as gone');
  assert.equal(calls.some((c) => /labels|issues\//.test(c)), false, '--held-runs must not run the label task');
  assert.match(out, /run 11 \(.*\): deleted/);
});

// ------------------------------------------- stale runs and the Dependabot guard

test('a Dependabot workflow is safe to skip only when every job is guarded on the actor', () => {
  assert.equal(everyJobGuardedByDependabot(DEPENDABOT_WORKFLOW), true, 'the workflow frodo-cli and frodo-lib have');
  assert.equal(everyJobGuardedByDependabot(DEPENDABOT_WORKFLOW.replace("if: github.actor == 'dependabot[bot]'", "if: ${{ github.actor == 'dependabot[bot]' }}")), true, 'wrapped in an expression');
  const cases = {
    'no jobs': 'name: x\non: pull_request\n',
    'an empty jobs block': 'name: x\non: pull_request\njobs:\nother: 1\n',
    'a job without a guard': DEPENDABOT_WORKFLOW.replace("    if: github.actor == 'dependabot[bot]'\n", ''),
    'a guard that also lets anyone through': DEPENDABOT_WORKFLOW.replace("github.actor == 'dependabot[bot]'", "github.actor == 'dependabot[bot]' || true"),
    'a guard on another actor': DEPENDABOT_WORKFLOW.replace("dependabot[bot]", 'renovate[bot]'),
    'a guard on a step, not on the job': DEPENDABOT_WORKFLOW.replace("    if: github.actor == 'dependabot[bot]'\n", '').replace('        uses: dependabot/fetch-metadata@v3\n', "        if: github.actor == 'dependabot[bot]'\n        uses: dependabot/fetch-metadata@v3\n"),
    'a second job that is not guarded': DEPENDABOT_WORKFLOW + '  other:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo real work\n',
  };
  for (const [what, text] of Object.entries(cases)) assert.equal(everyJobGuardedByDependabot(text), false, what);
  assert.equal(everyJobGuardedByDependabot(DEPENDABOT_WORKFLOW + '  second:\n    if: github.actor == \'dependabot[bot]\'\n    steps: []\n'), true, 'two jobs, both guarded');
  assert.equal(everyJobGuardedByDependabot(undefined), false);
});

test('a pull request run is stale when its pull request is closed or has moved past it', () => {
  const run = pushRun({ head_sha: 'old' });
  assert.match(staleRunReason(run, { state: 'open', headSha: 'newest1234567' }), /pull request #895 moved on to newest1/);
  assert.match(staleRunReason(pushRun(), { state: 'closed', headSha: 'newest0000000000000000000000000000000000' }), /pull request #895 is closed/);
  assert.equal(staleRunReason(pushRun(), OPEN_AT_NEWEST[895]), null, 'the current head is never stale');
  assert.equal(staleRunReason(pushRun({ event: 'issue_comment' }), { state: 'closed' }), null, 'only pull_request runs');
  assert.equal(staleRunReason(pushRun({ pull_requests: [] }), { state: 'closed' }), null, 'no pull request, nothing to compare');
  assert.equal(staleRunReason(pushRun(), null), null);
  assert.equal(staleRunReason(pushRun({ head_sha: 'old' }), { state: 'open' }), null, 'no head to compare with: keep');
  assert.equal(staleRunReason(pushRun({ head_sha: undefined }), { state: 'open', headSha: 'x' }), null, 'no commit on the run: keep');
});

test('the sweep keeps the pipeline run of the head and every run it cannot judge', async () => {
  const keep = {
    'the pipeline run for the current head': pushRun({ id: 1 }),
    'an unrelated workflow of the agent on the current head': pushRun({ id: 2, name: 'Concierge 3c PR Triage', path: '.github/workflows/pr-triage.lock.yml' }),
    "a contributor's run on a fork pull request (no pull request in the run)": pushRun({ id: 3, actor: { login: 'TJShowerHandel' }, pull_requests: [], head_sha: 'old' }),
    'a stale run caused by a human': pushRun({ id: 4, actor: { login: 'vscheuber' }, head_sha: 'old' }),
    'a run of the agent without a pull request': pushRun({ id: 5, pull_requests: [], head_sha: 'old' }),
    'a run of the agent on another event': pushRun({ id: 6, event: 'push', head_sha: 'old' }),
    'a Dependabot run caused by Dependabot itself': dependabotRun({ id: 7, actor: { login: 'dependabot[bot]' } }),
    'a run that already skipped': pushRun({ id: 8, conclusion: 'skipped', head_sha: 'old' }),
  };
  const f = fakeRuns(Object.values(keep), { prs: OPEN_AT_NEWEST, workflows: { [DEPENDABOT_PATH]: DEPENDABOT_WORKFLOW } });
  assert.deepEqual(await sweepHeldRuns({}, f.ctx), []);
  assert.deepEqual(f.deleted, []);
  assert.deepEqual(f.logs, ['No held runs to delete.']);
});

test('the sweep deletes a pipeline run of an older push and of a closed pull request', async () => {
  const f = fakeRuns([pushRun({ id: 1, head_sha: 'older' }), pushRun({ id: 2 }), pushRun({ id: 3, pull_requests: [{ number: 7 }] })], {
    prs: { ...OPEN_AT_NEWEST, 7: { state: 'closed', headSha: 'newest0000000000000000000000000000000000' } },
  });
  assert.deepEqual(await sweepHeldRuns({}, f.ctx), [1, 3]);
  assert.match(f.logs[0], /run 1 \(Frodo CLI Release Pipeline, pull_request by Copilot, "Add a thing"\): deleted \(pull request #895 moved on to newest0\)/);
  assert.match(f.logs[1], /run 3 .*deleted \(pull request #7 is closed\)/);
});

test('a Dependabot Auto-Merge run of the agent is deleted, even for the current head', async () => {
  const f = fakeRuns([dependabotRun(), dependabotRun({ id: 102, head_sha: 'older' })], {
    prs: OPEN_AT_NEWEST,
    workflows: { [DEPENDABOT_PATH]: DEPENDABOT_WORKFLOW },
  });
  assert.deepEqual(await sweepHeldRuns({}, f.ctx), [101, 102]);
  assert.match(f.logs[0], /deleted \(its job runs only for Dependabot\)/);
  assert.deepEqual(f.reads.workflows, [DEPENDABOT_PATH], 'the workflow file is read once per sweep');
});

test('a Dependabot Auto-Merge run is kept when the repository\'s workflow lost its guard or cannot be read', async () => {
  const unguarded = DEPENDABOT_WORKFLOW.replace("    if: github.actor == 'dependabot[bot]'\n", '');
  for (const [what, workflows] of Object.entries({
    'the guard is gone': { [DEPENDABOT_PATH]: unguarded },
    'the file cannot be read': { [DEPENDABOT_PATH]: new Error('HTTP 404') },
  })) {
    const f = fakeRuns([dependabotRun()], { prs: OPEN_AT_NEWEST, workflows });
    assert.deepEqual(await sweepHeldRuns({}, f.ctx), [], what);
    assert.deepEqual(f.deleted, [], what);
    assert.ok(f.logs.some((l) => /kept/.test(l)), `${what}: the sweep says why it kept the run`);
  }
});

test('a stale Dependabot run is still deleted when its workflow lost the guard: staleness does not depend on what it does', async () => {
  const unguarded = DEPENDABOT_WORKFLOW.replace("    if: github.actor == 'dependabot[bot]'\n", '');
  const f = fakeRuns([dependabotRun({ id: 5, head_sha: 'older' }), dependabotRun({ id: 6 })], { prs: OPEN_AT_NEWEST, workflows: { [DEPENDABOT_PATH]: unguarded } });
  assert.deepEqual(await sweepHeldRuns({}, f.ctx), [5], 'the run of the current head stays: it is the unguarded workflow that would really run');
});

test('doubt keeps the run: a pull request that cannot be read is reported, never deleted', async () => {
  const f = fakeRuns([pushRun({ id: 1, head_sha: 'older' }), pushRun({ id: 2, head_sha: 'older2' })], { prs: { 895: new Error('HTTP 403') } });
  assert.deepEqual(await sweepHeldRuns({}, f.ctx), []);
  assert.deepEqual(f.deleted, []);
  assert.deepEqual(f.reads.prs, [895], 'a failed lookup is remembered for the sweep');
  assert.match(f.logs[0], /^::warning::run 1 \(Frodo CLI Release Pipeline\): kept, pull request #895 could not be read: HTTP 403$/);
  assert.match(f.logs[1], /^::warning::run 2 /);
});

test('four pushes by the agent leave one run to approve: the pipeline run of the newest commit', async () => {
  const shas = ['sha1', 'sha2', 'sha3', 'newest0000000000000000000000000000000000'];
  const runs = shas.flatMap((sha, i) => [
    pushRun({ id: 10 + i * 2, head_sha: sha }),
    dependabotRun({ id: 11 + i * 2, head_sha: sha }),
  ]);
  const f = fakeRuns(runs, { prs: OPEN_AT_NEWEST, workflows: { [DEPENDABOT_PATH]: DEPENDABOT_WORKFLOW } });
  const deleted = await sweepHeldRuns({}, f.ctx);
  assert.deepEqual(deleted.sort((a, b) => a - b), [10, 11, 12, 13, 14, 15, 17]);
  assert.equal(deleted.includes(16), false, 'the pipeline run of the newest commit must survive');
  assert.deepEqual(f.reads.prs, [895], 'the pull request is read once for all eight runs');
});

test('a dry run says what it would delete for the new rules too, and deletes nothing', async () => {
  const f = fakeRuns([pushRun({ id: 1, head_sha: 'older' }), dependabotRun()], { prs: OPEN_AT_NEWEST, workflows: { [DEPENDABOT_PATH]: DEPENDABOT_WORKFLOW } });
  assert.deepEqual(await sweepHeldRuns({ dryRun: true }, f.ctx), [1, 101]);
  assert.deepEqual(f.deleted, []);
  assert.ok(f.logs.every((l) => /would delete/.test(l)));
});

test('a failed deletion of a stale run does not stop the others, and the sweep still fails', async () => {
  const f = fakeRuns([pushRun({ id: 1, head_sha: 'older' }), pushRun({ id: 2, head_sha: 'older2' })], { prs: OPEN_AT_NEWEST });
  f.failOn.add(1);
  await assert.rejects(sweepHeldRuns({}, f.ctx), /could not delete: run 1: boom/);
  assert.deepEqual(f.deleted, [2]);
});

test('only held runs of the coding agent are ever candidates', () => {
  assert.equal(isHeldByAgent(pushRun()), true);
  for (const extra of [{ actor: { login: 'vscheuber' } }, { actor: { login: 'dependabot[bot]' } }, { actor: null }, { status: 'in_progress' }, { conclusion: 'success' }]) {
    assert.equal(isHeldByAgent(pushRun(extra)), false, JSON.stringify(extra));
  }
});

test('--held-runs reads the pull request and the workflow once and deletes the stale runs (gh stubbed)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'janitor-gh-'));
  const log = path.join(dir, 'calls.log');
  const runs = [
    pushRun({ id: 21, head_sha: 'older' }),
    pushRun({ id: 22 }),
    dependabotRun({ id: 23 }),
    dependabotRun({ id: 24, head_sha: 'older' }),
    held({ id: 25 }),
  ];
  fs.writeFileSync(path.join(dir, 'runs.jsonl'), runs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'pr.json'), JSON.stringify({ state: 'open', head: { sha: 'newest0000000000000000000000000000000000' } }));
  fs.writeFileSync(path.join(dir, 'wf.b64'), Buffer.from(DEPENDABOT_WORKFLOW).toString('base64').replace(/(.{60})/g, '$1\n') + '\n');
  fs.writeFileSync(
    path.join(dir, 'gh'),
    [
      '#!/bin/sh',
      `echo "$*" >> '${log}'`,
      'case "$*" in',
      `  *"actions/runs?status=action_required&per_page=100"*) cat '${path.join(dir, 'runs.jsonl')}' ;;`,
      `  *"repos/o/r/pulls/895"*) cat '${path.join(dir, 'pr.json')}' ;;`,
      `  *"repos/o/r/contents/.github/workflows/dependabot-auto-merge.yml"*) cat '${path.join(dir, 'wf.b64')}' ;;`,
      '  *"--method DELETE"*"actions/runs/"*) ;;',
      '  *) echo "unexpected gh call: $*" >&2; exit 1 ;;',
      'esac',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  const script = fileURLToPath(new URL('./janitor.mjs', import.meta.url));
  const out = execFileSync('node', [script, '--held-runs'], {
    env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't' },
    encoding: 'utf8',
  });
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  const deletes = calls.filter((c) => c.includes('--method DELETE')).map((c) => c.match(/actions\/runs\/(\d+)/)[1]);
  assert.deepEqual(deletes.sort(), ['21', '23', '24', '25']);
  assert.equal(deletes.includes('22'), false, 'run 22, the pipeline run of the head, must stay');
  assert.equal(calls.filter((c) => /pulls\/895/.test(c)).length, 1, 'the pull request is read once');
  assert.equal(calls.filter((c) => /contents\//.test(c)).length, 1, 'the workflow file is read once');
  assert.match(out, /run 23 \(Dependabot Auto-Merge, pull_request by Copilot, .*\): deleted \(its job runs only for Dependabot\)/);
});

test('the docs state the rules the sweep depends on', () => {
  const doc = fs.readFileSync(new URL('../docs/multi-phase-design.md', import.meta.url), 'utf8');
  const held = doc.slice(doc.indexOf('## Held runs'), doc.indexOf('## Repository guidance')).replace(/\s+/g, ' ');
  assert.match(held, /the held run for the \*\*current head of an open pull request\*\* is never deleted, whatever the workflow/);
  assert.match(held, /Doubt never deletes/);
  assert.match(held, /only while the default branch's copy of that workflow still has a job-level `if: github\.actor == 'dependabot\[bot\]'` on every job/);
  assert.match(held, /`pull-requests: read`/);
});
