import test from 'node:test';
import assert from 'node:assert/strict';
import { notify, notifyLink, notifyLinkWithRetry, parseLinks, relatedRepos, namesRef, isBotLogin, MARKER_PREFIX, LINK_MARKER } from './reporter-notify.mjs';

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
    [`repos/${THIS}/contents/.github/issue-concierge/related-repos.md`]: {
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
  return { api, base, reads, posted, ctx: { thisRepo: THIS, api, comment: (b) => posted.push(b) } };
}

/** A world where a posted comment is written back, so the next run sees it, as on GitHub. */
function liveWorld(over = {}) {
  const w = world(over);
  const key = `repos/${THIS}/issues/783/comments`;
  let id = 1000;
  w.ctx.comment = (body) => {
    w.posted.push(body);
    w.base[key] = { status: 200, data: [...w.base[key].data, { id: id++, user: BOT, body, html_url: 'x' }] };
  };
  return w;
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
    [`repos/${THIS}/contents/.github/issue-concierge/related-repos.md`]: { status: 500, data: { content: Buffer.from(CONFIG).toString('base64') } },
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
  const w = world({ [`repos/${THIS}/contents/.github/issue-concierge/related-repos.md`]: { status: 404, data: null } });
  assert.equal(notify(issue(), w.ctx).notified, false);
});

// The folder of a repository's own files was `.github/agentic-workflows/` until the update moves it to
// `.github/issue-concierge/`. Both places are read, the new one first, and only a 404 on the new one sends the read on.
const NEW_RELATED = `repos/${THIS}/contents/.github/issue-concierge/related-repos.md`;
const OLD_RELATED = `repos/${THIS}/contents/.github/agentic-workflows/related-repos.md`;
const configAnswer = (status = 200) => ({ status, data: { content: Buffer.from(CONFIG).toString('base64') } });
const configReads = (w) => w.reads.filter((p) => p.endsWith('related-repos.md'));

test('a repository that has not been updated yet keeps related-repos.md in the old folder, and it is read from there', () => {
  const w = world({ [NEW_RELATED]: { status: 404, data: null }, [OLD_RELATED]: configAnswer() });
  assert.equal(notify(issue(), w.ctx).notified, true);
  assert.deepEqual(configReads(w), [NEW_RELATED, OLD_RELATED]);
});

test('with the file in both folders the new one is used and the old one is not even read', () => {
  const w = world({ [OLD_RELATED]: { status: 200, data: { content: Buffer.from('related:\n  - repo: some/other\n').toString('base64') } } });
  assert.equal(notify(issue(), w.ctx).notified, true, 'the new file lists the related repository, the old one does not');
  assert.deepEqual(configReads(w), [NEW_RELATED]);
});

test('an error on the new folder is the answer: a file in the old folder does not stand in for it', () => {
  for (const status of [403, 500, 502]) {
    const w = world({ [NEW_RELATED]: { status, data: null }, [OLD_RELATED]: configAnswer() });
    const r = notify(issue(), w.ctx);
    assert.equal(r.notified, false, `status ${status}`);
    assert.deepEqual(configReads(w), [NEW_RELATED], `status ${status}: the old folder is not read`);
  }
});

test('neither folder has the file: nothing can be confirmed', () => {
  const w = world({ [NEW_RELATED]: { status: 404, data: null } });
  assert.equal(notify(issue(), w.ctx).notified, false);
  assert.deepEqual(configReads(w), [NEW_RELATED, OLD_RELATED]);
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


// ---------------------------------------------------------------------------------------------
// The link notice (2026-10-24): the issue worker opened frodo-lib#803 to #806 from frodo-cli#919
// to #922 with the maintainer's token, so the people who reported those were never told. One
// mention at link time subscribes them. Rules: docs/multi-phase-design.md, "Split-repo routing".
// ---------------------------------------------------------------------------------------------

const linked = (extra = {}) => issue({ labels: [], user: { login: 'vscheuber', type: 'User' }, ...extra });
const originalBy = (user, extra = {}) => ({
  'repos/rockcarver/frodo-cli/issues/887': {
    status: 200,
    data: { number: 887, user, labels: [{ name: 'related-repo' }], ...extra },
  },
});
const noSleep = () => ({ sleeps: [], sleep(ms) { this.sleeps.push(ms); } });

test('link notice: tells the original reporter where the report went, once, with no label needed', () => {
  const w = world();
  const r = notifyLink(linked(), w.ctx);
  assert.equal(r.notified, true);
  assert.equal(r.login, 'phalestrivir');
  assert.equal(w.posted.length, 1);
  assert.equal(
    w.posted[0],
    `Original report: rockcarver/frodo-cli#887, reported by @phalestrivir. Updates are posted on both threads.\n\n${LINK_MARKER}`,
  );
});

test('link notice: exactly one mention, and no internal terms', () => {
  const w = world();
  notifyLink(linked(), w.ctx);
  assert.equal((w.posted[0].match(/@/g) || []).length, 1);
  assert.doesNotMatch(w.posted[0], /needs-info|label|gate|workflow|harness|concierge|related-repo/i);
});

test('link notice: the login comes from the original issue as GitHub returns it, never from text', () => {
  const w = world();
  const body = 'Reported from rockcarver/frodo-cli#887\nReported by @someone-else\nping @victim and @rockcarver/maintainers';
  notifyLink(linked({ body }), w.ctx);
  assert.equal(w.posted.length, 1);
  assert.match(w.posted[0], /@phalestrivir\./);
  assert.doesNotMatch(w.posted[0], /someone-else|victim|maintainers/);
});

test('link notice: proof is required, a link alone notifies nobody', () => {
  // The original does not point back (a forged link to someone else's issue)...
  let w = world({ ...originalBy({ login: 'victim', type: 'User' }), 'repos/rockcarver/frodo-cli/issues/887/comments': { status: 200, data: [] } });
  assert.equal(notifyLink(linked(), w.ctx).notified, false);
  // ...or only a person says so, not the harness...
  w = world({ 'repos/rockcarver/frodo-cli/issues/887/comments': { status: 200, data: [{ id: 9, user: { login: 'someone', type: 'User' }, body: 'tracked in rockcarver/frodo-lib#783' }] } });
  assert.equal(notifyLink(linked(), w.ctx).notified, false);
  // ...or it does not carry related-repo (unlinked by a maintainer).
  w = world(originalBy({ login: 'phalestrivir', type: 'User' }, { labels: [{ name: 'bug' }] }));
  assert.equal(notifyLink(linked(), w.ctx).notified, false);
  // A link to a repository that is not a related repository is never read.
  w = world();
  assert.equal(notifyLink(linked({ body: 'Reported from attacker/repo#1' }), w.ctx).notified, false);
  assert.ok(!w.reads.some((path) => path.includes('attacker/repo')));
  assert.equal(w.posted.length, 0);
});

test('link notice: a bot, an app, the coding agent or an organization is never mentioned, and that is final', () => {
  for (const user of [
    { login: 'dependabot[bot]', type: 'Bot' },
    { login: 'some-app[bot]', type: 'User' },
    { login: 'Copilot', type: 'Bot' },
    { login: 'an-org', type: 'Organization' },
  ]) {
    const w = world(originalBy(user));
    const r = notifyLink(linked(), w.ctx);
    assert.equal(r.notified, false, user.login);
    assert.ok(!r.retry, `${user.login}: no point waiting`);
    assert.equal(w.posted.length, 0);
  }
});

test('link notice: a maintainer of the original repository is not mentioned, an outside reporter is', () => {
  for (const author_association of ['OWNER', 'MEMBER', 'COLLABORATOR', 'owner']) {
    const w = world(originalBy({ login: 'a-maintainer', type: 'User' }, { author_association }));
    const r = notifyLink(linked(), w.ctx);
    assert.equal(r.notified, false, author_association);
    assert.match(r.reason, /maintainer/);
    assert.ok(!r.retry);
    assert.equal(w.posted.length, 0);
  }
  for (const author_association of ['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE', undefined]) {
    const w = world(originalBy({ login: 'outsider', type: 'User' }, { author_association }));
    assert.equal(notifyLink(linked(), w.ctx).notified, true, String(author_association));
  }
});

test('link notice: the person who opened the canonical issue is not mentioned (they take part already)', () => {
  const w = world();
  const r = notifyLink(linked({ user: { login: 'PhalesTrivir', type: 'User' } }), w.ctx);
  assert.equal(r.notified, false);
  assert.match(r.reason, /opened this issue/);
});

test('link notice: not for someone who already comments on the issue', () => {
  const w = world({
    [`repos/${THIS}/issues/783/comments`]: { status: 200, data: [{ id: 5, user: { login: 'phalestrivir', type: 'User' }, body: 'hi', html_url: 'x' }] },
  });
  const r = notifyLink(linked(), w.ctx);
  assert.equal(r.notified, false);
  assert.match(r.reason, /already takes part/);
});

test('link notice: once per issue; a person quoting the marker cannot switch it off', () => {
  let w = liveWorld();
  assert.equal(notifyLink(linked(), w.ctx).notified, true);
  const again = notifyLink(linked(), w.ctx);
  assert.equal(again.notified, false);
  assert.match(again.reason, /already told/);
  assert.equal(w.posted.length, 1);

  w = world({
    [`repos/${THIS}/issues/783/comments`]: { status: 200, data: [{ id: 7, user: { login: 'someone', type: 'User' }, body: `quoted ${LINK_MARKER}`, html_url: 'x' }] },
  });
  assert.equal(notifyLink(linked(), w.ctx).notified, true, 'only the bot\'s comment counts');
});

test('link notice: only an open issue that is not a pull request', () => {
  for (const extra of [{ state: 'closed' }, { pull_request: {} }]) {
    const w = world();
    assert.equal(notifyLink(linked(extra), w.ctx).notified, false, JSON.stringify(extra));
    assert.equal(w.posted.length, 0);
  }
});

test('link notice: a dry run posts nothing but says what it would post', () => {
  const w = world();
  const r = notifyLink(linked(), { ...w.ctx, dryRun: true });
  assert.equal(r.notified, true);
  assert.equal(w.posted.length, 0);
  assert.match(r.comment, /^Original report: rockcarver\/frodo-cli#887, reported by @phalestrivir\./);
});

test('the race: the harness labels and comments on the original a moment after it creates this issue, so a short re-check waits for it', () => {
  // First look: no related-repo label and no back-pointer yet. The pause is when the harness catches up.
  const w = world({
    'repos/rockcarver/frodo-cli/issues/887': { status: 200, data: { number: 887, user: { login: 'phalestrivir', type: 'User' }, labels: [{ name: 'bug' }] } },
    'repos/rockcarver/frodo-cli/issues/887/comments': { status: 200, data: [] },
  });
  const s = noSleep();
  const sleep = (ms) => {
    s.sleep(ms);
    Object.assign(w.base, world().base); // the harness has now written the label and the comment
  };
  const r = notifyLinkWithRetry(linked(), w.ctx, { attempts: 4, delayMs: 15000, sleep });
  assert.equal(r.notified, true);
  assert.deepEqual(s.sleeps, [15000], 'one pause, then it succeeded');
  assert.equal(w.posted.length, 1);
});

test('the re-check is bounded: it gives up after the attempts and says so', () => {
  const w = world({ 'repos/rockcarver/frodo-cli/issues/887/comments': { status: 200, data: [] } });
  const s = noSleep();
  const r = notifyLinkWithRetry(linked(), w.ctx, { attempts: 4, delayMs: 15000, sleep: (ms) => s.sleep(ms) });
  assert.equal(r.notified, false);
  assert.match(r.reason, /after 4 checks/);
  assert.equal(s.sleeps.length, 3, 'one pause between attempts, none after the last');
  assert.equal(w.reads.filter((path) => path === 'repos/rockcarver/frodo-cli/issues/887').length, 4);
  assert.equal(w.posted.length, 0);
});

test('every other skip is final: nothing waits for a reason that will not change', () => {
  const cases = {
    'private or deleted original': world({ 'repos/rockcarver/frodo-cli/issues/887': { status: 404, data: null } }),
    'not a related repository': world(),
    'bot reporter': world(originalBy({ login: 'x[bot]', type: 'Bot' })),
    'maintainer reporter': world(originalBy({ login: 'm', type: 'User' }, { author_association: 'OWNER' })),
  };
  for (const [name, w] of Object.entries(cases)) {
    const s = noSleep();
    const issueUnder = name === 'not a related repository' ? linked({ body: 'Reported from rockcarver/frodo-docs#887' }) : linked();
    const r = notifyLinkWithRetry(issueUnder, w.ctx, { attempts: 4, sleep: (ms) => s.sleep(ms) });
    assert.equal(r.notified, false, name);
    assert.equal(s.sleeps.length, 0, `${name}: no pause`);
  }
  for (const extra of [{ state: 'closed' }, { pull_request: {} }]) {
    const s = noSleep();
    notifyLinkWithRetry(linked(extra), world().ctx, { attempts: 4, sleep: (ms) => s.sleep(ms) });
    assert.equal(s.sleeps.length, 0);
  }
});

test('the maintainer rule and the opener rule also keep the request notice quiet', () => {
  let w = world(originalBy({ login: 'm', type: 'User' }, { author_association: 'MEMBER' }));
  assert.equal(notify(issue(), w.ctx).notified, false);
  w = world();
  assert.equal(notify(issue({ user: { login: 'phalestrivir', type: 'User' } }), w.ctx).notified, false);
});

test('the two notices cannot loop: one comment each, own marker, then silence, in either order', () => {
  for (const order of [['link', 'request'], ['request', 'link']]) {
    const w = liveWorld();
    const run = (what) => (what === 'link' ? notifyLink : notify)(issue({ user: { login: 'vscheuber', type: 'User' } }), w.ctx);
    for (const what of order) assert.equal(run(what).notified, true, `${what} first time`);
    for (const what of [...order, ...order]) assert.equal(run(what).notified, false, `${what} again`);
    assert.equal(w.posted.length, 2);
    assert.ok(w.posted.every((body) => (body.match(/@/g) || []).length === 1), 'one mention in each');
    assert.ok(w.posted.some((body) => body.includes(LINK_MARKER)));
    assert.ok(w.posted.some((body) => body.includes(`${MARKER_PREFIX}100 -->`)));
  }
});

test('a new request for information is still told once, after the link notice', () => {
  const w = liveWorld();
  const iss = issue({ user: { login: 'vscheuber', type: 'User' } });
  notifyLink(iss, w.ctx);
  assert.equal(notify(iss, w.ctx).notified, true); // request 100
  w.base[`repos/${THIS}/issues/783/comments`] = {
    status: 200,
    data: [...w.base[`repos/${THIS}/issues/783/comments`].data, workerComment(300)],
  };
  assert.equal(notify(iss, w.ctx).notified, true); // request 300
  assert.equal(notify(iss, w.ctx).notified, false);
  assert.equal(w.posted.length, 3, 'one link notice and one notice per request, no more');
});

test('parseLinks: a note after the number on the same line is fine (the worker wrote one on frodo-lib#806), nothing else changes', () => {
  const refs = (body) => parseLinks(body).map((l) => l.ref);
  assert.deepEqual(refs('Reported from rockcarver/frodo-cli#922 (the original report, with full A/B and stress-test evidence, is there).'), ['rockcarver/frodo-cli#922']);
  assert.deepEqual(refs('Reported from a/b#1.'), ['a/b#1']);
  assert.deepEqual(refs('Reported from a/b#1   '), ['a/b#1']);
  assert.deepEqual(refs('Reported from a/b#1abc'), [], 'the number must end at the number');
  assert.deepEqual(refs('Reported from a/b#12-3'), [], 'the number must end at the number');
  assert.deepEqual(refs('note: Reported from a/b#1'), [], 'still has to start the line');
  assert.deepEqual(refs('Reported from a/b#1 and Reported from c/d#2'), ['a/b#1'], 'a link inside the note is not a link');
});

test('link notice: works for the body the worker really wrote on frodo-lib#806', () => {
  const w = world();
  const body = 'Reported from rockcarver/frodo-cli#887 (the original report, with full A/B and stress-test evidence, is there).\n\n## Summary\ntext';
  const r = notifyLink(linked({ body }), w.ctx);
  assert.equal(r.notified, true);
  assert.equal(r.login, 'phalestrivir');
});

// An issue that carries no-auto-processing, or whose original does, gets no notice: a person handles it
// (https://github.com/gearsnlevers/issue-concierge/blob/main/docs/decisions/0028-an-item-labelled-no-auto-processing-is-never-touched.md).
test('no request notice for an opted-out issue, and no read at all; the control is notified', () => {
  const w = world();
  const r = notify(issue({ labels: [{ name: 'needs-info' }, { name: 'no-auto-processing' }] }), w.ctx);
  assert.equal(r.notified, false);
  assert.match(r.reason, /carries no-auto-processing/);
  assert.deepEqual(w.posted, []);
  assert.deepEqual(w.reads, [], 'nothing of the issue, its original or its comments is read');
  assert.equal(notify(issue(), world().ctx).notified, true, 'the same issue without the label');
});

test('no link notice for an opted-out canonical issue', () => {
  const w = world();
  const r = notifyLink(issue({ labels: [{ name: 'no-auto-processing' }] }), w.ctx);
  assert.equal(r.notified, false);
  assert.match(r.reason, /carries no-auto-processing/);
  assert.deepEqual(w.posted, []);
  assert.deepEqual(w.reads, []);
  assert.equal(notifyLink(issue({ labels: [] }), world().ctx).notified, true, 'the same issue without the label');
});

test('no notice when the original issue carries the label: its reporter is told nothing', () => {
  const orig = {
    status: 200,
    data: { number: 887, user: { login: 'phalestrivir', type: 'User' }, labels: [{ name: 'bug' }, { name: 'related-repo' }, { name: 'no-auto-processing' }] },
  };
  for (const [fn, labels] of [[notify, [{ name: 'needs-info' }]], [notifyLink, []]]) {
    const w = world({ 'repos/rockcarver/frodo-cli/issues/887': orig });
    const r = fn(issue({ labels }), w.ctx);
    assert.equal(r.notified, false, fn.name);
    assert.match(r.reason, /original report: the issue carries no-auto-processing/, fn.name);
    assert.deepEqual(w.posted, [], fn.name);
  }
});
