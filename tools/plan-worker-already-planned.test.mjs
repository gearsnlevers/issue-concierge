import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The first end-to-end baseline of the sandbox (docs/e2e.md, 2026-10-27) had the reporter answer a plan with "Thanks,
// this is what I meant." The issue worker rightly wrote no second analysis, but it signalled as usual, issue triage
// handed the issue on again and the plan worker wrote a second plan (about 15 AIC, three times out of three), leaving
// two plans on one issue. The plan worker had no counterpart to the issue worker's "Already analysed" rule.
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

test('a plan that stands is not repeated, and the hand-off is given again only when plan triage never classified it', () => {
  const planned = section('Already planned');
  assert.match(planned, /When the plan stands, post no comment\./);
  assert.match(planned, /- The issue has a `complexity\/\*` label and a `risk\/\*` label: plan triage has classified that plan\. Add no label and call `noop` with a one-line reason\./);
  assert.match(planned, /- It has not: the hand-off after the plan was lost\. Add `plan-worker-ready` \(see "Identity of the plan comment"\), so that plan triage classifies the plan that is there\./);
});

test('the rule changes no gate: the label allow-list stays plan-worker-ready only, and the comment cap stays one', () => {
  const source = fs.readFileSync(path.join(ROOT, 'workflows/plan-worker.md'), 'utf8');
  const frontmatter = source.split('\n---\n')[0];
  assert.match(frontmatter, /add-comment:\n    max: 1\n/);
  assert.match(frontmatter, /allowed:\n      - plan-worker-ready\n    max: 1\n/);
  assert.doesNotMatch(section('Already planned'), /plan-triage-handoff|plan-approval-required|issue-triage-handoff/);
});
