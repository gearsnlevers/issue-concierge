import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// PR triage runs as pull_request_target so a pull request the coding agent opened does not queue a
// run held for approval for every label event. That trigger is only safe with this exact shape.
// gh-aw also rejects `names:` under pull_request_target, so the label filter is an `if:`.
const md = fs.readFileSync(new URL('../workflows/pr-triage.md', import.meta.url), 'utf8');
const frontmatter = md.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
const on = frontmatter.match(/^on:\n((?:[ \t]+.*\n?)+)/m)?.[1] ?? '';

test('PR triage listens on pull_request_target for labeled, and not on pull_request', () => {
  assert.ok(frontmatter, 'frontmatter not found');
  assert.match(on, /^  pull_request_target:\n    types: \[labeled\]$/m);
  assert.doesNotMatch(on, /^  pull_request:/m);
  assert.doesNotMatch(on, /names:/);
});

test('PR triage checks out no pull request code', () => {
  assert.match(frontmatter, /^checkout: false$/m);
});

test('PR triage starts only for pr-worker-ready on a pull request from this repository', () => {
  const cond = frontmatter.match(/^if: >-\n((?:[ \t]+.*\n?)+)/m)?.[1].replace(/\s+/g, ' ').trim();
  assert.ok(cond, 'if: condition not found');
  assert.match(cond, /github\.event\.label\.name == 'pr-worker-ready'/);
  assert.match(cond, /github\.event\.pull_request\.head\.repo\.id == github\.repository_id/);
});

test('PR triage keeps threat detection on and writes only a fixed label list and one comment', () => {
  assert.match(frontmatter, /threat-detection:\n\s+enabled: true/);
  assert.match(frontmatter, /add-comment:\n\s+max: 1/);
  const labels = [...frontmatter.matchAll(/^      - (\S+)$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(labels, [
    'complexity/high', 'complexity/low', 'complexity/medium',
    'pr-triage-handoff',
    'risk/high', 'risk/low', 'risk/medium',
  ]);
});
