import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Both issues of a link carry a label (docs/multi-phase-design.md, "Split-repo routing"; record 0025).
// `related-repo` marks the original, the issue a reporter filed. Nothing marked the canonical issue, the one in
// the repository that holds the work: its only trace was a `Reported from` line in the body, which a list of
// issues does not show (seen on frodo-cli#920 and frodo-lib#804, 2026-10-25). `original-in-related-repo` marks
// it. Two properties matter and are pinned here:
//   - the label is applied by the workflow's own configuration (`create-issue.labels`), never by the model, so
//     it cannot be forgotten, and the issue worker is still not allowed to add it with `add-labels`;
//   - the related-repo closer starts only for a closed issue that carries it. Before, it started a model run on
//     every close of an issue not opened by a bot, to look for a `Reported from` line. The `if:` is the guarantee;
//     a canonical issue opened by hand needs the label too. The closer is a plain workflow now (record 0027);
//     what its script does is pinned in scripts/related-repo-closer.test.mjs and the workflow in
//     tools/related-repo-closer-workflow.test.mjs.
// The compiled lock of the issue worker is checked in tools/ci-compile-smoke.sh.

const REPO = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, REPO), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const split = (md) => {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'frontmatter not found');
  return { frontmatter: m[1], body: m[2].replace(/<!--[\s\S]*?-->/g, '') };
};
const LABEL = 'original-in-related-repo';

const worker = split(read('workflows/issue-worker.md'));
const closer = read('workflows/related-repo-closer.yml');
const requirements = JSON.parse(read('requirements.json'));

test('the manifest declares both link labels, so the updater creates the new one in every deployment', () => {
  const byName = new Map(requirements.labels.map((l) => [l.name, l]));
  assert.ok(byName.has('related-repo'), 'the original keeps its label');
  const label = byName.get(LABEL);
  assert.ok(label, `${LABEL} is missing from requirements.json`);
  assert.match(label.color, /^[0-9a-f]{6}$/);
  assert.ok(label.description.length > 0 && label.description.length <= 100, 'GitHub caps a label description at 100 characters');
});

test('the issue worker may not add the link label itself: the configuration does', () => {
  const addLabels = worker.frontmatter.match(/^ {2}add-labels:\n((?: {4}.*\n)+)/m)?.[1] ?? '';
  assert.match(addLabels, /allowed:\n {6}- issue-worker-ready\n {6}- related-repo\n/);
  assert.doesNotMatch(addLabels, new RegExp(LABEL));
  const create = worker.frontmatter.match(/^ {2}create-issue:\n((?: {4}.*\n)+)/m)?.[1] ?? '';
  assert.match(create, new RegExp(`^ {4}labels:\\n {6}- plan-approval-required\\n {6}- ${LABEL}\\n`, 'm'));
});

test('the issue worker prompt names both labels of the canonical issue and keeps the original side as it was', () => {
  const s = flat(worker.body);
  assert.match(s, /Do not set labels on it\. The system opens it with the hold label `plan-approval-required` and the link label `original-in-related-repo`/);
  assert.match(s, /Add the internal label `related-repo`\./, 'the original is labelled as before');
});

test('the closer starts only for a closed issue that carries the link label, and still never for a bot', () => {
  const m = closer.match(/^ {4}if: ([\s\S]*?)(?=^ {4}\S)/m);
  assert.ok(m, 'the job condition was not found');
  assert.equal(
    flat(m[1]).trim(),
    `(vars.CONCIERGE_PAUSED != 'true' || github.event_name == 'workflow_dispatch') && (github.event_name == 'workflow_dispatch' || (github.event.issue.user.type != 'Bot' && contains(github.event.issue.labels.*.name, '${LABEL}') && !contains(github.event.issue.labels.*.name, 'no-auto-processing')))`
  );
});

test('the closer still starts on a closed issue (it must not require an open one)', () => {
  assert.match(closer, /^on:\n {2}issues:\n {4}types: \[closed\]/m);
  assert.doesNotMatch(closer, /issue\.state == 'open'/);
});

test('the docs say that both issues carry a label and that a canonical issue made by hand needs it', () => {
  const deployment = flat(read('docs/deployment.md'));
  assert.match(deployment, new RegExp(`\\| \`${LABEL}\` \\| \`[0-9a-f]{6}\` \\|`));
  assert.match(deployment, /It starts only for a closed issue that carries `original-in-related-repo`, so a canonical issue opened by hand needs that label too/);
  const design = flat(read('docs/multi-phase-design.md'));
  assert.match(design, /\| `original-in-related-repo` \| issue worker's `create-issue` configuration \|/);
  assert.match(design, /\*\*Both issues of a link carry a label\.\*\*/);
  const shared = flat(read('shared/related-repos.md'));
  assert.match(shared, /so a canonical issue opened by hand needs that label too/);
});
