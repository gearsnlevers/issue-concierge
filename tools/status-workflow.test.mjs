import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRIGGER_LABELS } from '../scripts/janitor.mjs';
import { buildManifest } from './build-release-manifest.mjs';

// The status issue (docs/multi-phase-design.md, "The maintainer's view", decision 0035) is written by a plain
// workflow that runs on the events of a busy repository, with a token that can pin. This pins what that workflow may
// do and when, and that everything it needs is delivered with it.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const workflow = read('workflows/status.yml');
const code = workflow.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const aw = read('aw.yml');

test('it is the maintainer\'s view, named in the sidebar order, and can be started by hand', () => {
  assert.match(code, /^name: "Concierge 5a ▸ Status"$/m);
  assert.match(code, /^  workflow_dispatch:\n    inputs:\n      dry_run:\n        description: 'Only print the page and write nothing'/m);
});

test('it runs on the events that change a number on the page, every hour and by hand, and on no other', () => {
  const on = code.split('\npermissions:')[0];
  assert.match(on, /schedule:\n    - cron: '17 \* \* \* \*'/);
  assert.match(on, /issues:\n    types: \[opened, closed, reopened, labeled\]/);
  assert.match(on, /issue_comment:\n    types: \[created\]/);
  assert.doesNotMatch(on, /pull_request|push:|edited|unlabeled|workflow_run/, 'a removal starts nothing: only the issue worker and the plan approval resume may listen to it');
});

test('its permissions are the four it needs and no more, and the token that pins is used for nothing else', () => {
  assert.match(code, /^permissions:\n  contents: read\n  issues: write\n  pull-requests: read\n  actions: read\n\nconcurrency:/m);
  const secrets = [...code.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(secrets, ['SIGNAL_TOKEN']);
  assert.match(code, /GH_TOKEN: \$\{\{ github\.token \}\}/);
});

test('events queue one behind the other instead of cancelling a run that is writing', () => {
  assert.match(code, /concurrency:\n  group: concierge-status\n  cancel-in-progress: false/);
});

test('a label event starts it only for the labels the janitor watches, and nothing starts for an opted-out issue, a pull request or a bot', () => {
  const list = JSON.parse(/fromJSON\('(\[[^']*\])'\)/.exec(code)[1]);
  assert.deepEqual(list, TRIGGER_LABELS);
  assert.match(code, /\(github\.event\.action != 'labeled'\n\s+\|\| contains\(fromJSON/);
  assert.match(code, /&& !contains\(github\.event\.issue\.labels\.\*\.name, 'no-auto-processing'\)/);
  assert.match(code, /&& github\.event\.issue\.pull_request == null/);
  assert.match(code, /&& github\.event\.comment\.user\.type != 'Bot'/);
});

test('it checks out the default branch and runs one script, so the settings are read from there', () => {
  assert.match(code, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/);
  assert.equal([...code.matchAll(/^        run: (.+)$/gm)].length, 1);
  assert.match(code, /run: node \.github\/scripts\/status-issue\.mjs/);
  assert.doesNotMatch(code, /ref:|refs\/pull|github\.event\.pull_request\.head/);
});

test('everything it needs is delivered with it: the workflow, its three scripts and the settings template', () => {
  for (const file of ['workflows/status.yml', 'scripts/status-issue.mjs', 'scripts/concierge-settings.mjs', 'scripts/concierge-state.mjs', 'shared/settings.yml']) {
    assert.match(aw, new RegExp(`^  - ${file.replace('.', '\\.')}$`, 'm'), `${file} is in aw.yml`);
  }
  const entry = (file) => buildManifest({ root: ROOT, version: '0.0.0-test' }).files.find((f) => f.path === file);
  assert.deepEqual([entry('workflows/status.yml').kind, entry('workflows/status.yml').dest], ['workflow', '.github/workflows/status.yml']);
  for (const script of ['status-issue', 'concierge-settings', 'concierge-state']) assert.equal(entry(`scripts/${script}.mjs`).dest, `.github/scripts/${script}.mjs`);
  assert.deepEqual([entry('shared/settings.yml').kind, entry('shared/settings.yml').dest], ['reference', null], 'the template is read, not installed');
});

test('every script it imports is delivered too, so that an install runs', () => {
  for (const file of ['status-issue', 'concierge-state', 'concierge-settings']) {
    for (const [, dep] of read(`scripts/${file}.mjs`).matchAll(/^import .* from '\.\/([\w-]+\.mjs)';$/gm)) {
      assert.match(aw, new RegExp(`^  - scripts/${dep.replace('.', '\\.')}$`, 'm'), `${file} imports ${dep}`);
    }
  }
  assert.match(workflow, /scripts\/concierge-settings\.mjs and scripts\/concierge-state\.mjs to \.github\/scripts\/ \(they import janitor\.mjs and\n# opt-out\.mjs, so install those too\)/);
});

test('the status issue is invisible to the gates: opened by the bot and marked with the opt-out label', () => {
  const source = read('scripts/status-issue.mjs');
  assert.match(source, /labels: \[LABEL_OPT_OUT\]/);
  assert.match(source, /export const MARKER = '<!-- concierge:status -->'/);
  // the workflow token authors the issue, and a bot-authored issue starts no gate
  for (const gate of ['issue-worker', 'issue-triage', 'plan-worker']) {
    assert.match(read(`workflows/${gate}.md`), /github\.event\.issue\.user\.type != 'Bot'/, `${gate} skips bot-authored issues`);
  }
});

test('the docs, the record and the checklist say the same', () => {
  const design = read('docs/multi-phase-design.md');
  assert.match(design, /^## The maintainer's view$/m);
  assert.match(design, /\| `Concierge 5a ▸ Status` \| when a label that matters changes, on a comment, hourly, and on demand; a plain workflow, no model \|/);
  assert.match(read('docs/deployment.md'), /^### Status issue$/m);
  assert.match(read('docs/deployment.md'), /- \[ \] Status issue installed \(`status\.yml`, `status-issue\.mjs`, `concierge-settings\.mjs` and `concierge-state\.mjs`; the updater does it\)/);
  assert.match(read('docs/deployment.md'), /\| `settings\.yml` \| No \|/);
  assert.match(read('README.md'), /Every repository that runs the Concierge gets a pinned issue, "Concierge status"/);
  assert.match(read('README.md'), /- `settings\.yml`: what the Concierge does in this repository/);
  assert.match(design, /\*\*The nudge\.\*\* With `mention-after-days` above 0 \(off by default\), the same workflow mentions the people who have the maintain or admin role/);
  assert.match(design, /`mention-after-days` \(0, never\) is the nudge above\./);
  assert.match(read('docs/deployment.md'), /`mention-after-days`, off by default; it lists the collaborators with the workflow token and then with `SIGNAL_TOKEN`/);
  assert.match(read('README.md'), /mention the maintainers about what has waited for them too long \(`mention-after-days`\)/);
  assert.match(read('docs/decisions/0035-each-repository-has-a-status-view-of-its-own.md'), /With `mention-after-days` above 0 \(off by default\) it also mentions the people who have the maintain or admin role/);
  assert.match(read('docs/decisions/README.md'), /\| 0035 \| \[Each repository has a status view of its own\]\(0035-each-repository-has-a-status-view-of-its-own\.md\) \| proposed \|/);
  assert.match(read('docs/decisions/0035-each-repository-has-a-status-view-of-its-own.md'), /^status: proposed$/m);
});

test('no heading in the docs is written twice in a row (an insertion once repeated the one it was placed before)', () => {
  for (const file of ['README.md', 'docs/deployment.md', 'docs/multi-phase-design.md', 'docs/e2e.md']) {
    const lines = read(file).split('\n').filter((l) => l.trim() !== '');
    lines.forEach((line, i) => {
      if (/^#{1,6} /.test(line)) assert.notEqual(line, lines[i + 1], `${file}: "${line}" twice in a row`);
    });
  }
});
