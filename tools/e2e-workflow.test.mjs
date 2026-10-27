import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = fs.readFileSync(path.join(ROOT, '.github/workflows/e2e.yml'), 'utf8');

test('the e2e workflow runs on demand and weekly, never on a pull request, because it holds a person\'s token', () => {
  const on = text.match(/^on:\n([\s\S]*?)\npermissions:/m)[1];
  assert.match(on, /^ {2}workflow_dispatch:/m);
  assert.match(on, /^ {2}schedule:/m);
  assert.doesNotMatch(on, /pull_request|push:|issues:|issue_comment/);
});

test('the e2e workflow has read-only permissions and gives the runner token to the two steps that file issues, nothing else', () => {
  assert.match(text, /^permissions:\n {2}contents: read\n/m);
  assert.deepEqual([...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]), ['E2E_RUNNER_TOKEN', 'E2E_RUNNER_TOKEN']);
  assert.ok(!/\$\{\{\s*inputs\./.test(text.match(/run: .*/g).join('\n')), 'an input is passed through the environment, never pasted into a command line');
});

test('the e2e workflow never runs two runs at once, and does not cancel one in progress', () => {
  assert.match(text, /concurrency:\n {2}group: e2e\n {2}cancel-in-progress: false/);
});

test('the e2e workflow runs the runner with --yes after closing what an earlier run left', () => {
  assert.match(text, /run: node tools\/e2e\/run\.mjs --cleanup-stale 6/);
  assert.match(text, /run: node tools\/e2e\/run\.mjs --yes --profile "\$PROFILE"/);
  assert.ok(text.indexOf('--cleanup-stale') < text.indexOf('--yes'));
});
