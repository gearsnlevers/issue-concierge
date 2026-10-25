import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, resume, isBot, isClassified, MARKER } from './plan-approval-resume.mjs';

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

test('needs a classified plan: a hand-applied approval label on an unclassified issue does not count', () => {
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

// ---- a hold put on by hand: any classified plan can be approved ---------------------------------

test('isClassified needs one complexity label and one risk label, whatever their values', () => {
  assert.equal(isClassified(new Set(['complexity/low', 'risk/low'])), true);
  assert.equal(isClassified(new Set(['complexity/high', 'risk/medium'])), true);
  assert.equal(isClassified(new Set(['complexity/medium'])), false);
  assert.equal(isClassified(new Set(['risk/medium'])), false);
  assert.equal(isClassified(new Set(['bug', 'plan-approval-required'])), false);
  assert.equal(isClassified(new Set()), false);
});

test('removing a hand-added hold hands a classified low or medium issue on (cli#885: low and medium)', () => {
  for (const labels of [
    ['complexity/low', 'risk/medium'],
    ['complexity/medium', 'risk/medium'],
    ['complexity/low', 'risk/low'],
    ['complexity/medium', 'risk/low'],
  ]) {
    assert.deepEqual(decide(issue(['bug', ...labels]), 'plan-approval-required', 'maintainer'), {
      handoff: true,
      reason: 'approval removed',
    }, labels.join(' '));
  }
});

test('an issue plan triage has not classified is not resumed: that is plan triage\'s to do', () => {
  for (const labels of [[], ['bug'], ['complexity/low'], ['complexity/medium'], ['risk/low'], ['risk/medium']]) {
    const v = decide(issue(labels), 'plan-approval-required', 'maintainer');
    assert.equal(v.handoff, false, labels.join(' ') || '(no labels)');
    assert.match(v.reason, /plan triage has not classified the issue yet/);
  }
});

test('a classified low or medium issue is still left alone for a bot remover, a dependency, a hand-off or an agent', () => {
  const base = ['complexity/low', 'risk/medium'];
  assert.equal(decide(issue(base), 'plan-approval-required', 'github-actions[bot]').handoff, false);
  assert.equal(decide(issue([...base, 'dependency-required']), 'plan-approval-required', 'maintainer').handoff, false);
  assert.equal(decide(issue([...base, 'plan-triage-handoff']), 'plan-approval-required', 'maintainer').handoff, false);
  assert.equal(decide(issue(base, { assignees: [{ login: 'Copilot' }] }), 'plan-approval-required', 'maintainer').handoff, false);
  assert.equal(decide(issue(base, { state: 'closed' }), 'plan-approval-required', 'maintainer').handoff, false);
  assert.equal(decide(issue(base, { pull_request: {} }), 'plan-approval-required', 'maintainer').handoff, false);
  // the hold re-added, or an unrelated label removed
  assert.equal(decide(issue([...base, 'plan-approval-required']), 'plan-approval-required', 'maintainer').handoff, false);
  assert.equal(decide(issue(base), 'backlog', 'maintainer').handoff, false);
});

test('resume applies the handoff label exactly once for a classified medium issue', () => {
  const calls = [];
  const ctx = { removedLabel: 'plan-approval-required', actor: 'maintainer', addLabel: (l) => calls.push(['label', l]), comment: (b) => calls.push(['comment', b]) };
  const v = resume(issue(['complexity/medium', 'risk/medium']), ctx);
  assert.equal(v.handoff, true);
  assert.deepEqual(calls[0], ['label', 'plan-triage-handoff']);
  assert.equal(calls.length, 2);
  calls.length = 0;
  resume(issue(['complexity/medium']), ctx);
  assert.deepEqual(calls, [], 'a plan with only a complexity label is not classified');
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

// An issue that carries no-auto-processing is never handed to the PR gate, whoever removes the hold
// (https://github.com/vscheuber/repo-concierge/blob/main/docs/decisions/0028-an-item-labelled-no-auto-processing-is-never-touched.md).
test('an opted-out issue is not handed off, and nothing is written to it', () => {
  const labelled = issue(['complexity/high', 'risk/high', 'no-auto-processing']);
  const v = decide(labelled, 'plan-approval-required', 'a-maintainer');
  assert.equal(v.handoff, false);
  assert.match(v.reason, /carries no-auto-processing/);
  const calls = [];
  const out = resume(labelled, { removedLabel: 'plan-approval-required', actor: 'a-maintainer', addLabel: (l) => calls.push(['label', l]), comment: (b) => calls.push(['comment', b]) });
  assert.equal(out.handoff, false);
  assert.deepEqual(calls, []);
  // the control: without the label the same removal hands the issue on
  assert.equal(decide(issue(['complexity/high', 'risk/high']), 'plan-approval-required', 'a-maintainer').handoff, true);
});
