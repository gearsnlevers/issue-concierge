import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from './build-release-manifest.mjs';

// The comment commands (docs/multi-phase-design.md, "Commands and the options comment", decision 0036) run on a comment
// anyone can write, with a token that can hand an issue on and close it. This pins what the workflow may do, that the text
// of a comment never reaches a shell, and that everything it needs is delivered with it.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const workflow = read('workflows/commands.yml');
const code = workflow.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const aw = read('aw.yml');
const requirements = JSON.parse(read('requirements.json'));

test('it is named in the sidebar order after the status workflow, and can be started by hand for one issue', () => {
  assert.match(code, /^name: "Issue Concierge 5b ▸ Commands"$/m);
  assert.match(code, /^  workflow_dispatch:\n    inputs:\n      issue_number:\n        description: 'Bring the options comment of one issue up to date \(leave empty for every issue that waits\)'\n        required: false\n        type: string/m);
});

test('it runs on a comment, on the label events that change what waits, on close and reopen, and every hour, and on no other event', () => {
  const on = code.split('\npermissions:')[0];
  assert.match(on, /issue_comment:\n    types: \[created\]/);
  assert.match(on, /issues:\n    types: \[labeled, closed, reopened\]/);
  assert.match(on, /schedule:\n    - cron: '41 \* \* \* \*'/);
  assert.doesNotMatch(on, /unlabeled|edited|pull_request|workflow_run|push:/, 'a removal starts nothing, and no pull request code runs here');
});

test('its permissions are the two it needs, and the only secret is the signal token', () => {
  assert.match(code, /^permissions:\n  contents: read\n  issues: write\n\nconcurrency:/m);
  assert.deepEqual([...code.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]), ['SIGNAL_TOKEN']);
  assert.match(code, /GH_TOKEN: \$\{\{ github\.token \}\}/);
});

test('one run at a time, and a run that is writing is not cancelled', () => {
  assert.match(code, /concurrency:\n  group: concierge-commands\n  cancel-in-progress: false/);
});

test('the text of a comment, a title or a login never reaches a shell: no run line has an expression, and the event file is the only input', () => {
  assert.doesNotMatch(code, /github\.event\.(comment\.body|comment\.user\.login|issue\.title|issue\.body|issue\.user\.login)/);
  for (const [, line] of code.matchAll(/^\s+run: (.+)$/gm)) assert.doesNotMatch(line, /\$\{\{/, line);
  assert.deepEqual([...code.matchAll(/^\s+run: (.+)$/gm)].map((m) => m[1]), ['sleep 30', 'node .github/scripts/commands.mjs']);
  assert.doesNotMatch(code, /GITHUB_EVENT_PATH|toJSON\(github\.event/, 'the script reads the file GitHub provides itself');
  assert.match(read('scripts/commands.mjs'), /env\.GITHUB_EVENT_PATH/);
});

test('a label event starts it only for the labels that change what waits for a maintainer, an opted-out issue and a pull request never do, and a bot\'s comment is not read', () => {
  const list = JSON.parse(/fromJSON\('(\[[^']*\])'\)/.exec(code)[1]);
  assert.deepEqual(list, ['needs-decision', 'scope-review', 'plan-approval-required', 'complexity/low', 'complexity/medium', 'complexity/high', 'risk/low', 'risk/medium', 'risk/high', 'issue-triage-handoff', 'plan-triage-handoff', 'declined']);
  const known = new Set(requirements.labels.map((l) => l.name));
  for (const label of list) assert.ok(known.has(label), `${label} is not in requirements.json`);
  assert.match(code, /\(github\.event\.action != 'labeled'\n\s+\|\| contains\(fromJSON/);
  assert.match(code, /&& !contains\(github\.event\.issue\.labels\.\*\.name, 'no-auto-processing'\)/);
  assert.match(code, /&& github\.event\.issue\.pull_request == null/);
  assert.match(code, /&& github\.event\.comment\.user\.type != 'Bot'/);
});

test('after a label event it waits half a minute, so that the comment a gate posts with its labels is there first', () => {
  assert.match(code, /- name: Let the gate finish its comment\n        if: github\.event_name == 'issues' && github\.event\.action == 'labeled'\n        run: sleep 30/);
});

test('it checks out the default branch and runs one script', () => {
  assert.match(code, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/);
  assert.doesNotMatch(code, /ref:|refs\/pull|github\.event\.pull_request\.head/);
  assert.match(code, /run: node \.github\/scripts\/commands\.mjs/);
});

test('everything it needs is delivered with it, and every script it imports is delivered too', () => {
  for (const file of ['workflows/commands.yml', 'scripts/commands.mjs']) assert.match(aw, new RegExp(`^  - ${file.replace('.', '\\.')}$`, 'm'), `${file} is in aw.yml`);
  const m = buildManifest({ root: ROOT, version: '0.0.0-test' }).files;
  assert.deepEqual(m.filter((f) => /commands\.(yml|mjs)$/.test(f.path)).map((f) => [f.kind, f.dest]).sort(), [['script', '.github/scripts/commands.mjs'], ['workflow', '.github/workflows/commands.yml']]);
  for (const [, dep] of read('scripts/commands.mjs').matchAll(/^import .* from '\.\/([\w-]+\.mjs)';$/gm)) {
    assert.match(aw, new RegExp(`^  - scripts/${dep.replace('.', '\\.')}$`, 'm'), `commands.mjs imports ${dep}`);
  }
});

test('the label /decline adds is a required label with a description GitHub accepts', () => {
  const label = requirements.labels.find((l) => l.name === 'declined');
  assert.ok(label);
  assert.match(label.color, /^[0-9a-f]{6}$/);
  assert.ok(label.description.length <= 100);
  assert.equal(requirements.labels.filter((l) => l.color === label.color).length, 1, 'a colour of its own');
  assert.match(read('docs/deployment.md'), /\| `declined` \| `f9d0c4` \| Closed by a maintainer's decision \(\/decline\); not planned \|/);
  assert.match(read('README.md'), /\| `declined` \| Quality \| Closed by a maintainer's decision \(`\/decline`\); not planned \|/);
});

test('issue triage leaves a declined issue alone, as it leaves a held one', () => {
  const triage = read('workflows/issue-triage.md');
  assert.match(triage, /If the issue already has `out-of-scope`, `needs-decision` or `declined`, do nothing/);
  assert.match(triage, /removing `out-of-scope`, `scope-review`, `needs-decision` or `declined`, and adding `issue-triage-handoff`/);
});

test('the docs, the record and the checklist say the same', () => {
  const design = read('docs/multi-phase-design.md');
  assert.match(design, /^### Commands and the options comment$/m);
  assert.match(design, /\| `Issue Concierge 5b ▸ Commands` \| a comment, a label that changes what waits for a maintainer, an issue closing or reopening, hourly, and on demand for one issue; a plain workflow, no model \|/);
  assert.match(design, /\| the request changes what exists \(`needs-decision`\) \| `\/accept`, `\/decline \[reason\]` \|/);
  assert.match(design, /\| a classified plan waits for approval \(`plan-approval-required` with a complexity and a risk label\) \| `\/approve`, `\/replan \[what to change\]`, `\/decline \[reason\]` \|/);
  assert.match(read('docs/deployment.md'), /^### Commands$/m);
  assert.match(read('docs/deployment.md'), /- \[ \] Commands installed \(`commands\.yml` and `commands\.mjs`; needs `SIGNAL_TOKEN`; the updater does it\)/);
  assert.match(read('README.md'), /An issue that waits for a maintainer carries the command they need next\./);
  assert.match(read('docs/decisions/README.md'), /\| 0036 \| \[A maintainer decides by command, from the issue\]\(0036-a-maintainer-decides-by-command-from-the-issue\.md\) \| accepted \|/);
  assert.match(read('docs/decisions/0036-a-maintainer-decides-by-command-from-the-issue.md'), /^status: accepted$/m);
});
