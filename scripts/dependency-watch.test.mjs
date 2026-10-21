import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseDependencies,
  parseRelatedRepos,
  compareSemver,
  resolveDependency,
  evaluateIssue,
  renderComment,
  STATUS,
  BOT_MARKER,
} from './dependency-watch.mjs';

const RELATED = parseRelatedRepos(`
this: rockcarver/frodo-cli
related:
  - role: library
    repo: rockcarver/frodo-lib
    secret: FRODO_LIB_ISSUES_TOKEN
    release:
      requires_consumer_release: true
      pins: "@rockcarver/frodo-lib"
    when: |
      Functional bugs.
notes: |
  text
`);

test('parseDependencies: explicit declarations only', () => {
  const body = [
    'Depends on: rockcarver/frodo-lib#745',
    '- Blocked by: #12 and https://github.com/o/r/pull/9',
    'requires: other/repo#3',
    'See #99 for background.',
    'Fixes #5',
    'Reported from a/b#7',
  ].join('\n');
  assert.deepEqual(parseDependencies(body), [
    { repo: 'rockcarver/frodo-lib', number: 745 },
    { repo: null, number: 12 },
    { repo: 'o/r', number: 9 },
    { repo: 'other/repo', number: 3 },
  ]);
  assert.deepEqual(parseDependencies('mentions #745 in prose'), []);
});

test('parseRelatedRepos: frodo-style entry', () => {
  assert.deepEqual(RELATED.related, [
    { repo: 'rockcarver/frodo-lib', requiresConsumerRelease: true, pins: '@rockcarver/frodo-lib' },
  ]);
  assert.equal(RELATED.this, 'rockcarver/frodo-cli');
});

test('compareSemver: numeric prerelease ordering, never string order', () => {
  assert.equal(compareSemver('5.0.0-10', '5.0.0-9'), 1);
  assert.equal(compareSemver('5.0.0-9', '5.0.0-10'), -1);
  assert.equal(compareSemver('5.0.0', '5.0.0-10'), 1);
  assert.equal(compareSemver('5.0.0-9', '5.0.0-9'), 0);
  assert.equal(compareSemver('4.15.0', '5.0.0-1'), -1);
  assert.equal(compareSemver('^5.0.0', '5.0.0'), null);
});

// Fake GitHub. `world` maps api paths to responses.
function ctxFor(world, { pinned = null, registry = true, thisRepo = 'rockcarver/frodo-cli', related = RELATED } = {}) {
  return {
    thisRepo,
    related,
    api: async (p) => (p in world ? world[p] : p.split('?')[0] in world ? world[p.split('?')[0]] : null),
    registryHasVersion: async () => registry,
    readPinnedVersion: () => pinned,
  };
}
const LIB = 'rockcarver/frodo-lib';
const dep = { repo: LIB, number: 745 };
const mergedPr = {
  [`repos/${LIB}/issues/745`]: { number: 745, state: 'closed', pull_request: {}, body: '' },
  [`repos/${LIB}/pulls/745`]: { merged: true, state: 'closed', merge_commit_sha: 'abc' },
};
const release = (tag, status) => ({
  [`repos/${LIB}/releases?per_page=100`]: [
    { tag_name: tag, published_at: '2026-10-20T00:00:00Z', draft: false },
  ],
  [`repos/${LIB}/compare/abc...${tag}`]: { status },
});

test('open PR: unmerged', async () => {
  const w = {
    [`repos/${LIB}/issues/745`]: { number: 745, state: 'open', pull_request: {}, body: '' },
    [`repos/${LIB}/pulls/745`]: { merged: false, state: 'open' },
  };
  assert.equal((await resolveDependency(dep, ctxFor(w))).status, STATUS.UNMERGED);
});

test('PR closed without merge: needs a maintainer', async () => {
  const w = {
    [`repos/${LIB}/issues/745`]: { number: 745, state: 'closed', pull_request: {}, body: '' },
    [`repos/${LIB}/pulls/745`]: { merged: false, state: 'closed' },
  };
  assert.equal((await resolveDependency(dep, ctxFor(w))).status, STATUS.CLOSED_UNMERGED);
});

test('merged but no release contains it', async () => {
  const w = { ...mergedPr, ...release('v5.0.0-9', 'behind') };
  assert.equal((await resolveDependency(dep, ctxFor(w))).status, STATUS.NOT_RELEASED);
});

test('released but not yet on the registry', async () => {
  const w = { ...mergedPr, ...release('v5.0.0-9', 'ahead') };
  const r = await resolveDependency(dep, ctxFor(w, { registry: false }));
  assert.equal(r.status, STATUS.NOT_INSTALLABLE);
});

test('published but this repo is not pinned to it', async () => {
  const w = { ...mergedPr, ...release('v5.0.0-9', 'ahead') };
  assert.equal((await resolveDependency(dep, ctxFor(w, { pinned: '5.0.0-8' }))).status, STATUS.NOT_PINNED);
  assert.equal((await resolveDependency(dep, ctxFor(w, { pinned: null }))).status, STATUS.NOT_PINNED);
});

test('pinned to a range: maintainer must look', async () => {
  const w = { ...mergedPr, ...release('v5.0.0-9', 'ahead') };
  const r = await resolveDependency(dep, ctxFor(w, { pinned: 'range:^5.0.0-9' }));
  assert.equal(r.status, STATUS.PIN_UNREADABLE);
});

test('merged, released, published and pinned (or newer): satisfied', async () => {
  const w = { ...mergedPr, ...release('v5.0.0-9', 'identical') };
  assert.equal((await resolveDependency(dep, ctxFor(w, { pinned: '5.0.0-9' }))).status, STATUS.SATISFIED);
  assert.equal((await resolveDependency(dep, ctxFor(w, { pinned: '5.0.0-10' }))).status, STATUS.SATISFIED);
});

test('related issue: closing commit is followed to a release', async () => {
  const w = {
    [`repos/${LIB}/issues/744`]: { number: 744, state: 'closed', state_reason: 'completed', body: '' },
    [`repos/${LIB}/issues/744/timeline?per_page=100`]: [{ event: 'closed', commit_id: 'abc' }],
    ...release('v5.0.0-9', 'ahead'),
  };
  const r = await resolveDependency({ repo: LIB, number: 744 }, ctxFor(w, { pinned: '5.0.0-9' }));
  assert.equal(r.status, STATUS.SATISFIED);
});

test('related issue closed with no linked change, or as not planned', async () => {
  const base = { number: 744, state: 'closed', body: '' };
  const w1 = {
    [`repos/${LIB}/issues/744`]: { ...base, state_reason: 'completed' },
    [`repos/${LIB}/issues/744/timeline?per_page=100`]: [{ event: 'closed' }],
  };
  assert.equal((await resolveDependency({ repo: LIB, number: 744 }, ctxFor(w1))).status, STATUS.NO_LINKED_CHANGE);
  const w2 = { [`repos/${LIB}/issues/744`]: { ...base, state_reason: 'not_planned' } };
  assert.equal((await resolveDependency({ repo: LIB, number: 744 }, ctxFor(w2))).status, STATUS.CLOSED_UNMERGED);
});

test('same-repo dependency only needs to be merged or closed', async () => {
  const w = {
    'rockcarver/frodo-cli/x': null,
    'repos/rockcarver/frodo-cli/issues/10': { number: 10, state: 'closed', state_reason: 'completed', body: '' },
  };
  const r = await resolveDependency({ repo: null, number: 10 }, ctxFor(w));
  assert.equal(r.status, STATUS.SATISFIED);
});

test('unreadable reference, self reference and direct cycle', async () => {
  assert.equal((await resolveDependency({ repo: LIB, number: 1 }, ctxFor({}))).status, STATUS.UNREADABLE);
  assert.equal(await resolveDependency({ repo: null, number: 5 }, { ...ctxFor({}), issueNumber: 5 }), null);
  const w = {
    [`repos/${LIB}/issues/744`]: { number: 744, state: 'open', body: 'Depends on: rockcarver/frodo-cli#5' },
  };
  const r = await resolveDependency({ repo: LIB, number: 744 }, { ...ctxFor(w), issueNumber: 5 });
  assert.equal(r.status, STATUS.CYCLE);
});

test('evaluateIssue: no declarations is satisfied; bot comments are ignored; deps deduplicated', async () => {
  const none = await evaluateIssue({ number: 5, body: 'mentions #745' }, [], ctxFor({}));
  assert.equal(none.satisfied, true);
  const w = {
    [`repos/${LIB}/issues/745`]: { number: 745, state: 'open', pull_request: {}, body: '' },
    [`repos/${LIB}/pulls/745`]: { merged: false, state: 'open' },
  };
  const v = await evaluateIssue(
    { number: 5, body: `Depends on: ${LIB}#745` },
    [{ body: `Requires: ${LIB}#745` }, { body: `${BOT_MARKER}\nDepends on: x/y#1` }],
    ctxFor(w)
  );
  assert.equal(v.results.length, 1);
  assert.equal(v.satisfied, false);
  assert.equal(v.needsMaintainer, false);
});

test('comment wording is plain language and carries the marker', () => {
  const text = renderComment([
    { ref: `${LIB}#745`, status: STATUS.NOT_RELEASED },
    { ref: `${LIB}#744`, status: STATUS.SATISFIED },
  ]);
  assert.ok(text.startsWith(BOT_MARKER));
  assert.match(text, /has been merged but is not in a release yet/);
  assert.doesNotMatch(text, /744/);
  assert.doesNotMatch(text, /label|gate|harness|workflow|dependency-required/i);
});

test('the compare lookup asks for the status only (the full payload can exceed 1 MB)', async () => {
  const w = { ...mergedPr, ...release('v5.0.0-9', 'ahead') };
  const calls = [];
  const ctx = ctxFor(w, { pinned: '5.0.0-9' });
  const api = ctx.api;
  ctx.api = async (p, opts) => {
    calls.push([p, opts]);
    return api(p, opts);
  };
  await resolveDependency(dep, ctx);
  const compare = calls.find(([p]) => p.includes('/compare/'));
  assert.ok(compare);
  assert.equal(compare[1]?.jq, '{status: .status}');
});
