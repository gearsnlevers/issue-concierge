import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Who can start a gate (docs/deployment.md, "Who can start a gate"). gh-aw skips, without a word,
// a run caused by a user without the admin, maintainer or write role. The issue worker is the one
// gate that starts from a reporter's own event, so it opts out with `roles: all`. That is safe only
// because of what the worker may do with untrusted text, so those limits are pinned here as well:
// widen one and this test forces the question whether the gate may still be open to everyone.

const REPO = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, REPO), 'utf8');
const frontmatter = (md) => {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'frontmatter not found');
  return m[1];
};
/** The indented block under a top-level key of the frontmatter. */
const block = (fm, key) => {
  const lines = fm.split('\n');
  const start = lines.findIndex((l) => l === `${key}:`);
  assert.ok(start >= 0, `top-level key "${key}" not found`);
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line !== '' && !/^\s/.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
};

const worker = frontmatter(read('workflows/issue-worker.md'));
const others = fs
  .readdirSync(new URL('workflows/', REPO))
  .filter((f) => f.endsWith('.md') && f !== 'issue-worker.md');

test('issue worker: opts out of the role check, under on:', () => {
  assert.match(block(worker, 'on'), /^ {2}roles: all$/m);
});

test('no other workflow changes the role check', () => {
  assert.ok(others.length >= 6, 'expected the other gate workflows');
  for (const f of others) {
    assert.doesNotMatch(frontmatter(read(`workflows/${f}`)), /^\s*roles:/m, `${f} must keep gh-aw's default roles`);
  }
});

test('issue worker: the rate limit covers issue and comment events', () => {
  const rl = block(worker, 'user-rate-limit');
  assert.match(rl, /events: \[issues, issue_comment\]/);
  assert.match(rl, /max-runs-per-window: 5\b/);
  assert.match(rl, /window: 30\b/);
});

test('issue worker: the limits that make an open gate safe are still in place', () => {
  assert.match(block(worker, 'tools'), /^ {2}bash: false$/m, 'no shell');
  assert.match(block(worker, 'tools'), /min-integrity: none/, 'reads untrusted text on purpose');
  const so = block(worker, 'safe-outputs');
  assert.match(so, /threat-detection:\n\s+enabled: true\n\s+continue-on-error: false/, 'threat detection blocks');
  assert.match(so, /add-comment:\n\s+max: 2\b/, 'two comments at most');
  assert.match(so, /create-issue:\n\s+max: 1\b/, 'one linked issue at most');
  const labels = so.match(/add-labels:[\s\S]*?allowed:\n((?:\s+- .*\n)+)/);
  assert.ok(labels, 'add-labels allow-list not found');
  assert.deepEqual(
    labels[1].trim().split('\n').map((l) => l.replace(/^\s*- /, '').trim()).sort(),
    ['issue-worker-ready', 'related-repo'],
    'only the two fixed labels'
  );
});

test('docs: the gate, its symptom and how to tighten it are explained', () => {
  const dep = read('docs/deployment.md');
  assert.match(dep, /^## Who can start a gate$/m);
  assert.match(dep, /`issue-worker` is open to everyone/);
  assert.match(dep, /User permission 'read' does not meet requirements/);
  assert.match(dep, /replace `roles: all` with `roles: \[admin, maintainer, write\]`/);
  assert.match(read('docs/multi-phase-design.md'), /^## Who can start a gate$/m);
});
