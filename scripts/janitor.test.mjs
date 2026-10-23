import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { staleLabels, isCodingAgent, run, TRIGGER_LABELS, GATE, TRIAGE_OUTCOMES, OPEN_WORK_STATE } from './janitor.mjs';

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
