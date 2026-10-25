import test from 'node:test';
import assert from 'node:assert/strict';
import { addedPermissions, groupByDiff, listFiles, normalizeDiff } from '../.claude/skills/cut-a-concierge-release/scripts/compare-update-prs.mjs';
import { compareManifests, manifestProblems, parseArgs } from '../.claude/skills/cut-a-concierge-release/scripts/verify-release.mjs';
import { lockProblems, parseArgs as parseRolloutArgs, withoutCrossRepo } from '../.claude/skills/cut-a-concierge-release/scripts/verify-rollout.mjs';

// The helpers behind the cut-a-concierge-release skill. They are read-only and are what a person (or an
// agent) trusts when deciding that a release is good and that every deployment got the same update, so the
// decisions in them are pinned here: what counts as a surprise and what is masked as "differs by design".

const manifest = (files, extra = {}) => ({ version: '1.0.18', tag: 'v1.0.18', commit: 'c0ffee', ghAw: { version: 'v0.92.0' }, files: files.map(([p, sha, dest]) => ({ path: p, sha256: sha, dest })), ...extra });

test('compareManifests lists added, removed and changed files by digest', () => {
  const before = manifest([['a.md', '1'], ['b.md', '2'], ['c.md', '3']]);
  const after = manifest([['a.md', '1'], ['b.md', 'X'], ['d.md', '4']]);
  assert.deepEqual(compareManifests(before, after), { added: ['d.md'], removed: ['c.md'], changed: ['b.md'] });
  assert.deepEqual(compareManifests(after, after), { added: [], removed: [], changed: [] });
  assert.deepEqual(compareManifests(undefined, after).added, ['a.md', 'b.md', 'd.md']);
});

test('manifestProblems: the manifest is for this tag and names the tag commit', () => {
  assert.deepEqual(manifestProblems(manifest([]), 'v1.0.18', 'c0ffee'), []);
  assert.match(manifestProblems(manifest([]), 'v1.0.19', 'c0ffee').join(), /tag is v1\.0\.18, expected v1\.0\.19/);
  assert.match(manifestProblems(manifest([], { version: '1.0.17' }), 'v1.0.18', 'c0ffee').join(), /version is 1\.0\.17/);
  assert.match(manifestProblems(manifest([]), 'v1.0.18', 'deadbeef').join(), /not the tag's commit deadbeef/);
});

test('arguments: a tag, optional --previous and --repo; anything else is an error', () => {
  assert.deepEqual(parseArgs(['v1.0.18']), { repo: 'vscheuber/repo-concierge', tag: 'v1.0.18' });
  assert.deepEqual(parseArgs(['v1.0.18', '--previous', 'v1.0.16', '--repo', 'o/r']), { repo: 'o/r', tag: 'v1.0.18', previous: 'v1.0.16' });
  assert.ok(parseArgs(['v1', 'v2']).error);
  assert.deepEqual(parseRolloutArgs(['v1.0.18', 'a/b', 'c/d']), { repos: ['a/b', 'c/d'], source: 'vscheuber/repo-concierge', tag: 'v1.0.18' });
  assert.ok(parseRolloutArgs(['v1.0.18', '--bogus']).error);
});

const gawMetadata = (frontmatter, body) => `# gh-aw-metadata: {"schema_version":"v4","frontmatter_hash":"${frontmatter}","body_hash":"${body}","compiler_version":"v0.92.0"}`;
const gawManifest = (secrets) => `# gh-aw-manifest: {"version":1,"secrets":[${secrets.map((s) => `"${s}"`).join(',')}],"actions":[]}`;
const update = ({ frontmatter, secrets, hunk = '@@ -10,3 +10,4 @@ heading', index = 'index 111..222 100644', extra = [] }) =>
  [
    'diff --git a/.github/workflows/issue-worker.lock.yml b/.github/workflows/issue-worker.lock.yml',
    index,
    '--- a/.github/workflows/issue-worker.lock.yml',
    '+++ b/.github/workflows/issue-worker.lock.yml',
    '@@ -1,3 +1,3 @@',
    `-${gawMetadata(frontmatter, 'old')}`,
    `+${gawMetadata(frontmatter, 'new')}`,
    ` ${gawManifest(secrets)}`,
    hunk,
    '+changed line',
    ...extra,
  ].join('\n');

test('normalizeDiff masks what differs per repository and nothing else', () => {
  const lib = update({ frontmatter: 'aaa', secrets: ['SIGNAL_TOKEN', 'LIB_TOKEN'], hunk: '@@ -147,6 +147,8 @@ heading', index: 'index 1..2 100644' });
  const action = update({ frontmatter: 'bbb', secrets: ['SIGNAL_TOKEN'], hunk: '@@ -145,6 +145,8 @@ heading', index: 'index 3..4 100644' });
  assert.equal(normalizeDiff(lib), normalizeDiff(action));
  // a real difference survives: another body hash, another changed line, another gh-aw version
  assert.notEqual(normalizeDiff(lib), normalizeDiff(update({ frontmatter: 'aaa', secrets: ['SIGNAL_TOKEN'], extra: ['+one more line'] })));
  assert.notEqual(normalizeDiff(lib), normalizeDiff(lib.replace('"body_hash":"new"', '"body_hash":"other"')));
  assert.notEqual(normalizeDiff(lib), normalizeDiff(lib.replace('v0.92.0', 'v0.93.0')));
});

test('groupByDiff puts identical updates together and splits a different one', () => {
  const same = (n) => [`repo${n}`, update({ frontmatter: `a${n}`, secrets: [`S${n}`], hunk: `@@ -${n},6 +${n},8 @@ heading` })];
  const odd = ['odd', update({ frontmatter: 'ab', secrets: [], extra: ['+surprise'] })];
  const groups = groupByDiff([same(1), same(2), odd, same(3)]);
  assert.deepEqual(groups.map((g) => g.names), [['repo1', 'repo2', 'repo3'], ['odd']]);
});

test('listFiles reports added, removed, renamed and modified files', () => {
  const diff = [
    'diff --git a/new.yml b/new.yml', 'new file mode 100644',
    'diff --git a/gone.mjs b/gone.mjs', 'deleted file mode 100644',
    'diff --git a/old.md b/new.md', 'rename from old.md', 'rename to new.md',
    'diff --git a/same.md b/same.md', 'index 1..2 100644',
  ].join('\n');
  assert.deepEqual(listFiles(diff), [
    { path: 'new.yml', status: 'added' },
    { path: 'gone.mjs', status: 'removed' },
    { path: 'new.md', status: 'renamed' },
    { path: 'same.md', status: 'modified' },
  ]);
});

test('addedPermissions shows the token scopes of added plain workflows only', () => {
  const diff = [
    'diff --git a/.github/workflows/notify.yml b/.github/workflows/notify.yml',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/.github/workflows/notify.yml',
    '@@ -0,0 +1,12 @@',
    '+name: Notify',
    '+permissions:',
    '+  contents: read',
    '+jobs:',
    '+  post:',
    '+    permissions:',
    '+      issues: write',
    '+    runs-on: ubuntu-latest',
    'diff --git a/.github/workflows/lock.lock.yml b/.github/workflows/lock.lock.yml',
    'new file mode 100644',
    '+permissions:',
    '+  contents: write',
    'diff --git a/.github/workflows/existing.yml b/.github/workflows/existing.yml',
    '+permissions:',
    '+  contents: write',
  ].join('\n');
  assert.deepEqual(addedPermissions(diff), [
    { file: '.github/workflows/notify.yml', block: ['permissions:', 'contents: read'] },
    { file: '.github/workflows/notify.yml', block: ['permissions:', 'issues: write'] },
  ]);
});

test('lockProblems: compiler version and the role gate', () => {
  const lock = (compiler, extra = '') => `# gh-aw-metadata: {"compiler_version":"${compiler}"}\n${extra}`;
  const withRoles = '          id: check_membership\n          GH_AW_REQUIRED_ROLES: "admin,maintainer,write"\n';
  assert.deepEqual(lockProblems('pr-worker', lock('v0.92.0', withRoles), 'v0.92.0'), []);
  assert.deepEqual(lockProblems('issue-worker', lock('v0.92.0'), 'v0.92.0'), []);
  assert.match(lockProblems('pr-worker', lock('v0.91.0', withRoles), 'v0.92.0').join(), /compiled with v0\.91\.0/);
  assert.match(lockProblems('issue-worker', lock('v0.92.0', withRoles), 'v0.92.0').join(), /still checks team membership/);
  assert.match(lockProblems('pr-worker', lock('v0.92.0'), 'v0.92.0').join(), /default roles/);
  assert.match(lockProblems('pr-worker', lock('v0.92.0', '          GH_AW_REQUIRED_ROLES: "admin,maintainer,write"\n'), 'v0.92.0').join(), /default roles/);
  assert.match(lockProblems('pr-worker', lock('v0.92.0', '          id: check_membership\n          GH_AW_REQUIRED_ROLES: "all"\n'), 'v0.92.0').join(), /default roles/);
});

test('withoutCrossRepo ignores the generated environment of a plain workflow and its marker, nothing else', () => {
  const source = 'env:\n  GH_TOKEN: x\n  # concierge:cross-repo-env\nrun: y\n';
  const deployed = 'env:\n  GH_TOKEN: x\n  CROSS_REPO: o/r\n  CROSS_REPO_TOKEN: ${{ secrets.X }}\nrun: y\n';
  assert.equal(withoutCrossRepo(source), withoutCrossRepo(deployed));
  assert.notEqual(withoutCrossRepo(source), withoutCrossRepo(deployed.replace('GH_TOKEN: x', 'GH_TOKEN: z')));
});

test('withoutCrossRepo ignores the generated settings and the marker, nothing else', () => {
  const source = 'create-issue:\n  max: 1\n  # concierge:cross-repo\nthreat-detection: on\n';
  const deployed = 'create-issue:\n  max: 1\n  github-token: ${{ secrets.X }}\n  allowed-repos: ["o/r"]\nthreat-detection: on\n';
  assert.equal(withoutCrossRepo(source), withoutCrossRepo(deployed));
  assert.notEqual(withoutCrossRepo(source), withoutCrossRepo(deployed.replace('max: 1', 'max: 5')));
});
