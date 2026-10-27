import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// In the first end-to-end baseline of the sandbox (docs/e2e.md, 2026-10-27) every issue was filed with the hold
// `plan-approval-required`, so that no code is written. On one of six runs issue triage (model `small`) ended in a
// `noop`: "The issue no longer carries `issue-worker-ready` ... and it already has `plan-approval-required`, which means
// it has moved past triage." It had neither the trigger label, which the janitor takes away within seconds on a held
// issue, nor the hand-off, and nothing said so: the issue sat for 35 minutes. Plan triage already has a section for a
// hold set by hand ("A hold that is already there"); issue triage had none.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const prompt = fs.readFileSync(path.join(ROOT, 'workflows/issue-triage.md'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const section = (heading) => prompt.split(`\n## ${heading}\n`)[1].split('\n## ')[0];

test('the section exists and comes before the outcomes, so the model reads it before deciding to do nothing', () => {
  const headings = [...prompt.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.ok(headings.indexOf('A hold that is already there') > -1);
  assert.ok(headings.indexOf('A hold that is already there') < headings.indexOf('Internal labels (never mentioned to the reporter)'));
});

test('the hold is not a sign that triage is done: it stops the issue after the plan', () => {
  const hold = section('A hold that is already there');
  assert.match(hold, /`plan-approval-required` is not a sign that triage is done\./);
  assert.match(hold, /the hold stops the issue after the plan, not before triage\./);
  assert.match(hold, /Triage the issue as usual, apply the outcome labels, and emit `issue-triage-handoff` when it is complete and worth doing\./);
});

test('lifting the hold stays with the maintainer', () => {
  const hold = section('A hold that is already there');
  assert.match(hold, /Plan triage keeps the hold, and removing it is the maintainer's decision, not yours\./);
  assert.doesNotMatch(hold, /\b(add|adds|apply|applies|remove|removes|lift|lifts)\b[^.\n]*`plan-approval-required`/i);
});

test('a missing trigger label is explained: the janitor takes it away within seconds on a held issue', () => {
  const hold = section('A hold that is already there');
  assert.match(hold, /When the issue carries the hold, the janitor takes `issue-worker-ready` away within seconds, so the label that started you may be gone when you read the issue\. That is normal and no reason to stop either\./);
});

test('only later-phase progress counts as triage having run, and that list stays where it was', () => {
  const hold = section('A hold that is already there');
  assert.match(hold, /Only the later-phase progress described under "Internal labels" shows that triage has already run\./);
  assert.match(section('Internal labels (never mentioned to the reporter)'), /If it already shows later-phase progress \(`issue-triage-handoff`, `plan-worker-ready`, `plan-triage-handoff`, a `complexity\/\*` or `risk\/\*` label, or the coding agent as an assignee\)/);
});

test('the janitor really does take the label away on a held issue, which is what the prompt now says', () => {
  const janitor = fs.readFileSync(path.join(ROOT, 'scripts/janitor.mjs'), 'utf8');
  assert.match(janitor, /drop\('issue-worker-ready', [^\n]*planDecided/);
});
