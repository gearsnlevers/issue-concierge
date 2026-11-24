import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { read } from './workflow-condition.mjs';

// An issue assigned to a person is handled by that person, and the Concierge gives it `no-auto-processing` (decision 0043). The
// handler is a job of the janitor workflow, which already starts on assignment, so the Actions list does not grow. The conditions of
// the job are evaluated in tools/opt-out.test.mjs and tools/pause.test.mjs, and its decision in scripts/assigned.test.mjs; this pins
// what the job is allowed to do: the smallest token, no secret (a label written with the workflow token starts no workflow, which
// is why nothing follows the write), and that it ships with the workflow that runs it.

const workflow = read('workflows/janitor.yml');
const code = workflow.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/** The text of one job of the janitor workflow, from its key to the next job. */
function job(name) {
  const lines = code.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.ok(start >= 0, `no job ${name}`);
  const end = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
  return lines.slice(start, end < 0 ? lines.length : end).join('\n');
}

test('the handler is a job of the janitor, so no workflow is added, and the janitor still starts on assignment and unassignment', () => {
  assert.match(code, /^on:\n {2}issues:\n {4}types: \[labeled, assigned, unassigned, closed\]$/m);
  assert.deepEqual([...code.matchAll(/^ {2}([a-z-]+):$/gm)].map((m) => m[1]).filter((n) => ['clean', 'held-runs', 'assigned'].includes(n)), ['clean', 'held-runs', 'assigned']);
  const users = fs.readdirSync(new URL('../workflows/', import.meta.url)).filter((f) => /\.(md|yml)$/.test(f) && read(`workflows/${f}`).includes('assigned.mjs'));
  assert.deepEqual(users, ['janitor.yml'], 'no other workflow runs the script');
});

test('the job has the two permissions it needs, no secret, and writes with the workflow token, which starts no workflow', () => {
  const text = job('assigned');
  assert.match(text, /^ {4}permissions:\n {6}contents: read\n {6}issues: write\n {4}steps:/m, 'its own, smaller than the workflow\'s: it reads no pull request and deletes no run');
  assert.doesNotMatch(text, /secrets\./, 'no SIGNAL_TOKEN: a label written with it would start the workflows that read the label events');
  assert.match(text, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(text, /ISSUE_NUMBER: \$\{\{ github\.event\.issue\.number \}\}/);
  assert.doesNotMatch(text, /needs:/, 'it does not wait for the label job, and a failed label job does not stop it');
});

test('the text of an issue never reaches a shell, the script is the one the release installs, and the checkout is the pinned one', () => {
  const text = job('assigned');
  assert.deepEqual([...text.matchAll(/^\s+run: (.+)$/gm)].map((m) => m[1]), ['node .github/scripts/assigned.mjs']);
  assert.doesNotMatch(text, /github\.event\.(issue\.(title|body)|comment)/);
  assert.match(text, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/);
  assert.doesNotMatch(text, /ref:|refs\/pull|pull_request\.head/);
  assert.match(read('aw.yml'), /^ {2}- scripts\/assigned\.mjs$/m);
  assert.ok(fs.existsSync(new URL('../scripts/assigned.test.mjs', import.meta.url)), 'the script has its tests beside it');
});

test('the label job and the held-run job keep what they had: their conditions, their permissions, and no start for an issue event in the held-run job', () => {
  assert.match(job('held-runs'), /github\.event_name != 'issues'/);
  assert.match(job('held-runs'), /permissions:\n {6}contents: read\n {6}pull-requests: read\n {6}actions: write/);
  assert.doesNotMatch(job('clean'), /permissions:/, 'the label job keeps the workflow\'s token');
  assert.match(code, /^permissions:\n {2}contents: read\n {2}issues: write\n {2}pull-requests: write$/m);
  assert.match(code, /group: janitor-\$\{\{ github\.event\.issue\.number \|\| github\.event\.pull_request\.number \|\| inputs\.issue_number \|\| 'sweep' \}\}-\$\{\{ github\.event\.label\.name \}\}\n {2}cancel-in-progress: false/);
});

test('the record, its index row, the status of the record it replaces and the docs say the same', () => {
  const record = read('docs/decisions/0043-an-item-a-person-handles-is-never-touched-by-the-concierge.md');
  assert.match(record, /^status: (proposed|accepted)$/m);
  assert.match(record, /^# An item a person handles is never touched by the Concierge$/m);
  for (const word of ['`no-auto-processing`', '`plan-triage-handoff`', '`complexity/*` or `risk/*`', 'workflow token', 'Unassigning does not remove it', 'no coding agent or other bot']) assert.ok(record.includes(word), `the record says ${word}`);
  assert.match(read('docs/decisions/0028-an-item-labelled-no-auto-processing-is-never-touched.md'), /^status: superseded by 0043$/m);
  const index = read('docs/decisions/README.md');
  assert.match(index, /^\| 0028 \| \[[^\]]+\]\(0028-[^)]+\.md\) \| superseded by 0043 \|$/m);
  assert.match(index, /^\| 0043 \| \[An item a person handles is never touched by the Concierge\]\(0043-[^)]+\.md\) \| (proposed|accepted) \|$/m);
  const design = read('docs/multi-phase-design.md');
  const section = design.split('\n## Opting an item out\n')[1].split('\n## ')[0];
  assert.match(section, /\*\*An issue a person handles\.\*\*/);
  assert.match(section, /0043-an-item-a-person-handles-is-never-touched-by-the-concierge\.md/);
  assert.match(section, /Handing an issue back by unassigning is not supported/);
  assert.match(section, /Not seen live yet: whether the `opened` event/);
  assert.match(design, /\| `no-auto-processing` \| a maintainer, by hand, or the janitor's `assigned` job/);
  assert.match(read('README.md'), /the janitor adds the label when the issue is assigned/);
  const deployment = read('docs/deployment.md');
  assert.match(deployment, /^\| `scripts\/assigned\.mjs` \| `\.github\/scripts\/assigned\.mjs` \(the `assigned` job\) \|$/m);
  assert.match(deployment, /`check-deployment` warns about a template with `assignees:`/);
  assert.match(read('docs/flows.md'), /An open issue assigned to a person gets the label from the janitor/);
});
