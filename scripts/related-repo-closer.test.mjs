import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  apply,
  closingComment,
  decide,
  LABEL_CANONICAL,
  LABEL_ORIGINAL,
  LABEL_WAITING,
  waitingComment,
} from './related-repo-closer.mjs';

// What went wrong on frodo-lib#806 (2026-10-25): the related-repo closer was a model run. Given the closed issue
// it had to name the original in its outputs, and it named the closed issue itself (repo frodo-lib, number 806),
// so the write was refused (HTTP 403: the token it used belongs to the other repository) and the original,
// frodo-cli#922, was never updated. Everything the closer does is decided by data, so a script does it (record
// 0026, 0027). These tests pin what it decides, what it writes and where, and that it never needs a guess.

const THIS = 'rockcarver/frodo-lib';
const RELATED = 'rockcarver/frodo-cli';
const BOT = { login: 'github-actions[bot]', type: 'Bot' };

const RELATED_REPOS = (requires) => `this: ${RELATED}

related:
  - role: library
    repo: ${THIS}
    secret: FRODO_LIB_ISSUES_TOKEN
${requires ? '    release:\n      requires_consumer_release: true\n      pins: "@rockcarver/frodo-lib"\n' : ''}    when: |
      Only when it is clear that the failing code is in the library.
`;

const canonical = (over = {}) => ({
  number: 806,
  state: 'closed',
  state_reason: 'completed',
  user: { login: 'a-maintainer', type: 'User' },
  author_association: 'MEMBER',
  labels: [{ name: 'bug' }, { name: LABEL_CANONICAL }],
  body: `Original report: ...\n\nReported from ${RELATED}#922`,
  ...over,
});
const original = (over = {}) => ({
  number: 922,
  state: 'open',
  user: { login: 'a-reporter', type: 'User' },
  labels: [{ name: 'bug' }, { name: LABEL_ORIGINAL }],
  ...over,
});
const pointer = (ref = `${THIS}#806`) => ({
  user: BOT,
  body: `Thanks for the report. This is being tracked in ${ref}. We will update this issue when that work is finished.`,
});

/** A GitHub that answers the reads of `decide` from a map of path to { status, data }. */
function github(over = {}) {
  const base = `repos/${RELATED}/issues/922`;
  const routes = {
    [base]: { status: 200, data: original() },
    [`${base}/comments?per_page=100&page=1`]: { status: 200, data: [pointer()] },
    [`repos/${RELATED}/contents/.github/agentic-workflows/related-repos.md`]: {
      status: 200,
      data: { content: Buffer.from(RELATED_REPOS(true)).toString('base64') },
    },
    ...over,
  };
  const reads = [];
  const api = (p) => {
    reads.push(p);
    return routes[p] ?? { status: 404, data: null };
  };
  return { api, reads, base };
}
const ctxFor = (gh, over = {}) => ({ thisRepo: THIS, relatedRepo: RELATED, api: gh.api, dryRun: false, ...over });

function writes() {
  const calls = [];
  return {
    calls,
    addLabel: (repo, n, label) => calls.push(['label', repo, n, label]),
    comment: (repo, n, body) => calls.push(['comment', repo, n, body]),
    close: (repo, n) => calls.push(['close', repo, n]),
  };
}

// ---- decide: what it does ----------------------------------------------------------------------------------

test('an original whose repository needs a release waits for one: label and comment, never closed', () => {
  const gh = github();
  const verdict = decide(canonical(), ctxFor(gh));
  assert.equal(verdict.action, 'waiting');
  assert.equal(verdict.original.repo, RELATED);
  assert.equal(verdict.original.number, 922);

  const w = writes();
  const did = apply(verdict, canonical(), { ...ctxFor(gh), ...w });
  assert.deepEqual(w.calls, [
    ['label', RELATED, 922, LABEL_WAITING],
    ['comment', RELATED, 922, waitingComment(THIS, 806, RELATED)],
  ]);
  assert.equal(did.length, 2);
});

test('an original whose repository needs no release is commented and closed', () => {
  const gh = github({
    [`repos/${RELATED}/contents/.github/agentic-workflows/related-repos.md`]: {
      status: 200,
      data: { content: Buffer.from(RELATED_REPOS(false)).toString('base64') },
    },
  });
  const verdict = decide(canonical(), ctxFor(gh));
  assert.equal(verdict.action, 'close');
  const w = writes();
  apply(verdict, canonical(), { ...ctxFor(gh), ...w });
  assert.deepEqual(w.calls, [
    ['comment', RELATED, 922, closingComment(THIS, 806)],
    ['close', RELATED, 922],
  ]);
});

test('the comments say what the closer always said, and carry a marker that names the closed issue', () => {
  assert.match(waitingComment(THIS, 806, RELATED), /^The fix is in rockcarver\/frodo-lib#806\. This stays open until a release of rockcarver\/frodo-cli pins a rockcarver\/frodo-lib version that contains that fix\./);
  assert.match(waitingComment(THIS, 806, RELATED), /<!-- related-repo-closer:waiting rockcarver\/frodo-lib#806 -->$/);
  assert.match(closingComment(THIS, 806), /^The work tracked in rockcarver\/frodo-lib#806 is complete\. Closing this issue\./);
  assert.match(closingComment(THIS, 806), /<!-- related-repo-closer:closed rockcarver\/frodo-lib#806 -->$/);
  // internal terms stay out of what a reporter reads (the marker is an HTML comment, which GitHub does not show)
  const visible = (waitingComment(THIS, 806, RELATED) + closingComment(THIS, 806)).replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(visible, /waiting-for-release|related-repo\b|label/i);
});

test('the original is the issue the link line names, never the closed issue itself (frodo-lib#806)', () => {
  const gh = github();
  const verdict = decide(canonical(), ctxFor(gh));
  assert.equal(verdict.original.repo, RELATED);
  assert.notEqual(verdict.original.repo, THIS);
  assert.notEqual(verdict.original.number, 806);
  const w = writes();
  apply(verdict, canonical(), { ...ctxFor(gh), ...w });
  for (const call of w.calls) assert.equal(call[1], RELATED, 'every write goes to the related repository');
});

test('a link line with a note after the number still names the original', () => {
  const body = `x\n\nReported from ${RELATED}#922 (the original report, with the full evidence, is there).`;
  assert.equal(decide(canonical({ body }), ctxFor(github())).action, 'waiting');
});

test('a closed state without a reason counts as completed', () => {
  assert.equal(decide(canonical({ state_reason: null }), ctxFor(github())).action, 'waiting');
});

test('the repository comparison ignores case', () => {
  assert.equal(decide(canonical(), ctxFor(github(), { relatedRepo: 'RockCarver/Frodo-CLI' })).action, 'waiting');
});

// ---- apply: finishing, not repeating -----------------------------------------------------------------------

test('a second run finds the label and the comment and writes nothing more', () => {
  const base = `repos/${RELATED}/issues/922`;
  const gh = github({
    [base]: { status: 200, data: original({ labels: [{ name: LABEL_ORIGINAL }, { name: LABEL_WAITING }] }) },
    [`${base}/comments?per_page=100&page=1`]: { status: 200, data: [pointer(), { user: { login: 'someone', type: 'User' }, body: waitingComment(THIS, 806, RELATED) }] },
  });
  const verdict = decide(canonical(), ctxFor(gh));
  const w = writes();
  assert.deepEqual(apply(verdict, canonical(), { ...ctxFor(gh), ...w }), []);
  assert.deepEqual(w.calls, []);
});

test('a run that stopped after the label still posts the comment, and one after the comment still labels', () => {
  const base = `repos/${RELATED}/issues/922`;
  const labelled = github({ [base]: { status: 200, data: original({ labels: [{ name: LABEL_ORIGINAL }, { name: LABEL_WAITING }] }) } });
  let w = writes();
  apply(decide(canonical(), ctxFor(labelled)), canonical(), { ...ctxFor(labelled), ...w });
  assert.deepEqual(w.calls.map((c) => c[0]), ['comment']);

  const commented = github({ [`${base}/comments?per_page=100&page=1`]: { status: 200, data: [pointer(), { user: BOT, body: waitingComment(THIS, 806, RELATED) }] } });
  w = writes();
  apply(decide(canonical(), ctxFor(commented)), canonical(), { ...ctxFor(commented), ...w });
  assert.deepEqual(w.calls.map((c) => c[0]), ['label']);
});

test('a close that stopped after the comment still closes, without commenting again', () => {
  const base = `repos/${RELATED}/issues/922`;
  const gh = github({
    [`repos/${RELATED}/contents/.github/agentic-workflows/related-repos.md`]: {
      status: 200,
      data: { content: Buffer.from(RELATED_REPOS(false)).toString('base64') },
    },
    [`${base}/comments?per_page=100&page=1`]: { status: 200, data: [pointer(), { user: BOT, body: closingComment(THIS, 806) }] },
  });
  const w = writes();
  apply(decide(canonical(), ctxFor(gh)), canonical(), { ...ctxFor(gh), ...w });
  assert.deepEqual(w.calls, [['close', RELATED, 922]]);
});

test('a dry run of a close decides everything and writes nothing', () => {
  const gh = github({
    [`repos/${RELATED}/contents/.github/agentic-workflows/related-repos.md`]: {
      status: 200,
      data: { content: Buffer.from(RELATED_REPOS(false)).toString('base64') },
    },
  });
  const w = writes();
  const did = apply(decide(canonical(), ctxFor(gh)), canonical(), { ...ctxFor(gh, { dryRun: true }), ...w });
  assert.deepEqual(did, ['commented on rockcarver/frodo-cli#922', 'closed rockcarver/frodo-cli#922']);
  assert.deepEqual(w.calls, []);
});

test('who opened the canonical issue is not asked: the workflow token cannot see a private organization membership', () => {
  // frodo-lib#806 was opened by a maintainer, and the workflow token reported the association as NONE or CONTRIBUTOR
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR', 'NONE', 'FIRST_TIMER', undefined]) {
    assert.equal(decide(canonical({ author_association: association }), ctxFor(github())).action, 'waiting', String(association));
  }
});

test('a stranger\'s issue that links the original is not confirmed: the harness\'s comment names another issue', () => {
  const verdict = decide(canonical({ number: 999, author_association: 'NONE' }), ctxFor(github()));
  assert.equal(verdict.action, 'skip');
  assert.match(verdict.reason, /no comment from the harness that names rockcarver\/frodo-lib#999/);
});

test('a dry run decides everything and writes nothing', () => {
  const gh = github();
  const w = writes();
  const did = apply(decide(canonical(), ctxFor(gh)), canonical(), { ...ctxFor(gh, { dryRun: true }), ...w });
  assert.equal(did.length, 2);
  assert.deepEqual(w.calls, []);
});

// ---- decide: when it does nothing --------------------------------------------------------------------------

const skips = [
  ['a pull request', canonical({ pull_request: {} }), /pull request/],
  ['an issue that is not closed', canonical({ state: 'open' }), /not closed/],
  ['an issue opened by a bot', canonical({ user: { login: 'github-actions[bot]', type: 'Bot' } }), /bot/],
  ['an issue without the link label', canonical({ labels: [{ name: 'bug' }] }), /does not carry original-in-related-repo/],
  ['an issue closed as not planned', canonical({ state_reason: 'not_planned' }), /not planned.*left to a maintainer/],
  ['an issue closed as a duplicate', canonical({ state_reason: 'duplicate' }), /duplicate.*left to a maintainer/],
  ['an issue with no link', canonical({ body: 'no link here' }), /no link to an original/],
  ['a link into a repository that is not the related one', canonical({ body: 'Reported from someone/else#1' }), /no link to an original issue in rockcarver\/frodo-cli/],
  ['a link inside a sentence, not at the start of a line', canonical({ body: `see Reported from ${RELATED}#922 above` }), /no link to an original/],
];
for (const [name, issue, reason] of skips) {
  test(`nothing is done for ${name}`, () => {
    const gh = github();
    const verdict = decide(issue, ctxFor(gh));
    assert.equal(verdict.action, 'skip');
    assert.match(verdict.reason, reason);
    assert.deepEqual(gh.reads, [], 'nothing is read before the cheap checks have passed');
  });
}

test('nothing is done where no related repository is configured', () => {
  const verdict = decide(canonical(), ctxFor(github(), { relatedRepo: '' }));
  assert.equal(verdict.action, 'skip');
  assert.match(verdict.reason, /no related repository with a secret/);
});

const unconfirmed = [
  ['an original that cannot be read', { [`repos/${RELATED}/issues/922`]: { status: 404, data: null } }, /could not be read \(HTTP 404\)/],
  ['an original that is a pull request', { [`repos/${RELATED}/issues/922`]: { status: 200, data: original({ pull_request: {} }) } }, /is a pull request/],
  ['an original without related-repo (unlinked by a maintainer)', { [`repos/${RELATED}/issues/922`]: { status: 200, data: original({ labels: [{ name: 'bug' }] }) } }, /does not carry related-repo/],
  ['an original with no comment from the harness', { [`repos/${RELATED}/issues/922/comments?per_page=100&page=1`]: { status: 200, data: [] } }, /no comment from the harness/],
  ['an original whose comments cannot be read', { [`repos/${RELATED}/issues/922/comments?per_page=100&page=1`]: { status: 403, data: null } }, /comments .* could not be read/],
  ['a comment from the harness about another issue', { [`repos/${RELATED}/issues/922/comments?per_page=100&page=1`]: { status: 200, data: [pointer(`${THIS}#8060`)] } }, /no comment from the harness/],
  ['a comment about this issue written by a person', { [`repos/${RELATED}/issues/922/comments?per_page=100&page=1`]: { status: 200, data: [{ user: { login: 'someone', type: 'User' }, body: `tracked in ${THIS}#806` }] } }, /no comment from the harness/],
  ['a comment about this issue by a bot that is not the harness', { [`repos/${RELATED}/issues/922/comments?per_page=100&page=1`]: { status: 200, data: [{ user: { login: 'dependabot[bot]', type: 'Bot' }, body: `tracked in ${THIS}#806` }] } }, /no comment from the harness/],
];
for (const [name, routes, reason] of unconfirmed) {
  test(`nothing is done for ${name}`, () => {
    const gh = github(routes);
    const verdict = decide(canonical(), ctxFor(gh));
    assert.equal(verdict.action, 'skip');
    assert.match(verdict.reason, reason);
  });
}

test('an original that is already closed is left alone', () => {
  const gh = github({ [`repos/${RELATED}/issues/922`]: { status: 200, data: original({ state: 'closed' }) } });
  const verdict = decide(canonical(), ctxFor(gh));
  assert.equal(verdict.action, 'skip');
  assert.match(verdict.reason, /already closed/);
});

test('two links that both confirm are ambiguous: nothing is done', () => {
  const gh = github({
    [`repos/${RELATED}/issues/923`]: { status: 200, data: original({ number: 923 }) },
    [`repos/${RELATED}/issues/923/comments?per_page=100&page=1`]: { status: 200, data: [pointer()] },
  });
  const verdict = decide(canonical({ body: `Reported from ${RELATED}#922\nReported from ${RELATED}#923` }), ctxFor(gh));
  assert.equal(verdict.action, 'skip');
  assert.match(verdict.reason, /ambiguous/);
});

test('when the original repository cannot be read, whether it waits for a release is unknown: an error, nothing is changed', () => {
  const gh = github({ [`repos/${RELATED}/contents/.github/agentic-workflows/related-repos.md`]: { status: 404, data: null } });
  const verdict = decide(canonical(), ctxFor(gh));
  assert.equal(verdict.action, 'error');
  assert.match(verdict.reason, /could not read related-repos\.md of rockcarver\/frodo-cli \(HTTP 404\)/);
});

test('an original repository that does not list this one is left alone', () => {
  const gh = github({
    [`repos/${RELATED}/contents/.github/agentic-workflows/related-repos.md`]: {
      status: 200,
      data: { content: Buffer.from('this: rockcarver/frodo-cli\n\nrelated:\n  - role: other\n    repo: someone/else\n    secret: X\n').toString('base64') },
    },
  });
  const verdict = decide(canonical(), ctxFor(gh));
  assert.equal(verdict.action, 'skip');
  assert.match(verdict.reason, /does not list rockcarver\/frodo-lib/);
});

test('comments are read page by page, so the proof may be on a later page', () => {
  const base = `repos/${RELATED}/issues/922/comments`;
  const filler = Array.from({ length: 100 }, (_, i) => ({ user: { login: 'someone', type: 'User' }, body: `comment ${i}` }));
  const gh = github({
    [`${base}?per_page=100&page=1`]: { status: 200, data: filler },
    [`${base}?per_page=100&page=2`]: { status: 200, data: [pointer()] },
  });
  assert.equal(decide(canonical(), ctxFor(gh)).action, 'waiting');
});

// ---- main: the whole script against a fake `gh` -------------------------------------------------------------
// The fake answers reads for the workflow token and accepts writes only with the cross-repository token, like the
// real thing: the 403 on frodo-lib#806 was a write made to the wrong repository with the other repository's token.

const SCRIPT = path.resolve(import.meta.dirname, 'related-repo-closer.mjs');
const READ_TOKEN = 'read-token';
const WRITE_TOKEN = 'cross-token';

function fakeGh(routes, { failWrites = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'closer-gh-'));
  const log = path.join(dir, 'calls.jsonl');
  const bin = path.join(dir, 'gh');
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(routes));
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const routes = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir, 'routes.json'))}, 'utf8'));
const target = args[1];
const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ target, method, token: process.env.GH_TOKEN, args: args.slice(2) }) + '\\n');
if (method !== 'GET') {
  if (${JSON.stringify(failWrites)} || process.env.GH_TOKEN !== ${JSON.stringify(WRITE_TOKEN)}) {
    process.stderr.write('gh: Resource not accessible by personal access token (HTTP 403)\\n');
    process.exit(1);
  }
  process.stdout.write('{}');
} else {
  if (process.env.GH_TOKEN !== ${JSON.stringify(READ_TOKEN)}) { process.stderr.write('gh: Bad credentials (HTTP 401)\\n'); process.exit(1); }
  const r = routes[target];
  if (!r || r.status !== 200) { process.stderr.write('gh: Not Found (HTTP ' + (r ? r.status : 404) + ')\\n'); process.exit(1); }
  process.stdout.write(JSON.stringify(r.data));
}
`,
    { mode: 0o755 }
  );
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { dir, calls };
}

function runMain(routes, { env = {}, args = [], failWrites = false } = {}) {
  const gh = fakeGh(routes, { failWrites });
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: {
      PATH: `${gh.dir}${path.delimiter}${process.env.PATH}`,
      GITHUB_REPOSITORY: THIS,
      ISSUE_NUMBER: '806',
      GH_TOKEN: READ_TOKEN,
      CROSS_REPO: RELATED,
      CROSS_REPO_TOKEN: WRITE_TOKEN,
      ...env,
    },
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout + r.stderr, calls: gh.calls() };
}

const mainRoutes = (requires = true) => ({
  [`repos/${THIS}/issues/806`]: { status: 200, data: canonical() },
  [`repos/${RELATED}/issues/922`]: { status: 200, data: original() },
  [`repos/${RELATED}/issues/922/comments?per_page=100&page=1`]: { status: 200, data: [pointer()] },
  [`repos/${RELATED}/contents/.github/agentic-workflows/related-repos.md`]: {
    status: 200,
    data: { content: Buffer.from(RELATED_REPOS(requires)).toString('base64') },
  },
});

test('main: labels and comments on the original with the cross-repository token, and reads with the workflow token', () => {
  const r = runMain(mainRoutes(true));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /#806: waits for a release: labelled rockcarver\/frodo-cli#922 waiting-for-release, commented on rockcarver\/frodo-cli#922/);
  const reads = r.calls.filter((c) => c.method === 'GET');
  const written = r.calls.filter((c) => c.method !== 'GET');
  assert.ok(reads.length >= 4 && reads.every((c) => c.token === READ_TOKEN), 'reads use the workflow token');
  assert.ok(written.every((c) => c.token === WRITE_TOKEN), 'writes use the cross-repository token');
  assert.deepEqual(written.map((c) => `${c.method} ${c.target}`), [
    'POST repos/rockcarver/frodo-cli/issues/922/labels',
    'POST repos/rockcarver/frodo-cli/issues/922/comments',
  ]);
  assert.ok(written[0].args.includes('labels[]=waiting-for-release'));
  assert.ok(written[1].args.includes(`body=${waitingComment(THIS, 806, RELATED)}`));
});

test('main: closes an original that needs no release, as completed', () => {
  const r = runMain(mainRoutes(false));
  assert.equal(r.status, 0, r.out);
  const written = r.calls.filter((c) => c.method !== 'GET');
  assert.deepEqual(written.map((c) => `${c.method} ${c.target}`), [
    'POST repos/rockcarver/frodo-cli/issues/922/comments',
    'PATCH repos/rockcarver/frodo-cli/issues/922',
  ]);
  assert.ok(written[1].args.includes('state=closed') && written[1].args.includes('state_reason=completed'));
});

test('main: a dry run writes nothing and says so', () => {
  const r = runMain(mainRoutes(true), { args: ['--dry-run'] });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /dry run, nothing written/);
  assert.deepEqual(r.calls.filter((c) => c.method !== 'GET'), []);
});

test('main: a skip is a success and writes nothing', () => {
  const routes = mainRoutes(true);
  routes[`repos/${THIS}/issues/806`] = { status: 200, data: canonical({ state_reason: 'not_planned' }) };
  const r = runMain(routes);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /skipped \(closed as not planned/);
  assert.deepEqual(r.calls.filter((c) => c.method !== 'GET'), []);
});

test('main: a refused write fails the run with the reason, after changing nothing else', () => {
  const r = runMain(mainRoutes(true), { failWrites: true });
  assert.equal(r.status, 1);
  assert.match(r.out, /::error::#806: gh: Resource not accessible by personal access token \(HTTP 403\)/);
  assert.equal(r.calls.filter((c) => c.method !== 'GET').length, 1, 'it stops at the first refused write');
});

test('main: a related repository without its token fails before anything is written', () => {
  const r = runMain(mainRoutes(true), { env: { CROSS_REPO_TOKEN: '' } });
  assert.equal(r.status, 1);
  assert.match(r.out, /rockcarver\/frodo-cli is configured but its token \(CROSS_REPO_TOKEN\) is empty/);
  assert.deepEqual(r.calls.filter((c) => c.method !== 'GET'), []);
});

test('main: no related repository configured is a skip', () => {
  const r = runMain(mainRoutes(true), { env: { CROSS_REPO: '', CROSS_REPO_TOKEN: '' } });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /skipped \(no related repository with a secret is configured here\)/);
});

test('main: the issue that cannot be read, and an unreadable related-repos.md, fail the run and change nothing', () => {
  const noIssue = mainRoutes(true);
  delete noIssue[`repos/${THIS}/issues/806`];
  const a = runMain(noIssue);
  assert.equal(a.status, 1);
  assert.match(a.out, /could not read the issue \(HTTP 404\)/);

  const noConfig = mainRoutes(true);
  delete noConfig[`repos/${RELATED}/contents/.github/agentic-workflows/related-repos.md`];
  const b = runMain(noConfig);
  assert.equal(b.status, 1);
  assert.match(b.out, /could not read related-repos\.md of rockcarver\/frodo-cli \(HTTP 404\).*Nothing changed/);
  assert.deepEqual(b.calls.filter((c) => c.method !== 'GET'), []);
});

test('main: the issue number and the repository are required', () => {
  assert.equal(runMain(mainRoutes(true), { env: { ISSUE_NUMBER: '' } }).status, 1);
  assert.equal(runMain(mainRoutes(true), { env: { ISSUE_NUMBER: 'abc' } }).status, 1);
});

// An opted-out canonical issue, or an original that carries the label, is left alone: no comment, no label, no close
// (https://github.com/vscheuber/repo-concierge/blob/main/docs/decisions/0028-an-item-labelled-no-auto-processing-is-never-touched.md).
test('a canonical issue that carries no-auto-processing is skipped before anything is read', () => {
  const gh = github();
  const verdict = decide(canonical({ labels: [{ name: LABEL_CANONICAL }, { name: 'no-auto-processing' }] }), ctxFor(gh));
  assert.equal(verdict.action, 'skip');
  assert.match(verdict.reason, /carries no-auto-processing/);
  assert.deepEqual(gh.reads, [], 'the original is not even read');
  assert.equal(decide(canonical(), ctxFor(github())).action, 'waiting', 'the control without the label');
});

test('an original that carries no-auto-processing is not commented on, labelled or closed', () => {
  const gh = github({ [`repos/${RELATED}/issues/922`]: { status: 200, data: original({ labels: [{ name: LABEL_ORIGINAL }, { name: 'no-auto-processing' }] }) } });
  const verdict = decide(canonical(), ctxFor(gh));
  assert.equal(verdict.action, 'skip');
  assert.match(verdict.reason, /922: the issue carries no-auto-processing/);
  assert.ok(!gh.reads.some((p) => p.endsWith('/comments?per_page=100&page=1')), 'its comments are not read either');
});
