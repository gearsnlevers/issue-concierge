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

function fakeRuns(runs) {
  const deleted = [];
  const logs = [];
  const failOn = new Set();
  return {
    deleted,
    logs,
    failOn,
    ctx: {
      listHeldRuns: async () => runs,
      deleteRun: async (id) => {
        if (failOn.has(id)) throw new Error('boom');
        deleted.push(id);
      },
      log: (line) => logs.push(line),
    },
  };
}

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

test('the disposable workflow is the Issue Worker lock file that gh-aw generates', () => {
  assert.deepEqual(DISPOSABLE_HELD_RUNS, [{ path: '.github/workflows/issue-worker.lock.yml', event: 'issue_comment' }]);
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
  assert.match(job, /permissions:\n\s+contents: read\n\s+actions: write/);
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
