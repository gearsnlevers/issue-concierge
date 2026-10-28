import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The soak of v2.0.0-1 (docs/e2e.md, command-accepts-a-held-request, private pair, first attempt): a reporter asked a question
// on a held request, a maintainer wrote `/accept` a minute later, and the issue worker run the question had started finished
// after the hand-over. Issue triage then read an issue with no gate label (they are removed as an issue moves on, and the plan
// worker was still writing the plan) and applied `needs-decision` again. The maintainer's decision has to count even when no
// label shows it. The comment is the only trace, and only a person with write access may make it count.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const prompt = fs.readFileSync(path.join(ROOT, 'workflows/issue-triage.md'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const labels = prompt.split('\n## Internal labels (never mentioned to the reporter)\n')[1].split('\n## ')[0];
const bullet = labels.split('\n').find((l) => l.startsWith('- If a comment on the issue starts with `/accept`'));

test('the rule exists in the section that decides the outcomes, and comes before the outcomes it overrides', () => {
  assert.ok(bullet, 'the bullet about /accept is missing');
  const lines = labels.split('\n');
  const at = lines.indexOf(bullet);
  for (const outcome of ['- Valid but not urgent:', '- Complete, actionable, and worth doing now']) {
    assert.ok(at < lines.findIndex((l) => l.startsWith(outcome)), `before "${outcome}"`);
  }
  assert.ok(at > lines.findIndex((l) => l.startsWith('- A change to what exists:')), 'after the hold it overrides is described');
});

test('only a person with write access counts: the author association, not the words', () => {
  assert.match(bullet, /its author association is OWNER, MEMBER or COLLABORATOR/);
  assert.match(bullet, /A comment that starts with `\/accept` from anyone else is not a decision\./);
});

test('it says why no label shows the decision, so the model does not wait for one', () => {
  assert.match(bullet, /No label has to show that: the gate labels are removed as an issue moves on/);
  assert.match(bullet, /your own run may have started before the command was given/);
});

test('what it forbids is every outcome that would stop or start the issue again', () => {
  assert.match(bullet, /Do not apply `needs-decision`, `scope-review`, `out-of-scope`, `backlog` or `low-hanging-fruit`, and do not emit `issue-triage-handoff` a second time\./);
});

test('the bullets next to it are as they were: the hold that stays and the later-phase list', () => {
  assert.match(labels, /- If the issue already has `out-of-scope`, `needs-decision` or `declined`, do nothing: it was declined or is waiting for a maintainer, and a reporter's reply does not change that\. If it already shows later-phase progress \(`issue-triage-handoff`, `plan-worker-ready`, `plan-triage-handoff`, a `complexity\/\*` or `risk\/\*` label, or the coding agent as an assignee\)/);
});

test('the command is one the commands workflow really has, and /accept hands the issue to the plan worker', () => {
  const commands = fs.readFileSync(path.join(ROOT, 'scripts/commands.mjs'), 'utf8');
  assert.match(commands, /export const COMMAND_NAMES = \[[^\]]*'accept'/);
  assert.match(commands, /LABEL_HANDOFF = 'issue-triage-handoff'/);
});
