import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDecisions, checkDeployment, checkGuidance, DECISIONS_DIRS, GUIDANCE_FILES, main, readSafeOutputsConfig } from './check-deployment.mjs';

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
// The closer is a plain workflow: the updater writes the related repository and its secret into its environment.
const closer = (repo = 'rockcarver/frodo-cli', secret = 'FRODO_CLI_ISSUES_TOKEN') =>
  `jobs:\n  close-original:\n    steps:\n      - env:\n          GH_TOKEN: \${{ github.token }}\n          CROSS_REPO: ${repo}\n          CROSS_REPO_TOKEN: \${{ secrets.${secret} }}\n`;
const healthy = () => ({
  'issue-worker.lock.yml': lock({ create_issue: out(), add_comment: { max: 2 } }),
  'related-repo-closer.yml': closer(),
});

test('a fully wired deployment passes', () => {
  assert.deepEqual(checkDeployment(RELATED(), healthy()), { errors: [], warnings: [] });
});

test('no related repositories: nothing to check', () => {
  assert.deepEqual(checkDeployment('this: a/b\n', {}), { errors: [], warnings: [] });
});

test('the failure behind frodo-lib#757: token set but repository not allowed', () => {
  const locks = healthy();
  locks['issue-worker.lock.yml'] = lock({ create_issue: out({ allowed_repos: undefined }) });
  const { errors } = checkDeployment(RELATED(), locks);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /issue-worker\.lock\.yml: create-issue does not allow rockcarver\/frodo-cli/);
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
  locks['issue-worker.lock.yml'] = lock({ create_issue: out({ 'github-token': '${GH_AW_SECRET_SIGNAL_TOKEN}' }) });
  const { errors } = checkDeployment(RELATED(), locks);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /create-issue does not use the secret FRODO_CLI_ISSUES_TOKEN/);
});

test('a disabled safe output and a missing lock file are errors', () => {
  const locks = healthy();
  locks['issue-worker.lock.yml'] = lock({ add_comment: { max: 2 } });
  assert.match(checkDeployment(RELATED(), locks).errors.join('\n'), /create-issue is not enabled/);
  delete locks['issue-worker.lock.yml'];
  assert.match(checkDeployment(RELATED(), locks).errors.join('\n'), /issue-worker\.lock\.yml: not found/);
});

// The closer: a plain workflow whose environment the updater generates from related-repos.md.

test('the closer must exist, write to the related repository and use its secret', () => {
  const missing = healthy();
  delete missing['related-repo-closer.yml'];
  assert.match(checkDeployment(RELATED(), missing).errors.join('\n'), /related-repo-closer\.yml: not found; rockcarver\/frodo-cli needs it/);

  const wrongRepo = healthy();
  wrongRepo['related-repo-closer.yml'] = closer('x/y');
  const repoErrors = checkDeployment(RELATED(), wrongRepo).errors;
  assert.equal(repoErrors.length, 1);
  assert.match(repoErrors[0], /CROSS_REPO is not rockcarver\/frodo-cli/);

  const wrongSecret = healthy();
  wrongSecret['related-repo-closer.yml'] = closer('rockcarver/frodo-cli', 'SIGNAL_TOKEN');
  const secretErrors = checkDeployment(RELATED(), wrongSecret).errors;
  assert.equal(secretErrors.length, 1);
  assert.match(secretErrors[0], /CROSS_REPO_TOKEN does not use the secret FRODO_CLI_ISSUES_TOKEN/);

  const neither = healthy();
  neither['related-repo-closer.yml'] = 'env:\n  GH_TOKEN: x\n';
  assert.equal(checkDeployment(RELATED(), neither).errors.length, 2);
});

test('a closer the previous updater installed, with the marker not yet replaced, is a warning to finish, not an error', () => {
  const locks = healthy();
  locks['related-repo-closer.yml'] = 'env:\n  GH_TOKEN: x\n  # concierge:cross-repo-env\n';
  const { errors, warnings } = checkDeployment(RELATED(), locks);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /still has the # concierge:cross-repo-env marker/);
  assert.match(warnings[0], /Run the Concierge updater again/);
  assert.match(warnings[0], /updates nothing in rockcarver\/frodo-cli/);

  // a marker beside a wrong value is a mistake, not a transition
  locks['related-repo-closer.yml'] = 'env:\n  # concierge:cross-repo-env\n  CROSS_REPO: x/y\n';
  assert.match(checkDeployment(RELATED(), locks).errors.join('\n'), /CROSS_REPO is not rockcarver\/frodo-cli/);
});

test('a repository name that only contains the related one is not accepted', () => {
  const locks = healthy();
  locks['related-repo-closer.yml'] = closer('rockcarver/frodo-cli-fork');
  assert.match(checkDeployment(RELATED(), locks).errors.join('\n'), /CROSS_REPO is not rockcarver\/frodo-cli/);
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
  assert.match(other.out, /^::notice::Coding agents get no repository guidance/m);
});

test('main: AGENTS.md or copilot-instructions.md silences the notice; a directory of that name does not', () => {
  assert.doesNotMatch(runMain({ 'AGENTS.md': '# Agents' }).out, /Coding agents get no repository guidance/);
  assert.doesNotMatch(runMain({ '.github/copilot-instructions.md': 'x' }).out, /Coding agents get no repository guidance/);
  assert.match(runMain({ 'AGENTS.md': null }).out, /Coding agents get no repository guidance/);
});

test('main: the notice never changes the outcome of the real checks', () => {
  const related = 'this: a/b\n\nrelated:\n  - role: cli\n    repo: a/c\n    secret: C_TOKEN\n    when: |\n      x\n';
  // A related repository whose compiled workflows are missing: the existing error still fails the check.
  const failing = runMain({ '.github/issue-concierge/related-repos.md': related });
  assert.equal(failing.code, 1);
  assert.match(failing.out, /::error::/);
  assert.match(failing.out, /::notice::/);
  assert.equal(runMain({ '.github/issue-concierge/related-repos.md': related, 'AGENTS.md': 'x' }).code, 1);
});

// Decision records: a notice, never a failure.

test('decision records: docs/decisions/ silences the notice, its absence gives exactly one', () => {
  assert.deepEqual(DECISIONS_DIRS, ['docs/decisions', 'decisions']);
  assert.deepEqual(checkDecisions((d) => d === 'docs/decisions'), []);
  const notices = checkDecisions(() => false);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /docs\/decisions\/ \(or decisions\/ at the repository root when docs\/ is generated\) does not exist/);
  assert.match(notices[0], /shared\/decision-record\.md/);
});

test('decision records: decisions/ at the repository root silences the notice too, and so does having both', () => {
  assert.deepEqual(checkDecisions((d) => d === 'decisions'), []);
  assert.deepEqual(checkDecisions((d) => d === 'decisions' || d === 'docs/decisions'), []);
  // only directories count, and only these two places
  assert.equal(checkDecisions((d) => d === 'decisions/README.md').length, 1);
  assert.equal(checkDecisions((d) => d === 'docs').length, 1);
});

test('main: a repository without decision records gets the notice and still exits 0', () => {
  const bare = runMain({});
  assert.equal(bare.code, 0);
  assert.match(bare.out, /^::notice::Design decisions are not preserved for contributors and agents/m);

  const withGuidance = runMain({ 'AGENTS.md': '# Agents' });
  assert.equal(withGuidance.code, 0);
  assert.match(withGuidance.out, /^::notice::Design decisions are not preserved/m);
  assert.doesNotMatch(withGuidance.out, /Coding agents get no repository guidance/);
});

test('main: docs/decisions/ silences the decision notice; a file of that name does not; the two notices are independent', () => {
  const ok = runMain({ 'docs/decisions/README.md': '# Decisions', 'AGENTS.md': '# Agents' });
  assert.equal(ok.code, 0);
  assert.doesNotMatch(ok.out, /::notice::/);
  assert.match(runMain({ 'docs/decisions': 'x', 'AGENTS.md': '# Agents' }).out, /Design decisions are not preserved/);
  const onlyDecisions = runMain({ 'docs/decisions/0001-x.md': 'x' });
  assert.doesNotMatch(onlyDecisions.out, /Design decisions are not preserved/);
  assert.match(onlyDecisions.out, /Coding agents get no repository guidance/);
});

test('main: decisions/ at the repository root silences the decision notice; a file of that name does not', () => {
  const ok = runMain({ 'decisions/README.md': '# Decisions', 'AGENTS.md': '# Agents' });
  assert.equal(ok.code, 0);
  assert.doesNotMatch(ok.out, /::notice::/);
  assert.match(runMain({ decisions: 'x', 'AGENTS.md': '# Agents' }).out, /Design decisions are not preserved/);
  // a repository with generated docs/: the records live at the root, the guidance notice stays independent
  const generatedDocs = runMain({ 'docs/api/index.html': 'x', 'decisions/0001-x.md': 'x' });
  assert.doesNotMatch(generatedDocs.out, /Design decisions are not preserved/);
  assert.match(generatedDocs.out, /Coding agents get no repository guidance/);
  // the notice names both places
  assert.match(runMain({}).out, /docs\/decisions\/ \(or decisions\/ at the repository root when docs\/ is generated\) does not exist/);
});

test('main: the decision notice never changes the outcome of the real checks', () => {
  const related = 'this: a/b\n\nrelated:\n  - role: cli\n    repo: a/c\n    secret: C_TOKEN\n    when: |\n      x\n';
  const failing = runMain({ '.github/issue-concierge/related-repos.md': related, 'AGENTS.md': '# Agents' });
  assert.equal(failing.code, 1);
  assert.match(failing.out, /Design decisions are not preserved/);
});
