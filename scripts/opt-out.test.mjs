import test from 'node:test';
import assert from 'node:assert/strict';
import { LABEL_OPT_OUT, labelNames, isOptedOut, optedOutReason } from './opt-out.mjs';

// The label module every script uses to leave an opted-out item alone. The decision and why it exists:
// https://github.com/gearsnlevers/issue-concierge/blob/main/docs/decisions/0028-an-item-labelled-no-auto-processing-is-never-touched.md
// What each script does with it is pinned next to the script; tools/opt-out.test.mjs pins the workflows.

test('the label is no-auto-processing, a name no gate label can be mistaken for', () => {
  assert.equal(LABEL_OPT_OUT, 'no-auto-processing');
});

test('labelNames reads API objects and plain strings, and survives a missing list', () => {
  assert.deepEqual(labelNames({ labels: [{ name: 'a' }, 'b', null, {}, { name: '' }] }), ['a', 'b']);
  assert.deepEqual(labelNames({}), []);
  assert.deepEqual(labelNames(null), []);
  assert.deepEqual(labelNames(undefined), []);
});

test('an item is opted out only when the exact label is on it', () => {
  assert.equal(isOptedOut({ labels: [{ name: 'bug' }, { name: LABEL_OPT_OUT }] }), true);
  assert.equal(isOptedOut({ labels: [LABEL_OPT_OUT] }), true);
  assert.equal(isOptedOut({ labels: [{ name: 'bug' }] }), false);
  assert.equal(isOptedOut({ labels: [{ name: 'no-auto-processing-yet' }, { name: 'auto-processing' }] }), false, 'a label that merely contains the name does not count');
  assert.equal(isOptedOut({ labels: [{ name: 'No-Auto-Processing' }] }), false, 'GitHub label names are matched as written here; the label is created in lower case');
  assert.equal(isOptedOut({}), false);
  assert.equal(isOptedOut(null), false);
});

test('the reason every script logs names the label and the kind of item', () => {
  assert.equal(optedOutReason('issue'), 'the issue carries no-auto-processing: the Concierge does not touch it');
  assert.match(optedOutReason('pull request'), /^the pull request carries no-auto-processing/);
  assert.match(optedOutReason(), /^the item carries no-auto-processing/);
});
