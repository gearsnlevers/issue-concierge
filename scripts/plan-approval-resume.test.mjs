import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, resume, isBot, MARKER } from './plan-approval-resume.mjs';

const issue = (labels, extra = {}) => ({ state: 'open', labels: labels.map((name) => ({ name })), ...extra });

test('hands off a high-complexity issue once the approval label is gone', () => {
  assert.deepEqual(decide(issue(['complexity/high', 'risk/high']), 'plan-approval-required'), {
    handoff: true,
    reason: 'approval removed',
  });
});

test('a manual run needs the approval label to be absent', () => {
  assert.equal(decide(issue(['complexity/high'])).handoff, true);
  assert.equal(decide(issue(['complexity/high', 'plan-approval-required'])).handoff, false);
});

test('ignores the removal of any other label', () => {
  const v = decide(issue(['complexity/high']), 'backlog');
  assert.equal(v.handoff, false);
  assert.match(v.reason, /unrelated/);
});

test('never hands off when approval is still required (label re-added)', () => {
  assert.equal(decide(issue(['complexity/high', 'plan-approval-required']), 'plan-approval-required').handoff, false);
});

test('needs a high-complexity plan: a hand-applied approval label alone does not count', () => {
  assert.equal(decide(issue(['complexity/low']), 'plan-approval-required').handoff, false);
  assert.equal(decide(issue([]), 'plan-approval-required').handoff, false);
});

test('waits while a dependency is unfinished', () => {
  assert.equal(decide(issue(['complexity/high', 'dependency-required']), 'plan-approval-required').handoff, false);
});

test('does not hand off twice', () => {
  assert.equal(decide(issue(['complexity/high', 'plan-triage-handoff']), 'plan-approval-required').handoff, false);
});

test('does not hand off again once the coding agent is assigned, even though the hand-off label is gone', () => {
  const v = decide(issue(['complexity/high'], { assignees: [{ login: 'vscheuber' }, { login: 'Copilot' }] }), 'plan-approval-required');
  assert.deepEqual(v, { handoff: false, reason: 'already handed off' });
  // A human assignee alone is not a hand-off.
  assert.equal(decide(issue(['complexity/high'], { assignees: [{ login: 'vscheuber' }] }), 'plan-approval-required').handoff, true);
});

test('skips closed issues and pull requests', () => {
  assert.equal(decide(issue(['complexity/high'], { state: 'closed' }), 'plan-approval-required').handoff, false);
  assert.equal(decide(issue(['complexity/high'], { pull_request: {} }), 'plan-approval-required').handoff, false);
});

test('resume applies the handoff label and comments exactly once', () => {
  const calls = [];
  const ctx = {
    removedLabel: 'plan-approval-required',
    actor: 'maintainer',
    addLabel: (l) => calls.push(['label', l]),
    comment: (b) => calls.push(['comment', b]),
  };
  const v = resume(issue(['complexity/high']), ctx);
  assert.equal(v.handoff, true);
  assert.deepEqual(calls[0], ['label', 'plan-triage-handoff']);
  assert.equal(calls.length, 2);
  assert.ok(calls[1][1].startsWith(MARKER));
  assert.match(calls[1][1], /@maintainer/);
});

test('resume changes nothing when skipped or in a dry run', () => {
  const calls = [];
  const ctx = { addLabel: (l) => calls.push(l), comment: (b) => calls.push(b) };
  resume(issue(['complexity/low']), { ...ctx, removedLabel: 'plan-approval-required' });
  resume(issue(['complexity/high']), { ...ctx, removedLabel: 'plan-approval-required', dryRun: true });
  assert.deepEqual(calls, []);
});

// ---- high risk: the same approval gate as high complexity -------------------------------------

test('hands off a high-risk issue once the approval label is gone, whatever its complexity', () => {
  assert.deepEqual(decide(issue(['complexity/low', 'risk/high']), 'plan-approval-required'), {
    handoff: true,
    reason: 'approval removed',
  });
  assert.equal(decide(issue(['complexity/medium', 'risk/high']), 'plan-approval-required').handoff, true);
});

test('high risk: a manual run needs the approval label to be absent', () => {
  assert.equal(decide(issue(['complexity/low', 'risk/high'])).handoff, true);
  assert.equal(decide(issue(['complexity/low', 'risk/high', 'plan-approval-required'])).handoff, false);
});

test('high risk: never hands off when approval is still required (label re-added)', () => {
  assert.equal(decide(issue(['complexity/low', 'risk/high', 'plan-approval-required']), 'plan-approval-required').handoff, false);
});

test('medium complexity and medium risk alone are not a plan to approve', () => {
  const v = decide(issue(['complexity/medium', 'risk/medium']), 'plan-approval-required');
  assert.equal(v.handoff, false);
  assert.match(v.reason, /no high-complexity or high-risk plan/);
  assert.equal(decide(issue(['complexity/low', 'risk/low']), 'plan-approval-required').handoff, false);
});

test('high risk: waits while a dependency is unfinished', () => {
  assert.equal(decide(issue(['complexity/low', 'risk/high', 'dependency-required']), 'plan-approval-required').handoff, false);
});

test('high risk: does not hand off twice, nor once the coding agent is assigned', () => {
  assert.equal(decide(issue(['complexity/low', 'risk/high', 'plan-triage-handoff']), 'plan-approval-required').handoff, false);
  const v = decide(issue(['complexity/low', 'risk/high'], { assignees: [{ login: 'Copilot' }] }), 'plan-approval-required');
  assert.deepEqual(v, { handoff: false, reason: 'already handed off' });
});

test('high risk: skips closed issues and pull requests', () => {
  assert.equal(decide(issue(['risk/high'], { state: 'closed' }), 'plan-approval-required').handoff, false);
  assert.equal(decide(issue(['risk/high'], { pull_request: {} }), 'plan-approval-required').handoff, false);
});

// ---- who removed the label ---------------------------------------------------------------------

test('a bot removing the approval label is not an approval (also for a coding-agent account)', () => {
  for (const actor of ['github-actions[bot]', 'dependabot[bot]', 'copilot-swe-agent[bot]', 'Copilot']) {
    for (const labels of [['complexity/high'], ['complexity/low', 'risk/high']]) {
      const v = decide(issue(labels), 'plan-approval-required', actor);
      assert.equal(v.handoff, false, `${actor} with ${labels}`);
      assert.match(v.reason, /removed by a bot/);
    }
  }
});

test('a person removing the label approves; so does an unknown remover (a manual run keeps working)', () => {
  assert.equal(decide(issue(['complexity/low', 'risk/high']), 'plan-approval-required', 'maintainer').handoff, true);
  assert.equal(decide(issue(['complexity/high']), 'plan-approval-required', 'maintainer').handoff, true);
  assert.equal(decide(issue(['complexity/high']), 'plan-approval-required', undefined).handoff, true);
});

test('isBot recognizes bot accounts and the coding agent, and nothing else', () => {
  assert.equal(isBot('github-actions[bot]'), true);
  assert.equal(isBot('Copilot'), true);
  assert.equal(isBot('vscheuber'), false);
  assert.equal(isBot(undefined), false);
  assert.equal(isBot(''), false);
});

test('resume hands a high-risk issue off exactly once, and does nothing for a bot remover', () => {
  const calls = [];
  const ctx = {
    removedLabel: 'plan-approval-required',
    addLabel: (l) => calls.push(['label', l]),
    comment: (b) => calls.push(['comment', b]),
  };
  const v = resume(issue(['complexity/low', 'risk/high']), { ...ctx, actor: 'maintainer' });
  assert.equal(v.handoff, true);
  assert.deepEqual(calls[0], ['label', 'plan-triage-handoff']);
  assert.equal(calls.length, 2);
  calls.length = 0;
  resume(issue(['complexity/low', 'risk/high']), { ...ctx, actor: 'github-actions[bot]' });
  assert.deepEqual(calls, []);
});
