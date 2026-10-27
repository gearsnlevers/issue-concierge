import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The first end-to-end run of the sandbox (docs/e2e.md, 2026-10-27) filed a request that the project's scope excludes.
// The issue worker posted the decline and then wrote "I'm not adding `issue-worker-ready`, since the work is not to
// be done here": it read the signal as a judgement. Issue triage never ran, so nothing labelled the issue
// `out-of-scope` or closed it. Only the stalled-issue sweep would have, after at least half an hour.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const prompt = fs.readFileSync(path.join(ROOT, 'workflows/issue-worker.md'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const section = (heading) => prompt.split(`\n## ${heading}\n`)[1].split('\n## ')[0];

test('the signal goes on whatever the analysis concludes, out of scope included', () => {
  const signaling = section('Signaling (internal)');
  assert.match(signaling, /add `issue-worker-ready`[^\n]*It goes on whatever your analysis concludes: the request is complete, it needs more details, it is out of scope, it duplicates another issue or it is already fixed\./);
});

test('the signal says what happens without it, so that withholding it is not a choice', () => {
  const signaling = section('Signaling (internal)');
  assert.match(signaling, /Issue triage reads your comment and decides what becomes of the issue \(`needs-info`, `out-of-scope` and the close, `duplicate`, `already-fixed`\); without the label it never runs, and the issue stays open with nothing on it\./);
  assert.match(signaling, /"The work is not to be done here" is a reason to say so in the comment, never a reason to withhold the label\./);
});

test('the out-of-scope decision in the scope check points at the signal', () => {
  const scope = section('Scope');
  assert.match(scope, /Say nothing about work being planned\. The label `issue-worker-ready` still goes on \(see "Signaling"\): issue triage reads this comment, labels the issue `out-of-scope` and closes it, and without the label nothing does\./);
});

test('the exceptions to the signal stay exactly two: a fix already in review, and a linked canonical issue', () => {
  const signaling = section('Signaling (internal)');
  assert.deepEqual(
    [...signaling.matchAll(/^- (If [^,:]*)/gm)].map((m) => m[1]),
    ['If the issue stays here', 'If an open pull request already closes the issue (see "A fix is already in review")', 'If you created or confirmed a linked canonical issue'],
  );
  assert.match(signaling, /add no label at all, not even `issue-worker-ready`/);
  assert.match(signaling, /do \*\*not\*\* add `issue-worker-ready`/);
});
