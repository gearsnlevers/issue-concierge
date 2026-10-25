import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, holds, frontmatterIf, jobIf, stepIf, read } from './workflow-condition.mjs';

// The evaluator in tools/workflow-condition.mjs is test support: tools/opt-out.test.mjs uses it to say what a
// workflow condition does for an event. These tests pin the parts of GitHub's expression semantics that the
// conditions rely on, and that the evaluator must not get wrong.

const issue = (labels, extra = {}) => ({ github: { event_name: 'issues', event: { action: 'labeled', issue: { state: 'open', labels: labels.map((name) => ({ name })), ...extra }, label: { name: 'x' } } } });

test('a path with .* reads one property of every item, and contains() looks through it', () => {
  const ctx = issue(['bug', 'No-Auto-Processing']);
  assert.deepEqual(evaluate('github.event.issue.labels.*.name', ctx), ['bug', 'No-Auto-Processing']);
  assert.equal(evaluate("contains(github.event.issue.labels.*.name, 'no-auto-processing')", ctx), true, 'case does not matter');
  assert.equal(evaluate("contains(github.event.issue.labels.*.name, 'auto')", ctx), false, 'a label name is matched whole, not as a substring');
});

test('an absent context reads as null all the way down, as in a workflow_dispatch', () => {
  const ctx = { github: { event_name: 'workflow_dispatch', event: { inputs: {} } } };
  assert.equal(evaluate('github.event.issue.state', ctx), null);
  assert.equal(holds("!contains(github.event.issue.labels.*.name, 'x')", ctx), true);
  assert.equal(holds("github.event.issue.pull_request == null", ctx), true);
  assert.equal(holds("github.event.issue.user.type != 'Bot'", ctx), true);
});

test('strings compare without regard to case, and null equals an empty string', () => {
  assert.equal(holds("'Bot' == 'bot'", {}), true);
  assert.equal(holds("github.event.x == ''", { github: { event: {} } }), true);
  assert.equal(holds("'a' != 'b'", {}), true);
});

test('&& and || return an operand, and a condition is cast to a boolean', () => {
  assert.equal(evaluate("'a' && 'b'", {}), 'b');
  assert.equal(evaluate("'' || 'b'", {}), 'b');
  assert.equal(evaluate("false || null", {}), null);
  assert.equal(holds("(true || false) && !false", {}), true);
  assert.equal(holds("true && (false || false)", {}), false);
});

test('fromJSON feeds contains, and ${{ }} around an expression is accepted', () => {
  assert.equal(holds("${{ contains(fromJSON('[\"a\",\"b\"]'), github.event.label.name) }}", { github: { event: { label: { name: 'b' } } } }), true);
  assert.equal(holds("contains(fromJSON('[\"a\",\"b\"]'), 'c')", {}), false);
});

test('a feature the evaluator does not know throws instead of guessing', () => {
  assert.throws(() => evaluate("format('{0}', 1)", {}), /unsupported function/);
  assert.throws(() => evaluate('a ?? b', {}));
  assert.throws(() => evaluate('(true', {}));
});

test('the extraction helpers read single-line and folded conditions of the real workflows', () => {
  const worker = frontmatterIf(read('workflows/issue-worker.md'));
  assert.match(worker, /^\$\{\{.*github\.event\.issue\.pull_request == null/, 'single line, with its ${{ }}');
  const prWorker = frontmatterIf(read('workflows/pr-worker.md'));
  assert.match(prWorker, /existing_fix_result != 'failure'/, 'folded block, joined into one line');
  assert.match(jobIf(read('workflows/janitor.yml'), 'clean'), /github\.event\.action != 'labeled'/);
  assert.match(stepIf(read('workflows/pr-worker.md'), 'existing_fix'), /^github\.event\.label\.name == 'plan-triage-handoff'/);
  assert.throws(() => jobIf(read('workflows/janitor.yml'), 'nope'), /no job/);
});
