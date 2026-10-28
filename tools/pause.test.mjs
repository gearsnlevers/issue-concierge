import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { holds, frontmatterIf, jobIf, stepIf, read } from './workflow-condition.mjs';

// The pause switch (docs/multi-phase-design.md, "The maintainer's view", decision 0037): while the repository variable
// CONCIERGE_PAUSED is 'true', no gate, sweep, closer or notifier touches an issue or a pull request. A gate has to be
// stopped before it starts, so each workflow reads the variable in its own `if:`; and a run started by hand still works.
// These tests evaluate the real conditions, with the variable on and off, instead of matching their text.

const PAUSE = "(vars.CONCIERGE_PAUSED != 'true' || github.event_name == 'workflow_dispatch')";
const ctx = (event, { paused = false, ...extra } = {}) => ({
  vars: paused ? { CONCIERGE_PAUSED: 'true' } : {},
  github: { event_name: event.name, repository_id: 1, event: event.payload ?? {} },
  needs: extra.needs ?? {},
});
const issue = (labels = [], extra = {}) => ({ state: 'open', labels: labels.map((name) => ({ name })), user: { type: 'User' }, pull_request: null, body: 'Reported from o/other#1', ...extra });
const issuesEvent = (action, labels = [], label = 'x', extra = {}) => ({ name: 'issues', payload: { action, label: { name: label }, issue: issue(labels, extra) } });
const dispatch = { name: 'workflow_dispatch', payload: { inputs: {} } };

/** Every workflow with a condition, the jobs or the step that carry it, and an event for which it holds when nobody paused. */
const COVERED = [
  { file: 'issue-worker.md', where: 'frontmatter', event: { name: 'issue_comment', payload: { action: 'created', issue: issue(), comment: { user: { type: 'User' } } } }, manual: true },
  { file: 'issue-triage.md', where: 'frontmatter', event: issuesEvent('labeled', [], 'issue-worker-ready') },
  { file: 'plan-worker.md', where: 'frontmatter', event: issuesEvent('labeled', [], 'issue-triage-handoff') },
  { file: 'plan-triage.md', where: 'frontmatter', event: issuesEvent('labeled', [], 'plan-worker-ready') },
  { file: 'pr-worker.md', where: 'frontmatter', event: issuesEvent('labeled', [], 'plan-triage-handoff'), needs: { pre_activation: { outputs: { existing_fix_result: 'success' } } } },
  { file: 'pr-worker.md', where: 'step:existing_fix', event: issuesEvent('labeled', [], 'plan-triage-handoff') },
  { file: 'pr-triage.md', where: 'frontmatter', event: { name: 'pull_request', payload: { action: 'labeled', label: { name: 'pr-worker-ready' }, pull_request: { head: { repo: { id: 1 } }, labels: [] } } } },
  { file: 'release-closer.md', where: 'frontmatter', event: { name: 'release', payload: { action: 'published' } } },
  { file: 'release-closer.md', where: 'step:included_fixes', event: { name: 'release', payload: { action: 'published' } } },
  { file: 'dependency-watch.yml', where: 'job:watch', event: { name: 'schedule' }, manual: true },
  { file: 'janitor.yml', where: 'job:clean', event: issuesEvent('labeled', [], 'issue-worker-ready'), manual: true },
  { file: 'janitor.yml', where: 'job:held-runs', event: { name: 'schedule' }, needs: { clean: { result: 'success' } }, manual: true },
  { file: 'plan-approval-resume.yml', where: 'job:resume', event: issuesEvent('unlabeled', [], 'plan-approval-required'), manual: true },
  { file: 'pr-ready-signal.yml', where: 'job:signal', event: { name: 'pull_request', payload: { pull_request: { labels: [] } } }, manual: true },
  { file: 'related-repo-closer.yml', where: 'job:close-original', event: issuesEvent('closed', ['original-in-related-repo']), manual: true },
  { file: 'reporter-notify.yml', where: 'job:notify', event: issuesEvent('labeled', [], 'issue-worker-ready'), manual: true },
  { file: 'waiting-for-release.yml', where: 'job:resolution', event: issuesEvent('closed'), manual: true },
  { file: 'stalled-issue-sweep.yml', where: 'job:sweep', event: { name: 'schedule' }, manual: true },
];

/** What is not paused, and why. */
const EXEMPT = {
  'status.yml': 'the maintainer\'s view: it shows that the Concierge is paused',
  'commands.yml': 'the maintainer\'s control: it refuses what would start a gate, and still declines and lists',
  'concierge-updater.yml': 'it changes the Concierge\'s own files, not an issue or a pull request',
  'check-deployment.yml': 'it reads the repository\'s configuration, not an issue or a pull request',
  'route-back.yml': 'started by hand only',
  'spawn-work-items.yml': 'started by hand only',
};

/** The triggers of a plain workflow: the indented lines under its `on:`, up to the next key at the left margin. */
function onBlock(file) {
  const lines = read(`workflows/${file}`).split('\n');
  const start = lines.findIndex((l) => l === 'on:');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\S/.test(l));
  return rest.slice(0, end < 0 ? rest.length : end).join('\n');
}

function conditionOf({ file, where }) {
  const text = read(`workflows/${file}`);
  if (where === 'frontmatter') return frontmatterIf(text);
  const [kind, id] = where.split(':');
  return kind === 'job' ? jobIf(text, id) : stepIf(text, id);
}

test('every workflow either carries the pause condition or is listed as not paused, and a new one must choose', () => {
  const files = fs.readdirSync(new URL('../workflows/', import.meta.url)).filter((f) => /\.(md|yml)$/.test(f)).sort();
  const covered = new Set(COVERED.map((c) => c.file));
  assert.deepEqual([...files].filter((f) => !covered.has(f) && !(f in EXEMPT)), [], 'a workflow that touches issues must read CONCIERGE_PAUSED, or say here why not');
  assert.deepEqual(Object.keys(EXEMPT).filter((f) => !files.includes(f)), []);
  assert.deepEqual([...covered].filter((f) => f in EXEMPT), []);
});

test('each condition has the same pause term in its text, so that one search finds them all', () => {
  for (const c of COVERED) assert.ok(conditionOf(c).includes(PAUSE), `${c.file} (${c.where})`);
});

test('with nothing paused each condition holds for an event it is made for', () => {
  for (const c of COVERED) assert.equal(holds(conditionOf(c), ctx(c.event, { needs: c.needs })), true, `${c.file} (${c.where}) for ${c.event.name}`);
});

test('while paused no condition holds for that event: the run is stopped before it starts', () => {
  for (const c of COVERED) assert.equal(holds(conditionOf(c), ctx(c.event, { paused: true, needs: c.needs })), false, `${c.file} (${c.where}) for ${c.event.name}`);
});

test('the variable pauses when it says true, in any case: any other value, or none, pauses nothing', () => {
  const c = COVERED.find((x) => x.file === 'plan-worker.md');
  for (const value of ['true', 'TRUE', 'True', 'false', 'TRUE ', 'yes', '1', '']) {
    const context = ctx(c.event);
    context.vars = { CONCIERGE_PAUSED: value };
    assert.equal(holds(conditionOf(c), context), value.toLowerCase() !== 'true', JSON.stringify(value));
  }
});

test('a run started by hand still works while paused, for every workflow that can be started by hand', () => {
  for (const c of COVERED.filter((x) => x.manual)) {
    const context = ctx(dispatch, { paused: true, needs: c.needs });
    assert.equal(holds(conditionOf(c), context), true, `${c.file} (${c.where})`);
  }
  const manual = COVERED.filter((x) => x.manual).map((x) => x.file);
  for (const c of COVERED) assert.equal(manual.includes(c.file), /^\s+workflow_dispatch:/m.test(read(`workflows/${c.file}`)), `${c.file}: "manual" in this table matches workflow_dispatch in the workflow`);
});

test('the workflows that are not paused are the ones that should keep running', () => {
  for (const file of ['route-back.yml', 'spawn-work-items.yml']) {
    assert.deepEqual([...onBlock(file).matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1]), ['workflow_dispatch'], `${file} is started by hand only`);
  }
  for (const file of ['concierge-updater.yml', 'check-deployment.yml']) {
    assert.doesNotMatch(onBlock(file), /^  (issues|issue_comment|pull_request_target):/m, `${file} reacts to no issue`);
  }
});

test('the status page and the commands are told whether the Concierge is paused, by the variable and by nothing else', () => {
  for (const file of ['status.yml', 'commands.yml']) {
    const text = read(`workflows/${file}`);
    assert.match(text, /CONCIERGE_PAUSED: \$\{\{ vars\.CONCIERGE_PAUSED \}\}/, file);
    assert.doesNotMatch(text.replace(/CONCIERGE_PAUSED: \$\{\{ vars\.CONCIERGE_PAUSED \}\}/, ''), /vars\.CONCIERGE_PAUSED/, `${file} uses the variable only to tell its script`);
  }
});

test('the compile smoke reads the term in every compiled gate and in the two steps that write', () => {
  const smoke = read('tools/ci-compile-smoke.sh');
  assert.match(smoke, /for name in issue-worker issue-triage plan-worker plan-triage pr-worker pr-triage release-closer; do\n  if ! activation_if "\$tmp\/\.github\/workflows\/\$name\.lock\.yml" \| tr '\\n' ' ' \| tr -s ' ' \| grep -qF "vars\.CONCIERGE_PAUSED != 'true'"; then/);
  assert.match(smoke, /for name in pr-worker release-closer; do\n  if \[ "\$\(grep -cF "vars\.CONCIERGE_PAUSED != 'true'" "\$tmp\/\.github\/workflows\/\$name\.lock\.yml"\)" -lt 2 \]; then/);
});

test('the docs, the record and the checklist say the same', () => {
  const design = read('docs/multi-phase-design.md');
  assert.match(design, /^### Pausing the Concierge$/m);
  assert.match(read('docs/deployment.md'), /^### Pause$/m);
  assert.match(read('docs/deployment.md'), /- \[ \] Pause tried: with the repository variable `CONCIERGE_PAUSED` set to `true`/);
  assert.match(read('README.md'), /To stop the Concierge in a repository, create the repository variable `CONCIERGE_PAUSED`/);
  assert.match(read('shared/settings.yml'), /NOT HERE: the pause switch/);
  assert.match(read('docs/decisions/README.md'), /\| 0037 \| \[The Concierge is paused by a repository variable\]\(0037-the-concierge-is-paused-by-a-repository-variable\.md\) \| accepted \|/);
  assert.match(read('docs/decisions/0037-the-concierge-is-paused-by-a-repository-variable.md'), /^status: accepted$/m);
});
