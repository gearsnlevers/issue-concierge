import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decide, run, LABEL } from './pr-ready-signal.mjs';

const pr = (extra = {}) => ({ number: 7, state: 'open', merged: false, user: { login: 'Copilot' }, labels: [], ...extra });

// ------------------------------------------------------------------ decide

test('each automatic trigger adds the label to an open coding agent pull request', () => {
  assert.deepEqual(decide({ pr: pr(), trigger: 'review_requested', sender: 'Copilot' }), { add: true, reason: 'review_requested' });
  assert.deepEqual(decide({ pr: pr(), trigger: 'agent_run', conclusion: 'success' }), { add: true, reason: 'agent_run' });
  assert.deepEqual(decide({ pr: pr(), trigger: 'ready_for_review', sender: 'vscheuber' }), { add: true, reason: 'ready_for_review' });
  assert.deepEqual(decide({ pr: pr(), trigger: 'manual' }), { add: true, reason: 'manual' });
});

test('the label is added once: an existing label means nothing to do', () => {
  const v = decide({ pr: pr({ labels: [{ name: LABEL }] }), trigger: 'review_requested', sender: 'Copilot' });
  assert.deepEqual(v, { add: false, reason: 'already signalled' });
});

test('only the coding agent can ask for review in a way that counts', () => {
  for (const sender of ['vscheuber', '', undefined]) {
    assert.equal(decide({ pr: pr(), trigger: 'review_requested', sender }).add, false, String(sender));
  }
  assert.equal(decide({ pr: pr(), trigger: 'review_requested', sender: 'copilot-swe-agent[bot]' }).add, true);
});

test('a run that did not succeed signals nothing', () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', '', undefined]) {
    assert.equal(decide({ pr: pr(), trigger: 'agent_run', conclusion }).add, false, String(conclusion));
  }
});

test('pull requests that are not the coding agent\'s, or are not open, are left alone', () => {
  assert.equal(decide({ pr: pr({ user: { login: 'vscheuber' } }), trigger: 'ready_for_review' }).add, false);
  assert.equal(decide({ pr: pr({ user: { login: 'dependabot[bot]' } }), trigger: 'manual' }).add, false);
  assert.equal(decide({ pr: pr({ state: 'closed' }), trigger: 'manual' }).add, false);
  assert.equal(decide({ pr: pr({ merged: true, state: 'closed' }), trigger: 'manual' }).add, false);
  assert.deepEqual(decide({ pr: null, trigger: 'agent_run', conclusion: 'success' }), { add: false, reason: 'no pull request found' });
});

// --------------------------------------------------------------------- run

function fake(opts = {}) {
  const calls = { added: [], logs: [], byNumber: [], byBranch: [] };
  return {
    calls,
    ctx: {
      getPull: async (n) => (calls.byNumber.push(n), opts.pr === undefined ? pr({ number: n }) : opts.pr),
      pullForBranch: async (b) => (calls.byBranch.push(b), opts.pr === undefined ? pr() : opts.pr),
      addLabel: async (n) => calls.added.push(n),
      log: (l) => calls.logs.push(l),
    },
  };
}

test('run labels the pull request it was given and says which trigger did it', async () => {
  const f = fake();
  const v = await run({ number: 12, trigger: 'review_requested', sender: 'Copilot' }, f.ctx);
  assert.deepEqual(f.calls.added, [12]);
  assert.equal(v.add, true);
  assert.match(f.calls.logs[0], /#12: added pr-worker-ready \(review_requested; trigger review_requested\)/);
});

test('run finds the pull request from the branch when a finished run does not name one', async () => {
  const f = fake();
  await run({ number: 0, branch: 'copilot/use-frodo-facade', trigger: 'agent_run', conclusion: 'success' }, f.ctx);
  assert.deepEqual(f.calls.byBranch, ['copilot/use-frodo-facade']);
  assert.deepEqual(f.calls.added, [7]);
});

test('run does nothing when there is nothing to add, or in a dry run', async () => {
  const skipped = fake({ pr: pr({ labels: [{ name: LABEL }] }) });
  await run({ number: 7, trigger: 'manual' }, skipped.ctx);
  assert.deepEqual(skipped.calls.added, []);
  assert.match(skipped.calls.logs[0], /skipped/);

  const dry = fake();
  await run({ number: 7, trigger: 'manual', dryRun: true }, dry.ctx);
  assert.deepEqual(dry.calls.added, []);
  assert.match(dry.calls.logs[0], /would add/);

  const none = fake({ pr: null });
  assert.equal((await run({ branch: 'copilot/x', trigger: 'agent_run', conclusion: 'success' }, none.ctx)).add, false);
});

// ----------------------------------------------------------- the workflow

const yml = () => fs.readFileSync(new URL('../workflows/pr-ready-signal.yml', import.meta.url), 'utf8');
const code = () => yml().replace(/^#.*$/gm, '');

test('the workflow has the three automatic triggers and a manual one', () => {
  const y = code();
  assert.match(y, /pull_request_target:\s*\n\s*types: \[review_requested, ready_for_review\]/);
  assert.match(y, /workflow_run:\s*\n\s*workflows: \["Running Copilot cloud agent"\]/);
  assert.match(y, /workflow_dispatch:/);
});

test('the label goes on with the signal token, which is how PR triage starts', () => {
  const y = code();
  assert.match(y, /SIGNAL_TOKEN: \$\{\{ secrets\.SIGNAL_TOKEN \}\}/);
  assert.match(y, /node \.github\/scripts\/pr-ready-signal\.mjs/);
});

test('a review request starts the job only when the coding agent made it', () => {
  assert.match(code(), /github\.event\.action != 'review_requested'[\s\S]*startsWith\(github\.event\.sender\.login, 'copilot'\)/);
});

test('the trigger name the workflow passes is one the script understands', () => {
  // review_requested and ready_for_review come straight from github.event.action; the others are mapped.
  const y = code();
  assert.match(y, /workflow_run' && 'agent_run'/);
  assert.match(y, /workflow_dispatch' && 'manual'/);
  assert.match(y, /\|\| github\.event\.action/);
});
