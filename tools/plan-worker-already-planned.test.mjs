import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The first end-to-end baseline of the sandbox (docs/e2e.md, 2026-10-27) had the reporter answer a plan with "Thanks,
// this is what I meant." The issue worker rightly wrote no second analysis, but it signalled as usual, issue triage
// handed the issue on again and the plan worker wrote a second plan (about 15 AIC, three times out of three), leaving
// two plans on one issue. The plan worker had no counterpart to the issue worker's "Already analysed" rule.
// The rule answers the hand-off with `plan-worker-ready` also when it writes no plan: see the test about the answer.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const prompt = fs.readFileSync(path.join(ROOT, 'workflows/plan-worker.md'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const section = (heading) => prompt.split(`\n## ${heading}\n`)[1].split('\n## ')[0];

test('the check comes first, before the plan contents and before any reading of code or guidance', () => {
  const headings = [...prompt.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.equal(headings[0], 'Already planned');
  assert.equal(headings[1], 'Plan contents');
  assert.match(section('Already planned'), /^Do this first, before you read any code, guidance file or decision record\./);
});

test('an earlier plan is told apart by its author and the marker, as plan triage does', () => {
  const planned = section('Already planned');
  assert.match(planned, /A plan of yours is a comment by `github-actions\[bot\]` whose body contains the text `gh-aw-workflow-call-id: owner\/repo\/plan-worker`/);
  assert.match(planned, /\(see "Identity of the plan comment"\)/);
});

test('a plan that still covers the issue gets no second plan, whatever a thanks, a link or a label does', () => {
  const planned = section('Already planned');
  assert.match(planned, /still covers the issue as it stands, write no second plan: it would cost as much as the first and leave two plans on one issue\./);
  assert.match(planned, /a comment that only thanks, links or notes something, a label change, an edit that fixes a typo\./);
});

test('a new plan is written for exactly three kinds of change, and it stands on its own', () => {
  const planned = section('Already planned');
  assert.match(planned, /Write a new plan only when something changed that the plan did not account for: the issue was edited with new facts, someone answered a question that the plan or the analysis raised, or someone asked in a comment for a new or a different plan\./);
  assert.match(planned, /A new plan stands on its own, because plan triage reads a plan and not a difference\./);
});

// The first live run of the rule on a plan that waits for approval (frodo-lib#754, 2026-11-04) ended in `noop`, because the
// issue was classified. Nothing answered the hand-off, the options comment stayed away for the whole time a plan is
// taken to be owed, and the maintainer was left without `/approve` and `/replan` on an issue that waited for them.
test('a plan that stands is not repeated, and the hand-off is answered with plan-worker-ready all the same', () => {
  const planned = section('Already planned');
  assert.match(planned, /When the plan stands, post no comment and answer the hand-off all the same: add `plan-worker-ready` \(see "Identity of the plan comment"\), as you do for a new plan, so that plan triage classifies the plan that is there\./);
  assert.match(planned, /Do not call `noop` for this\. The label is the answer to the hand-off, and an issue whose hand-off is never answered is taken to wait for a plan\./);
  assert.doesNotMatch(planned, /Add no label/);
  assert.doesNotMatch(planned, /complexity\/\*|risk\/\*/, 'the answer does not depend on whether plan triage classified the plan');
});

test('the rule changes no gate: the label allow-list stays plan-worker-ready only, and the comment cap stays one', () => {
  const source = fs.readFileSync(path.join(ROOT, 'workflows/plan-worker.md'), 'utf8');
  const frontmatter = source.split('\n---\n')[0];
  assert.match(frontmatter, /add-comment:\n    max: 1\n/);
  assert.match(frontmatter, /allowed:\n      - plan-worker-ready\n    max: 1\n/);
  assert.doesNotMatch(section('Already planned'), /plan-triage-handoff|plan-approval-required|issue-triage-handoff/);
});
