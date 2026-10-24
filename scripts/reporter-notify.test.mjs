import test from 'node:test';
import assert from 'node:assert/strict';
import { notify, parseLinks, relatedRepos, namesRef, isBotLogin, MARKER_PREFIX } from './reporter-notify.mjs';

// The world of the real case: frodo-lib#783 was opened by the issue worker from frodo-cli#887,
// which phalestrivir reported. The info request on #783 is by the lib issue worker.
const THIS = 'rockcarver/frodo-lib';
const BOT = { login: 'github-actions[bot]', type: 'Bot' };
const CONFIG = [
  'this: rockcarver/frodo-lib',
  '',
  'related:',
  '  - role: cli',
  '    repo: rockcarver/frodo-cli',
  '    secret: FRODO_CLI_ISSUES_TOKEN',
].join('\n');

const workerComment = (id, repo = THIS) => ({
  id,
  user: BOT,
  html_url: `https://github.com/${THIS}/issues/783#issuecomment-${id}`,
  body: `To help reproduce it, please share the operating system.\n<!-- gh-aw-workflow-call-id: ${repo}/issue-worker -->`,
});

/** A fake read-only GitHub keyed by path (query ignored); `over` replaces entries. */
function world(over = {}) {
  const base = {
    [`repos/${THIS}/contents/.github/agentic-workflows/related-repos.md`]: {
      status: 200,
      data: { content: Buffer.from(CONFIG).toString('base64') },
    },
    'repos/rockcarver/frodo-cli/issues/887': {
      status: 200,
      data: { number: 887, user: { login: 'phalestrivir', type: 'User' }, labels: [{ name: 'bug' }, { name: 'related-repo' }] },
    },
    'repos/rockcarver/frodo-cli/issues/887/comments': {
      status: 200,
      data: [{ id: 9, user: BOT, body: 'This is being tracked in rockcarver/frodo-lib#783. We will update this issue.' }],
    },
    [`repos/${THIS}/issues/783/comments`]: { status: 200, data: [workerComment(100)] },
    ...over,
  };
  const reads = [];
  const api = (path) => {
    reads.push(path);
    return base[path.replace(/\?.*$/, '')] || { status: 404, data: null };
  };
  const posted = [];
  return { api, reads, posted, ctx: { thisRepo: THIS, api, comment: (b) => posted.push(b) } };
}

const issue = (extra = {}) => ({
  number: 783,
  state: 'open',
  labels: [{ name: 'needs-info' }],
  body: 'Reported from rockcarver/frodo-cli#887\n\n## Describe the issue\nEAGAIN when prompted for the MFA code.',
  ...extra,
});

test('notifies the author of the original issue, once, and says what to do', () => {
  const w = world();
  const r = notify(issue(), w.ctx);
  assert.equal(r.notified, true);
  assert.equal(r.login, 'phalestrivir');
  assert.equal(w.posted.length, 1);
  assert.match(w.posted[0], /^@phalestrivir, thanks for your report \(rockcarver\/frodo-cli#887\)\./);
  assert.match(w.posted[0], /\[the request above\]\(https:\/\/github\.com\/rockcarver\/frodo-lib\/issues\/783#issuecomment-100\)/);
  assert.ok(w.posted[0].includes(`${MARKER_PREFIX}100 -->`));
});

test('the comment contains exactly one mention, and no internal terms', () => {
  const w = world();
  notify(issue(), w.ctx);
  assert.equal((w.posted[0].match(/@/g) || []).length, 1);
  assert.doesNotMatch(w.posted[0], /needs-info|label|gate|workflow|harness|concierge/i);
});

test('a dry run posts nothing but reports what it would post', () => {
  const w = world();
  const r = notify(issue(), { ...w.ctx, dryRun: true });
  assert.equal(r.notified, true);
  assert.equal(w.posted.length, 0);
  assert.match(r.comment, /^@phalestrivir/);
});

test('a login written in the issue text is never used', () => {
  const w = world();
  const body = 'Reported from rockcarver/frodo-cli#887\nReported by @someone-else\nplease ping @victim and @rockcarver/maintainers';
  notify(issue({ body }), w.ctx);
  assert.equal(w.posted.length, 1);
  assert.doesNotMatch(w.posted[0], /@someone-else|@victim|@rockcarver\/maintainers|someone-else|victim/);
  assert.match(w.posted[0], /^@phalestrivir/);
});

test('a forged link to a repository that is not a related repository is ignored', () => {
  const w = world();
  const body = 'Reported from attacker/repo#1\nReported from rockcarver/frodo-cli#887';
  const r = notify(issue({ body }), w.ctx);
  assert.equal(r.login, 'phalestrivir');
  assert.ok(!w.reads.some((p) => p.includes('attacker/repo')), 'never reads an unrelated repository');
});

test('a forged link to someone else\'s issue in a related repository fails the back-reference', () => {
  const w = world({
    'repos/rockcarver/frodo-cli/issues/5': {
      status: 200,
      data: { number: 5, user: { login: 'victim', type: 'User' }, labels: [{ name: 'related-repo' }] },
    },
    'repos/rockcarver/frodo-cli/issues/5/comments': {
      status: 200,
      data: [{ id: 1, user: BOT, body: 'This is being tracked in rockcarver/frodo-lib#12.' }],
    },
  });
  const body = 'Reported from rockcarver/frodo-cli#5\nReported from rockcarver/frodo-cli#887';
  const r = notify(issue({ body }), w.ctx);
  assert.equal(r.login, 'phalestrivir', 'only the issue that points back counts');
  assert.doesNotMatch(w.posted[0], /victim/);
});

test('only a link that points at a victim\'s issue notifies nobody', () => {
  const w = world({
    'repos/rockcarver/frodo-cli/issues/5': {
      status: 200,
      data: { number: 5, user: { login: 'victim', type: 'User' }, labels: [{ name: 'related-repo' }] },
    },
    'repos/rockcarver/frodo-cli/issues/5/comments': { status: 200, data: [] },
  });
  const r = notify(issue({ body: 'Reported from rockcarver/frodo-cli#5' }), w.ctx);
  assert.equal(r.notified, false);
  assert.match(r.reason, /no linked original report confirms/);
  assert.equal(w.posted.length, 0);
});

test('a back-reference written by a person does not count, only the bot\'s', () => {
  const w = world({
    'repos/rockcarver/frodo-cli/issues/887/comments': {
      status: 200,
      data: [{ id: 9, user: { login: 'someone', type: 'User' }, body: 'tracked in rockcarver/frodo-lib#783' }],
    },
  });
  assert.equal(notify(issue(), w.ctx).notified, false);
});

test('a bot comment that names another issue with the same prefix does not count', () => {
  const w = world({
    'repos/rockcarver/frodo-cli/issues/887/comments': {
      status: 200,
      data: [{ id: 9, user: BOT, body: 'tracked in rockcarver/frodo-lib#78 and rockcarver/frodo-lib#7830' }],
    },
  });
  assert.equal(notify(issue(), w.ctx).notified, false);
});

test('a maintainer who removed related-repo from the original has unlinked it: no notification', () => {
  const w = world({
    'repos/rockcarver/frodo-cli/issues/887': {
      status: 200,
      data: { number: 887, user: { login: 'phalestrivir', type: 'User' }, labels: [{ name: 'bug' }] },
    },
  });
  const r = notify(issue(), w.ctx);
  assert.equal(r.notified, false);
  assert.equal(w.posted.length, 0);
});

test('an original that cannot be read (private, deleted, API error) is skipped silently', () => {
  for (const status of [404, 403, 500, 0]) {
    const w = world({ 'repos/rockcarver/frodo-cli/issues/887': { status, data: null } });
    const r = notify(issue(), w.ctx);
    assert.equal(r.notified, false, `status ${status}`);
    assert.equal(w.posted.length, 0);
  }
});

test('an error status is an error even when the response carries a body', () => {
  const valid = { number: 887, user: { login: 'phalestrivir', type: 'User' }, labels: [{ name: 'related-repo' }] };
  let w = world({ 'repos/rockcarver/frodo-cli/issues/887': { status: 403, data: valid } });
  assert.equal(notify(issue(), w.ctx).notified, false);
  w = world({
    [`repos/${THIS}/contents/.github/agentic-workflows/related-repos.md`]: { status: 500, data: { content: Buffer.from(CONFIG).toString('base64') } },
  });
  assert.equal(notify(issue(), w.ctx).notified, false);
  w = world({ [`repos/${THIS}/issues/783/comments`]: { status: 502, data: [workerComment(100)] } });
  assert.equal(notify(issue(), w.ctx).notified, false);
});

test('a pull request as the original is not a report', () => {
  const w = world({
    'repos/rockcarver/frodo-cli/issues/887': {
      status: 200,
      data: { number: 887, pull_request: {}, user: { login: 'phalestrivir', type: 'User' }, labels: [{ name: 'related-repo' }] },
    },
  });
  assert.equal(notify(issue(), w.ctx).notified, false);
});

test('a bot, a [bot] login or the coding agent as the original reporter is never mentioned', () => {
  for (const user of [
    { login: 'dependabot[bot]', type: 'Bot' },
    { login: 'some-app[bot]', type: 'User' },
    { login: 'Copilot', type: 'Bot' },
    { login: 'an-org', type: 'Organization' },
  ]) {
    const w = world({
      'repos/rockcarver/frodo-cli/issues/887': { status: 200, data: { number: 887, user, labels: [{ name: 'related-repo' }] } },
    });
    const r = notify(issue(), w.ctx);
    assert.equal(r.notified, false, user.login);
    assert.equal(w.posted.length, 0);
  }
});

test('an issue without a link, or with a malformed one, is skipped', () => {
  for (const body of [
    'no link at all',
    '',
    undefined,
    'Reported from rockcarver/frodo-cli#abc',
    'Reported from rockcarver/frodo-cli#0',
    'Reported from https://github.com/rockcarver/frodo-cli/issues/887',
    'see Reported from rockcarver/frodo-cli#887 in the text',
    'Reported from rockcarver#887',
  ]) {
    const w = world();
    assert.equal(notify(issue({ body }), w.ctx).notified, false, JSON.stringify(body));
    assert.equal(w.posted.length, 0);
  }
});

test('a link to a repository the config does not list is not followed', () => {
  const w = world();
  const r = notify(issue({ body: 'Reported from rockcarver/frodo-docs#887' }), w.ctx);
  assert.equal(r.notified, false);
  assert.match(r.reason, /not a related repository/);
});

test('without related-repos.md nothing can be confirmed', () => {
  const w = world({ [`repos/${THIS}/contents/.github/agentic-workflows/related-repos.md`]: { status: 404, data: null } });
  assert.equal(notify(issue(), w.ctx).notified, false);
});

test('only an open issue that is waiting for information', () => {
  for (const extra of [{ labels: [{ name: 'bug' }] }, { labels: [] }, { state: 'closed' }, { pull_request: {} }]) {
    const w = world();
    assert.equal(notify(issue(extra), w.ctx).notified, false, JSON.stringify(extra));
    assert.equal(w.posted.length, 0);
  }
});

test('does not ping someone who already takes part in the issue', () => {
  const w = world({
    [`repos/${THIS}/issues/783/comments`]: {
      status: 200,
      data: [workerComment(100), { id: 101, user: { login: 'PhalesTrivir', type: 'User' }, body: 'here is my OS', html_url: 'x' }],
    },
  });
  const r = notify(issue(), w.ctx);
  assert.equal(r.notified, false);
  assert.match(r.reason, /already takes part/);
});

test('does not ping twice for the same request, but does for a new one', () => {
  const ping = { id: 101, user: BOT, body: `@phalestrivir ...\n\n${MARKER_PREFIX}100 -->` };
  let w = world({ [`repos/${THIS}/issues/783/comments`]: { status: 200, data: [workerComment(100), ping] } });
  assert.match(notify(issue(), w.ctx).reason, /already notified/);
  w = world({ [`repos/${THIS}/issues/783/comments`]: { status: 200, data: [workerComment(100), ping, workerComment(102)] } });
  const r = notify(issue(), w.ctx);
  assert.equal(r.notified, true);
  assert.ok(w.posted[0].includes(`${MARKER_PREFIX}102 -->`));
  assert.ok(w.posted[0].includes('issuecomment-102'));
});

test('needs a request from THIS repository\'s issue worker to point at', () => {
  let w = world({ [`repos/${THIS}/issues/783/comments`]: { status: 200, data: [] } });
  assert.match(notify(issue(), w.ctx).reason, /no request for information/);
  w = world({ [`repos/${THIS}/issues/783/comments`]: { status: 200, data: [workerComment(100, 'rockcarver/frodo-cli')] } });
  assert.equal(notify(issue(), w.ctx).notified, false);
  // A person quoting the marker is not the worker.
  w = world({
    [`repos/${THIS}/issues/783/comments`]: {
      status: 200,
      data: [{ id: 100, user: { login: 'someone', type: 'User' }, body: `<!-- gh-aw-workflow-call-id: ${THIS}/issue-worker -->`, html_url: 'x' }],
    },
  });
  assert.equal(notify(issue(), w.ctx).notified, false);
});

test('more than one confirmed original is ambiguous: nobody is notified', () => {
  const w = world({
    'repos/rockcarver/frodo-cli/issues/888': {
      status: 200,
      data: { number: 888, user: { login: 'someone-else', type: 'User' }, labels: [{ name: 'related-repo' }] },
    },
    'repos/rockcarver/frodo-cli/issues/888/comments': { status: 200, data: [{ id: 1, user: BOT, body: 'tracked in rockcarver/frodo-lib#783' }] },
  });
  const r = notify(issue({ body: 'Reported from rockcarver/frodo-cli#887\nReported from rockcarver/frodo-cli#888' }), w.ctx);
  assert.equal(r.notified, false);
  assert.match(r.reason, /ambiguous/);
});

test('parseLinks: distinct links only, case-insensitive, at most three, line-anchored', () => {
  const body = ['Reported from a/b#1', 'Reported from A/B#1', 'Reported from a/b#2', 'x Reported from a/b#3', 'Reported from c/d#4', 'Reported from e/f#5'].join('\n');
  assert.deepEqual(parseLinks(body).map((l) => l.ref), ['a/b#1', 'a/b#2', 'c/d#4']);
  assert.deepEqual(parseLinks(null), []);
});

test('relatedRepos reads the repo entries of related-repos.md', () => {
  assert.deepEqual([...relatedRepos(CONFIG)], ['rockcarver/frodo-cli']);
  assert.deepEqual([...relatedRepos('related:\n  - repo: A/B\n  - repo: c/d.e')], ['a/b', 'c/d.e']);
  assert.equal(relatedRepos('').size, 0);
});

test('namesRef matches a whole reference only', () => {
  assert.equal(namesRef('see rockcarver/frodo-lib#783.', 'rockcarver/frodo-lib#783'), true);
  assert.equal(namesRef('rockcarver/frodo-lib#7831', 'rockcarver/frodo-lib#783'), false);
  assert.equal(namesRef('other/rockcarver/frodo-lib#783', 'rockcarver/frodo-lib#783'), false);
  assert.equal(namesRef('', 'rockcarver/frodo-lib#783'), false);
});

test('isBotLogin: users are fine, everything else is not', () => {
  assert.equal(isBotLogin('phalestrivir', 'User'), false);
  assert.equal(isBotLogin('x[bot]', 'User'), true);
  assert.equal(isBotLogin('x', 'Bot'), true);
  assert.equal(isBotLogin('Copilot', 'User'), true);
});
