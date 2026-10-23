import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDeployment, checkGuidance, GUIDANCE_FILES, main, readSafeOutputsConfig } from './check-deployment.mjs';

const RELATED = (secret = 'FRODO_CLI_ISSUES_TOKEN') => `
this: rockcarver/frodo-lib

related:
  - role: cli
    repo: rockcarver/frodo-cli
${secret ? `    secret: ${secret}\n` : ''}    when: |
      CLI only.
`;

const out = (over = {}) => ({
  allowed_repos: ['rockcarver/frodo-cli'],
  'github-token': '${GH_AW_SECRET_FRODO_CLI_ISSUES_TOKEN}',
  max: 1,
  ...over,
});
const lock = (config) =>
  `env:\n  GH_AW_SAFE_OUTPUTS_CONFIG: ${JSON.stringify(JSON.stringify(config))}\n  OTHER: x\n`;
const healthy = () => ({
  'issue-worker.lock.yml': lock({ create_issue: out(), add_comment: { max: 2 } }),
  'related-repo-closer.lock.yml': lock({ add_comment: out(), add_labels: out(), close_issue: out(), noop: {} }),
});

test('a fully wired deployment passes', () => {
  assert.deepEqual(checkDeployment(RELATED(), healthy()), { errors: [], warnings: [] });
});

test('no related repositories: nothing to check', () => {
  assert.deepEqual(checkDeployment('this: a/b\n', {}), { errors: [], warnings: [] });
});

test('the failure behind frodo-lib#757: token set but repository not allowed', () => {
  const locks = healthy();
  locks['related-repo-closer.lock.yml'] = lock({
    add_comment: out({ allowed_repos: undefined }),
    add_labels: out({ allowed_repos: undefined }),
    close_issue: out({ allowed_repos: undefined }),
  });
  const { errors } = checkDeployment(RELATED(), locks);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /related-repo-closer\.lock\.yml: add-comment does not allow rockcarver\/frodo-cli/);
  assert.match(errors[0], /allowed-repos/);
});

test('an unconfigured create-issue placeholder is an error (frodo-lib issue worker)', () => {
  const locks = healthy();
  locks['issue-worker.lock.yml'] = lock({ create_issue: { max: 1 } });
  const { errors } = checkDeployment(RELATED(), locks);
  assert.equal(errors.length, 2);
  assert.match(errors.join('\n'), /create-issue does not allow/);
  assert.match(errors.join('\n'), /does not use the secret FRODO_CLI_ISSUES_TOKEN/);
});

test('the wrong secret is an error', () => {
  const locks = healthy();
  locks['related-repo-closer.lock.yml'] = lock({
    add_comment: out({ 'github-token': '${GH_AW_SECRET_SIGNAL_TOKEN}' }),
    add_labels: out(),
    close_issue: out(),
  });
  const { errors } = checkDeployment(RELATED(), locks);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /add-comment does not use the secret FRODO_CLI_ISSUES_TOKEN/);
});

test('a disabled safe output and a missing lock file are errors', () => {
  const locks = healthy();
  locks['related-repo-closer.lock.yml'] = lock({ add_comment: out(), add_labels: out() });
  assert.match(checkDeployment(RELATED(), locks).errors.join('\n'), /close-issue is not enabled/);
  delete locks['issue-worker.lock.yml'];
  assert.match(checkDeployment(RELATED(), locks).errors.join('\n'), /issue-worker\.lock\.yml: not found/);
});

test('a related repository without a secret is a warning, not an error', () => {
  const { errors, warnings } = checkDeployment(RELATED(''), healthy());
  assert.deepEqual(errors, []);
  assert.match(warnings.join('\n'), /names no secret/);
});

test('an allowed repository that related-repos.md does not list is a warning', () => {
  const locks = healthy();
  locks['issue-worker.lock.yml'] = lock({ create_issue: out({ allowed_repos: ['rockcarver/frodo-cli', 'x/y'] }) });
  const { errors, warnings } = checkDeployment(RELATED(), locks);
  assert.deepEqual(errors, []);
  assert.match(warnings.join('\n'), /allows x\/y/);
});

test('an unreadable lock file is an error, and the parser tolerates garbage', () => {
  assert.equal(readSafeOutputsConfig('nothing here'), null);
  assert.equal(readSafeOutputsConfig('GH_AW_SAFE_OUTPUTS_CONFIG: "not json"'), null);
  const locks = healthy();
  locks['issue-worker.lock.yml'] = 'env: {}\n';
  assert.match(checkDeployment(RELATED(), locks).errors.join('\n'), /cannot read the compiled safe-outputs configuration/);
});

// Repository guidance: a notice, never a failure.

test('guidance files: AGENTS.md or .github/copilot-instructions.md is enough, neither gives one notice', () => {
  assert.deepEqual(GUIDANCE_FILES, ['AGENTS.md', '.github/copilot-instructions.md']);
  assert.deepEqual(checkGuidance((f) => f === 'AGENTS.md'), []);
  assert.deepEqual(checkGuidance((f) => f === '.github/copilot-instructions.md'), []);
  const notices = checkGuidance(() => false);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /no repository guidance/);
  assert.match(notices[0], /shared\/agents\.md/);
});

/** Run main() in a scratch repository and return its exit code and what it printed. */
function runMain(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-deployment-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      if (text === null) fs.mkdirSync(path.join(dir, name)); // a directory with that name
      else fs.writeFileSync(path.join(dir, name), text);
    }
    const lines = [];
    const original = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    let code;
    try {
      code = main(dir);
    } finally {
      console.log = original;
    }
    return { code, out: lines.join('\n') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('main: a repository without guidance gets a notice and still exits 0, with or without related-repos.md', () => {
  const bare = runMain({});
  assert.equal(bare.code, 0);
  assert.match(bare.out, /^::notice::Coding agents get no repository guidance/m);
  assert.match(bare.out, /nothing to check/);

  const other = runMain({ 'README.md': 'x' });
  assert.equal(other.code, 0);
  assert.match(other.out, /::notice::/);
});

test('main: AGENTS.md or copilot-instructions.md silences the notice; a directory of that name does not', () => {
  assert.doesNotMatch(runMain({ 'AGENTS.md': '# Agents' }).out, /::notice::/);
  assert.doesNotMatch(runMain({ '.github/copilot-instructions.md': 'x' }).out, /::notice::/);
  assert.match(runMain({ 'AGENTS.md': null }).out, /::notice::/);
});

test('main: the notice never changes the outcome of the real checks', () => {
  const related = 'this: a/b\n\nrelated:\n  - role: cli\n    repo: a/c\n    secret: C_TOKEN\n    when: |\n      x\n';
  // A related repository whose compiled workflows are missing: the existing error still fails the check.
  const failing = runMain({ '.github/agentic-workflows/related-repos.md': related });
  assert.equal(failing.code, 1);
  assert.match(failing.out, /::error::/);
  assert.match(failing.out, /::notice::/);
  assert.equal(runMain({ '.github/agentic-workflows/related-repos.md': related, 'AGENTS.md': 'x' }).code, 1);
});
