import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Stalled issue sweep (docs/multi-phase-design.md, "Stalled issues", decision 0030): the plain workflow, the script
// that does the one thing it may do, and where it is installed and documented. The behaviour is in
// scripts/stalled-issue-sweep.test.mjs; this file pins what must not drift around it.
//
// Why it exists: frodo-lib#803 (2026-10-24), the canonical issue of frodo-cli#919, was analysed by the issue worker
// but never reached issue triage (the first run ended on the turn limit, the second asked for the gate label with
// confidence MEDIUM and gh-aw held it back as a suggestion), and a maintainer's removal of the hold did nothing
// because no plan had been classified.

const REPO = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, REPO), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const yml = read('workflows/stalled-issue-sweep.yml');
const code = yml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const script = read('scripts/stalled-issue-sweep.mjs');
const design = flat(read('docs/multi-phase-design.md'));
const deployment = flat(read('docs/deployment.md'));

test('workflow: starts hourly and by hand, and by nothing that happens to an issue', () => {
  assert.match(code, /^name: "Issue Concierge 1e ▸ Stalled Issue Sweep"$/m);
  assert.match(code, /^ {2}schedule:\n {4}- cron: '47 \* \* \* \*'$/m);
  assert.match(code, /^ {2}workflow_dispatch:\n {4}inputs:\n {6}issue_number:/m);
  assert.match(code, /^ {6}dry_run:\n(?: {8}.*\n)*? {8}type: boolean/m);
  const triggers = code.match(/^on:\n((?: {2,}.*\n|\n)+)/m)[1];
  assert.doesNotMatch(triggers, /^ {2}(issues|issue_comment|pull_request|pull_request_target):/m, 'a sweep is not started by events');
});

test('workflow: no LLM, reads with the workflow token, writes the one label with the signal token', () => {
  assert.match(code, /^permissions:\n {2}contents: read\n {2}issues: read\n {2}pull-requests: read$/m, 'no write permission: the writes use the signal token');
  assert.match(code, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(code, /SIGNAL_TOKEN: \$\{\{ secrets\.SIGNAL_TOKEN \}\}/);
  assert.match(code, /run: node \.github\/scripts\/stalled-issue-sweep\.mjs/);
  assert.match(code, /^concurrency:\n {2}group: stalled-issue-sweep\n {2}cancel-in-progress: false$/m);
  assert.doesNotMatch(code, /copilot|gh-aw|engine:/i);
});

test('script: its only writes remove and add a label, there is no comment, no hold and no start of another gate', () => {
  const writes = script.match(/ghWrite\(`[^`]*`/g) || [];
  assert.equal(writes.length, 2, 'one removal, one addition');
  for (const w of writes) assert.match(w, /\/labels/, w);
  assert.doesNotMatch(script, /ghWrite\(`[^`]*comments/);
  assert.doesNotMatch(script, /--method', '(PATCH|PUT)'/);
  assert.match(script, /export const LABEL_GATE = 'issue-worker-ready';/);
  const labelsWritten = script.match(/(?:addLabel|removeLabel)\(LABEL_GATE\)/g) || [];
  assert.equal(labelsWritten.length, 2, 'the gate label is the only label the sweep writes');
  assert.doesNotMatch(script, /plan-approval-required['"]\s*\)/, 'the hold is only ever read');
});

test('script: skips an opted-out item and never starts the issue worker', () => {
  assert.match(script, /isOptedOut\(issue\)/);
  assert.doesNotMatch(script, /workflow_dispatch|dispatches|issue-worker\.lock/);
});

test('installed by the updater and documented where an operator looks', () => {
  const aw = read('aw.yml');
  assert.match(aw, /^ {2}- workflows\/stalled-issue-sweep\.yml$/m);
  assert.match(aw, /^ {2}- scripts\/stalled-issue-sweep\.mjs$/m);
  assert.match(read('README.md'), /stalled-issue-sweep\.yml/);
  assert.match(read('README.md'), /stalled-issue-sweep\.mjs/);
  assert.match(deployment, /### Stalled issue sweep/);
  assert.match(deployment, /\| `workflows\/stalled-issue-sweep\.yml` \| `\.github\/workflows\/stalled-issue-sweep\.yml` \|/);
  assert.match(deployment, /\| `scripts\/stalled-issue-sweep\.mjs` \| `\.github\/scripts\/stalled-issue-sweep\.mjs` \|/);
  assert.match(deployment, /\[ \] Stalled issue sweep installed/);
  assert.match(design, /\| `Issue Concierge 1e ▸ Stalled Issue Sweep` \| hourly, and on demand for one issue or all of them \|/);
  assert.match(design, /## Stalled issues/);
});

test('decision 0030 records it, and the index lists it', () => {
  const record = read('docs/decisions/0030-a-stalled-issue-is-given-the-gate-label-again-by-code.md');
  assert.match(record, /^ {2}- workflows\/stalled-issue-sweep\.yml$/m);
  assert.match(record, /The hold `plan-approval-required` is not evidence/);
  assert.match(record, /never touches a hold, never posts a comment, never starts the issue worker/);
  assert.match(read('docs/decisions/README.md'), /\| 0030 \| \[A stalled issue is given the gate label again by code\]\(0030-a-stalled-issue-is-given-the-gate-label-again-by-code\.md\) \|/);
});
