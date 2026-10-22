import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDeployment, readSafeOutputsConfig } from './check-deployment.mjs';

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
