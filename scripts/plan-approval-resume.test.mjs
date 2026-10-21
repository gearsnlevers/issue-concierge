import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, resume, MARKER } from './plan-approval-resume.mjs';

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
