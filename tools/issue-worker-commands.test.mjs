import test from 'node:test';
import assert from 'node:assert/strict';
import { holds, frontmatterIf, read } from './workflow-condition.mjs';
import { COMMAND_NAMES, parseCommand } from '../scripts/commands.mjs';

// The soak of v2.0.0-1 (docs/e2e.md): a maintainer's `/accept` started an issue worker run of its own, nine minutes long,
// next to the one a reporter's reply had started a minute before. The hand-over to the plan worker went ahead, and when a
// worker run finished after it, issue triage put `needs-decision` back on a request that was being planned. A comment
// that starts with a command is not a reply from the reporter, so it starts no run. These tests evaluate the real
// condition of workflows/issue-worker.md, with the commands taken from the parser, not from a copy of the list.

const condition = frontmatterIf(read('workflows/issue-worker.md'));
const issue = { state: 'open', labels: [{ name: 'enhancement' }, { name: 'needs-decision' }], user: { type: 'User' }, pull_request: null };
const commentOn = (body, user = { type: 'User' }) => ({ name: 'issue_comment', payload: { action: 'created', issue, comment: { user, body } } });
const runs = (event) => holds(condition, { vars: {}, github: { event_name: event.name, event: event.payload }, needs: {} });

test('a comment that starts with a command starts no run, whichever command, in any case, with or without a reason', () => {
  assert.ok(COMMAND_NAMES.length >= 6);
  for (const name of COMMAND_NAMES) {
    for (const body of [`/${name}`, `/${name.toUpperCase()}`, `/${name} the reason is on the line`, `/${name}\nand a second line`]) {
      assert.equal(parseCommand(body)?.name, name, `the parser reads ${JSON.stringify(body)} as a command`);
      assert.equal(runs(commentOn(body)), false, `${JSON.stringify(body)} is a command and starts nothing`);
    }
  }
});

test('the commands the condition names are exactly the ones the parser knows', () => {
  const named = [...condition.matchAll(/startsWith\(github\.event\.comment\.body, '\/([a-z]+)'\)/g)].map((m) => m[1]);
  assert.deepEqual([...named].sort(), [...COMMAND_NAMES].sort(), 'a command added to the parser must be skipped here too');
});

test('a reporter\'s reply still starts the worker, also when it mentions a command somewhere else', () => {
  for (const body of [
    'Thanks, I would like to understand what depends on it first.',
    'Please accept my report.',
    'I tried /accept in another project and it did nothing.',
    '> /accept\nWhat does this mean?',
    'The /retry command is nice.',
  ]) {
    assert.equal(parseCommand(body), null, `${JSON.stringify(body)} is not a command`);
    assert.equal(runs(commentOn(body)), true, `${JSON.stringify(body)} is a reply`);
  }
});

test('only a comment is skipped: opening, editing and handing back an issue, or a manual run, are not', () => {
  const asIssueEvent = (action, extra = {}) => ({ name: 'issues', payload: { action, issue: { ...issue, labels: [{ name: 'enhancement' }], body: '/accept', ...extra }, label: { name: 'no-auto-processing' } } });
  for (const action of ['opened', 'reopened', 'edited']) assert.equal(runs(asIssueEvent(action)), true, action);
  assert.equal(runs({ name: 'workflow_dispatch', payload: { inputs: {} } }), true);
});

test('the other conditions are untouched: a bot\'s comment, a closed issue, an opted-out issue and a pull request still start nothing', () => {
  assert.equal(runs(commentOn('Thanks', { type: 'Bot' })), false);
  assert.equal(runs({ name: 'issue_comment', payload: { action: 'created', issue: { ...issue, state: 'closed' }, comment: { user: { type: 'User' }, body: 'Thanks' } } }), false);
  assert.equal(runs({ name: 'issue_comment', payload: { action: 'created', issue: { ...issue, labels: [{ name: 'no-auto-processing' }] }, comment: { user: { type: 'User' }, body: 'Thanks' } } }), false);
  assert.equal(runs({ name: 'issue_comment', payload: { action: 'created', issue: { ...issue, pull_request: {} }, comment: { user: { type: 'User' }, body: 'Thanks' } } }), false);
});
