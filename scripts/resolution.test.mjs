import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apply,
  BEGIN,
  cap,
  closingFix,
  decide,
  END,
  extractSection,
  LEGACY_BEGIN,
  LEGACY_END,
  LEGACY_MARKER,
  legacyMarkerFor,
  LABEL_RELEASED,
  LABEL_WAITING,
  MARKER,
  markerFor,
  MAX_CHARS,
  plainComment,
  qualifyRefs,
  releaseContaining,
  resolutionComment,
  resolutionOf,
  sanitize,
  textOfComment,
} from './resolution.mjs';

// Why this exists (2026-10-25): an issue closed by a merged pull request got one fixed sentence from a model, "Fixed
// in #N. Waiting for a release that includes this.", and the original issue of a split-repository link got a line
// that only named the other issue. Nobody told the reporter what had been wrong, what changed or how to use it. The
// pull request has that text, and a maintainer read it before merging, so code copies it. These tests pin what is
// copied, what is removed from it, and the cases where nothing may be posted at all.

const THIS = 'rockcarver/frodo-cli';
const BOT = { login: 'github-actions[bot]', type: 'Bot' };
const PERSON = { login: 'a-maintainer', type: 'User' };

const GOOD = `Some text before.

## Resolution
Exporting the configuration of an Identity Cloud tenant no longer asks for realm settings that Identity Cloud always refuses, so an export makes fewer failing requests. Use \`frodo config export -A\` as before.

## Tests
They pass.
`;

// ------------------------------------------------------------------ the section

test('the section runs from its heading to the next heading of the same or a higher level', () => {
  assert.equal(extractSection(GOOD).trim().startsWith('Exporting the configuration'), true);
  assert.equal(extractSection(GOOD).includes('Tests'), false);
  assert.equal(extractSection('# Title\n\n### Resolution:\nOne.\n#### Detail\nTwo.\n### Next\nThree.'), 'One.\n#### Detail\nTwo.');
});

test('a pull request without the section has none', () => {
  assert.equal(extractSection('Fixes #1\n\n## Summary\nText'), null);
  assert.equal(extractSection(''), null);
  assert.equal(extractSection(undefined), null);
  // only the exact heading counts, not a heading that merely mentions it
  assert.equal(extractSection('## The resolution of the problem\nText'), null);
  assert.equal(extractSection('#### Resolution\nText'), null);
});

test('a heading inside a code fence ends nothing and starts nothing', () => {
  const body = '```\n## Resolution\nnot this\n```\n\n## Resolution\nReal text that is long enough to be kept.\n```\n## Not a heading\n```\nStill the section.\n## Next\nx';
  const section = extractSection(body);
  assert.match(section, /^Real text/);
  assert.match(section, /Still the section\.$/);
  assert.equal(section.includes('not this'), false);
});

test('Windows line endings are read like any other', () => {
  assert.equal(extractSection('## Resolution\r\nOne.\r\n\r\n## Next\r\nTwo.'), 'One.\n');
});

// ----------------------------------------------------------------- sanitizing

test('HTML, comments and images are removed', () => {
  const t = sanitize('Text <!-- hidden --> more <b>bold</b> ![pixel](https://tracker.example/x.png) <script>alert(1)</script> end');
  assert.equal(t, 'Text  more bold  alert(1) end');
  assert.equal(sanitize('<!-- a\nmultiline\ncomment --> kept'), 'kept');
});

test('a mention is put in a code span, so the comment notifies nobody', () => {
  assert.equal(sanitize('Thanks @someone and @org/team-a, mail a@b.example, `@already` quoted'), 'Thanks `@someone` and `@org/team-a`, mail a@b.example, `@already` quoted');
  assert.equal(sanitize('@first at the start'), '`@first` at the start');
});

test('blank lines collapse and trailing spaces go', () => {
  assert.equal(sanitize('a   \n\n\n\n\nb  '), 'a\n\nb');
});

// ------------------------------------------------------------------------ cap

test('text within the cap is untouched', () => {
  assert.deepEqual(cap('short'), { text: 'short', cut: false });
});

test('longer text is cut at a paragraph or a sentence end', () => {
  const para = `${'word '.repeat(150).trim()}.\n\n${'more '.repeat(300).trim()}.`;
  const a = cap(para);
  assert.equal(a.cut, true);
  assert.equal(a.text.endsWith(' …'), true);
  assert.equal(a.text.length <= MAX_CHARS + 2, true);
  assert.equal(a.text.includes('more'), false);
  const b = cap('This is one sentence. '.repeat(100).trim(), 100);
  assert.equal(b.cut, true);
  assert.match(b.text, /sentence\. …$/);
  assert.equal(b.text.length <= 102, true);
});

// --------------------------------------------------------------- resolutionOf

test('a good section is returned, cleaned', () => {
  const r = resolutionOf(GOOD);
  assert.equal(r.cut, false);
  assert.match(r.text, /^Exporting the configuration of an Identity Cloud tenant/);
  assert.match(r.text, /`frodo config export -A` as before\.$/);
});

for (const [name, body] of [
  ['an empty section', '## Resolution\n\n## Next\nx'],
  ['a section of only a comment', '## Resolution\n<!-- Explain this for the reporter -->\n'],
  ['a placeholder', '## Resolution\nTBD\n'],
  ['a placeholder with a full stop', '## Resolution\nTODO.\n'],
  ['a dash', '## Resolution\n-\n'],
  ['text too short to explain anything', '## Resolution\nFixed.\n'],
  ['no section', '## Summary\nWhat this does and more words to be long enough.'],
]) {
  test(`${name} gives no resolution`, () => {
    assert.equal(resolutionOf(body), null);
  });
}

test('a long section is cut and says so', () => {
  const r = resolutionOf(`## Resolution\n${'A sentence that explains the change. '.repeat(80)}`);
  assert.equal(r.cut, true);
  assert.equal(r.text.length <= MAX_CHARS + 2, true);
});

// ---------------------------------------------------------------- qualifyRefs

test('a bare issue reference gets the repository of the text, others are left alone', () => {
  assert.equal(
    qualifyRefs('See #12 and owner/repo#3, not C#5 or `#7` or &#39; and #12.', 'rockcarver/frodo-lib'),
    'See rockcarver/frodo-lib#12 and owner/repo#3, not C#5 or `#7` or &#39; and rockcarver/frodo-lib#12.'
  );
  assert.equal(qualifyRefs('#1 starts', 'o/r'), 'o/r#1 starts');
  // an anchor in a link is not a reference
  assert.equal(qualifyRefs('See https://example.com/docs/#12 and (#13)', 'o/r'), 'See https://example.com/docs/#12 and (o/r#13)');
});

// ------------------------------------------------------------------- comments

const pull = (over = {}) => ({ number: 45, repo: THIS, url: `https://github.com/${THIS}/pull/45`, ...over });

test('the comment starts with the line the release closer reads, and carries the text between hidden markers', () => {
  const c = resolutionComment(pull(), { text: 'It works now.', cut: false }, THIS, '');
  assert.equal(c.split('\n')[0], 'Fixed in #45.');
  assert.match(c, /^Fixed in #(\d+)\./m);
  assert.equal(textOfComment(c), 'It works now.');
  assert.match(c, /will be in the next release/);
  assert.equal(c.trimEnd().endsWith(`${MARKER} #45 -->`), true);
  // nothing a reporter reads names a label, a gate or a workflow
  assert.doesNotMatch(c.replace(/<!--.*?-->/gs, ''), /label|gate|workflow|waiting-for-release|concierge/i);
});

test('a cut text points at the pull request', () => {
  const c = resolutionComment(pull(), { text: 'Start …', cut: true }, THIS, '');
  assert.match(c, /The full description is in https:\/\/github\.com\/rockcarver\/frodo-cli\/pull\/45\./);
});

test('a fix that is already in a release says so', () => {
  const c = resolutionComment(pull(), { text: 'Done.', cut: false }, THIS, 'v1.2.3');
  assert.match(c, /This is part of v1\.2\.3\./);
  assert.doesNotMatch(c, /next release/);
});

test('a fix merged in another repository names that repository', () => {
  const c = resolutionComment(pull({ repo: 'rockcarver/frodo-lib', number: 831 }), { text: 'Done.', cut: false }, THIS, '');
  assert.equal(c.split('\n')[0], 'Fixed in rockcarver/frodo-lib#831.');
  assert.match(c, /merged in rockcarver\/frodo-lib/);
});

test('without a resolution the comment is the old one-liner', () => {
  assert.equal(plainComment(pull(), THIS, ''), 'Fixed in #45. Waiting for a release that includes this.');
  assert.equal(plainComment(pull(), THIS, 'v2.0.0'), 'Fixed in #45. Included in v2.0.0.');
});

test('textOfComment finds nothing in a comment without the markers', () => {
  assert.equal(textOfComment('Fixed in #45. Waiting for a release that includes this.'), null);
  assert.equal(textOfComment(undefined), null);
});

// -------------------------------------------------------------------- the world

/** A GitHub that answers reads from a map, and a GraphQL that answers the closing event. */
function world({ closing, pulls = {}, releases = [], compare = {}, events } = {}) {
  const asked = [];
  const sequence = events ? [...events] : null;
  const ctx = {
    thisRepo: THIS,
    attempts: 3,
    waitMs: 0,
    sleeps: 0,
    async sleep() {
      ctx.sleeps++;
    },
    api(path) {
      asked.push(path);
      const pr = /^repos\/(.+)\/pulls\/(\d+)$/.exec(path);
      if (pr) return pulls[`${pr[1]}#${pr[2]}`] || { status: 404, data: null };
      if (path.startsWith(`repos/${THIS}/releases`)) return { status: 200, data: releases };
      const cmp = /^repos\/.+\/compare\/([^?]+)(\?per_page=1)$/.exec(path);
      if (cmp) return compare[cmp[1]] || { status: 404, data: null };
      return { status: 404, data: null };
    },
    graphql() {
      return sequence ? sequence.shift() : closing;
    },
  };
  return { asked, ctx };
}
const NONE = { repository: { issue: { timelineItems: { nodes: [] } } } };
const closedBy = (closer, stateReason = 'COMPLETED') => ({
  repository: { issue: { timelineItems: { nodes: [{ stateReason, closer }] } } },
});
const prCloser = (number = 45, merged = true, repo = THIS) => ({ __typename: 'PullRequest', number, merged, url: `https://github.com/${repo}/pull/${number}`, repository: { nameWithOwner: repo } });
const prData = (over = {}) => ({
  status: 200,
  data: { number: 45, html_url: `https://github.com/${THIS}/pull/45`, merged: true, merged_at: '2026-10-25T10:00:00Z', merge_commit_sha: 'abc123', merged_by: PERSON, body: GOOD, ...over },
});
const issue = (over = {}) => ({ number: 12, state: 'closed', state_reason: 'completed', user: PERSON, labels: [{ name: 'bug' }], ...over });

// ---------------------------------------------------------------- what is posted

test('an issue closed by a merged pull request gets its resolution and the waiting label', async () => {
  const { ctx } = world({ closing: closedBy(prCloser()), pulls: { [`${THIS}#45`]: prData() } });
  const v = await decide(issue(), ctx);
  assert.equal(v.action, 'post');
  assert.equal(v.kind, 'resolution');
  assert.equal(v.label, LABEL_WAITING);
  assert.equal(v.marker, markerFor(pull(), THIS));
  assert.match(textOfComment(v.comment), /^Exporting the configuration/);
  assert.match(v.comment, /^Fixed in #45\./);
});

test('a pull request without a usable section gets the old one-line comment', async () => {
  const { ctx } = world({ closing: closedBy(prCloser()), pulls: { [`${THIS}#45`]: prData({ body: 'Fixes #12' }) } });
  const v = await decide(issue(), ctx);
  assert.equal(v.kind, 'plain');
  assert.equal(v.label, LABEL_WAITING);
  assert.match(v.comment, /^Fixed in #45\. Waiting for a release that includes this\.\n\n<!-- issue-concierge:resolution #45 -->$/);
});

test('a pull request that a bot merged is not trusted for its text', async () => {
  const { ctx } = world({
    closing: closedBy(prCloser()),
    pulls: { [`${THIS}#45`]: prData({ merged_by: { login: 'some-app[bot]', type: 'Bot' } }) },
  });
  assert.equal((await decide(issue(), ctx)).kind, 'plain');
});

test('a pull request with no merger recorded is not trusted for its text either', async () => {
  const { ctx } = world({ closing: closedBy(prCloser()), pulls: { [`${THIS}#45`]: prData({ merged_by: null }) } });
  assert.equal((await decide(issue(), ctx)).kind, 'plain');
});

test('the copied text is sanitized: mentions, HTML and images do not get through', async () => {
  const body = '## Resolution\nThanks @stranger! <img src=x onerror=y> ![t](https://t.example/p.png) The export now works for Identity Cloud tenants.\n';
  const { ctx } = world({ closing: closedBy(prCloser()), pulls: { [`${THIS}#45`]: prData({ body }) } });
  const v = await decide(issue(), ctx);
  const text = textOfComment(v.comment);
  assert.match(text, /`@stranger`/);
  assert.doesNotMatch(text, /<img|!\[/);
});

test('a fix that a release after the merge already contains says so and is not marked as waiting', async () => {
  const { ctx } = world({
    closing: closedBy(prCloser()),
    pulls: { [`${THIS}#45`]: prData() },
    releases: [
      { tag_name: 'v0.9.0', published_at: '2026-10-01T00:00:00Z', draft: false },
      { tag_name: 'v1.0.1', published_at: '2026-10-26T00:00:00Z', draft: false },
      { tag_name: 'v1.0.0', published_at: '2026-10-25T12:00:00Z', draft: false },
      { tag_name: 'v1.1.0', published_at: '2026-10-27T00:00:00Z', draft: true },
      // a draft that would be the earliest: it is not published, so it is not a release
      { tag_name: 'v0.9.5', published_at: '2026-10-25T11:00:00Z', draft: true },
    ],
    compare: { 'abc123...v1.0.0': { status: 200, data: { status: 'ahead' } }, 'abc123...v0.9.5': { status: 200, data: { status: 'ahead' } } },
  });
  const v = await decide(issue(), ctx);
  assert.equal(v.label, LABEL_RELEASED);
  assert.equal(v.released, 'v1.0.0');
  assert.match(v.comment, /This is part of v1\.0\.0\./);
});

test('a release published after the merge that does not contain the fix does not count', async () => {
  const { ctx } = world({
    closing: closedBy(prCloser()),
    pulls: { [`${THIS}#45`]: prData() },
    releases: [{ tag_name: 'v1.0.0', published_at: '2026-10-25T12:00:00Z', draft: false }],
    compare: { 'abc123...v1.0.0': { status: 200, data: { status: 'diverged' } } },
  });
  const v = await decide(issue(), ctx);
  assert.equal(v.label, LABEL_WAITING);
  assert.equal(v.released, '');
});

test('releaseContaining asks git, and only about the earliest release after the merge', () => {
  const { ctx, asked } = world({
    releases: [
      { tag_name: 'v2', published_at: '2026-10-28T00:00:00Z', draft: false },
      { tag_name: 'v1', published_at: '2026-10-26T00:00:00Z', draft: false },
    ],
    compare: { 'sha...v1': { status: 200, data: { status: 'identical' } } },
  });
  assert.equal(releaseContaining(ctx, 'sha', '2026-10-25T00:00:00Z'), 'v1');
  assert.equal(asked.filter((p) => p.includes('/compare/')).length, 1);
  // the answer is cut to one commit: for a long range it is megabytes, and an oversized answer reads as a failed call
  assert.match(asked.find((p) => p.includes('/compare/')), /\.\.\.v1\?per_page=1$/);
  assert.equal(releaseContaining(ctx, '', '2026-10-25T00:00:00Z'), '');
});

test('a fix merged in another repository is named by repository and its release is not guessed', async () => {
  const { ctx, asked } = world({
    closing: closedBy(prCloser(831, true, 'rockcarver/frodo-lib')),
    pulls: { 'rockcarver/frodo-lib#831': prData({ number: 831, html_url: 'https://github.com/rockcarver/frodo-lib/pull/831' }) },
    releases: [{ tag_name: 'v1.0.0', published_at: '2026-10-26T00:00:00Z', draft: false }],
  });
  const v = await decide(issue(), ctx);
  assert.match(v.comment, /^Fixed in rockcarver\/frodo-lib#831\./);
  assert.equal(v.label, LABEL_WAITING);
  assert.equal(asked.some((p) => p.includes('/releases')), false);
});

// ------------------------------------------------------------ what is not posted

for (const [name, over] of [
  ['a pull request', { pull_request: {} }],
  ['an open issue', { state: 'open' }],
  ['an issue a bot opened', { user: { login: 'dependabot[bot]', type: 'Bot' } }],
  ['an issue that carries no-auto-processing', { labels: [{ name: 'no-auto-processing' }] }],
  ['an issue that carries released already (a manual run on an old issue)', { labels: [{ name: 'released' }] }],
]) {
  test(`${name} is left alone, and nothing is asked of GitHub`, async () => {
    const { ctx, asked } = world({ closing: closedBy(prCloser()) });
    const v = await decide(issue(over), ctx);
    assert.equal(v.action, 'skip');
    assert.deepEqual(asked, []);
  });
}

for (const reason of ['not_planned', 'duplicate']) {
  test(`an issue closed as ${reason} waits for no release`, async () => {
    const { ctx } = world({ closing: closedBy(prCloser()) });
    assert.equal((await decide(issue({ state_reason: reason }), ctx)).action, 'skip');
  });
}

test('the closing event decides too: not planned there, a close by hand, a commit, a pull request that is not merged', async () => {
  for (const [closing, why] of [
    [closedBy(prCloser(), 'NOT_PLANNED'), /not planned/],
    [closedBy(prCloser(), 'DUPLICATE'), /duplicate/],
    [closedBy(null), /by hand/],
    [closedBy({ __typename: 'Commit', oid: 'deadbeef', url: 'u' }), /commit/],
    [closedBy(prCloser(45, false)), /not merged/],
  ]) {
    const { ctx } = world({ closing });
    const v = await decide(issue(), ctx);
    assert.equal(v.action, 'skip');
    assert.match(v.reason, why);
  }
});

test('a closing event that GitHub has not recorded yet is waited for, a few times', async () => {
  const { ctx } = world({ events: [NONE, NONE, closedBy(prCloser())], pulls: { [`${THIS}#45`]: prData() } });
  const v = await decide(issue(), ctx);
  assert.equal(v.action, 'post');
  assert.equal(ctx.sleeps, 2);
});

test('and when it never appears nothing is posted', async () => {
  const { ctx } = world({ events: [NONE, NONE, NONE] });
  const v = await decide(issue(), ctx);
  assert.equal(v.action, 'skip');
  assert.match(v.reason, /not recorded/);
  assert.equal(ctx.sleeps, 2);
});

test('a GraphQL failure is an error, not a guess', async () => {
  const { ctx } = world();
  ctx.graphql = () => undefined;
  const v = await decide(issue(), ctx);
  assert.equal(v.action, 'error');
});

test('a pull request that cannot be read is an error and nothing is posted', async () => {
  const { ctx } = world({ closing: closedBy(prCloser()) });
  const v = await decide(issue(), ctx);
  assert.equal(v.action, 'error');
  assert.match(v.reason, /could not be read \(HTTP 404\)/);
});

test('closingFix says what closed the issue, for the related-repo closer too', async () => {
  const { ctx } = world({ closing: closedBy(prCloser()), pulls: { [`${THIS}#45`]: prData() } });
  const fix = await closingFix(issue(), ctx);
  assert.equal(fix.pull.number, 45);
  assert.equal(fix.pull.sha, 'abc123');
  assert.match(fix.resolution.text, /^Exporting/);
});

// --------------------------------------------------------------------- applying

function writes() {
  const log = [];
  return { log, addLabel: (n, l) => log.push(['label', n, l]), comment: (n, b) => log.push(['comment', n, b]), dryRun: false };
}
const verdict = (over = {}) => ({ action: 'post', kind: 'resolution', label: LABEL_WAITING, released: '', marker: markerFor(pull(), THIS), comment: 'Fixed in #45.\n\nx', ...over });

test('the label goes first, then the comment', () => {
  const w = writes();
  const did = apply(verdict(), issue(), w, []);
  assert.deepEqual(w.log.map((x) => x[0]), ['label', 'comment']);
  assert.equal(did.length, 2);
});

test('a run that already did everything does nothing', () => {
  const w = writes();
  const posted = [{ user: BOT, body: `Fixed in #45.\n\n${markerFor(pull(), THIS)}` }];
  const did = apply(verdict(), issue({ labels: [{ name: LABEL_WAITING }] }), w, posted);
  assert.deepEqual(w.log, []);
  assert.deepEqual(did, []);
});

test('a run that stopped after the label posts only the comment, and one that stopped after the comment only the label', () => {
  const a = writes();
  apply(verdict(), issue({ labels: [{ name: LABEL_WAITING }] }), a, []);
  assert.deepEqual(a.log.map((x) => x[0]), ['comment']);
  const b = writes();
  apply(verdict(), issue(), b, [{ user: BOT, body: markerFor(pull(), THIS) }]);
  assert.deepEqual(b.log.map((x) => x[0]), ['label']);
});

test('only a comment from the harness counts as already posted, not one a person typed', () => {
  const w = writes();
  apply(verdict(), issue({ labels: [{ name: LABEL_WAITING }] }), w, [{ user: PERSON, body: markerFor(pull(), THIS) }]);
  assert.deepEqual(w.log.map((x) => x[0]), ['comment']);
});

// The resolution comments of production were written by earlier versions and stay in the issues for good.
test('the markers carry the product\'s name, and the older ones are what an earlier version wrote', () => {
  assert.deepEqual([BEGIN, END, MARKER], ['<!-- issue-concierge:resolution:begin -->', '<!-- issue-concierge:resolution:end -->', '<!-- issue-concierge:resolution']);
  assert.deepEqual([LEGACY_BEGIN, LEGACY_END, LEGACY_MARKER], ['<!-- concierge:resolution:begin -->', '<!-- concierge:resolution:end -->', '<!-- concierge:resolution']);
  assert.equal(legacyMarkerFor(pull(), THIS), '<!-- concierge:resolution #45 -->');
});

test('a comment is written with the new lines and never the older ones', async () => {
  const c = resolutionComment(pull(), { text: 'It works now.', cut: false }, THIS, '');
  assert.ok(c.includes(BEGIN) && c.includes(END) && c.includes(markerFor(pull(), THIS)));
  assert.ok(!c.includes('<!-- concierge:'), 'no older line in a new comment');
  const { ctx } = world({ closing: closedBy(prCloser()), pulls: { [`${THIS}#45`]: prData({ body: 'Fixes #12' }) } });
  const plain = await decide(issue(), ctx);
  assert.ok(!plain.comment.includes('<!-- concierge:'), 'nor in the one-line comment');
  assert.equal(plain.legacyMarker, legacyMarkerFor(pull(), THIS), 'the verdict knows the older line, to recognise an older comment');
});

test('the text of a comment an earlier version wrote is read, from its older lines', () => {
  const old = `Fixed in #45.\n\n${LEGACY_BEGIN}\nIt worked before, too.\n${LEGACY_END}\n\nThis is merged.\n\n${LEGACY_MARKER} #45 -->`;
  assert.equal(textOfComment(old), 'It worked before, too.');
  assert.equal(textOfComment(`${LEGACY_BEGIN}\n${LEGACY_END}`), null, 'an empty older comment has no text');
  assert.equal(textOfComment(`${BEGIN}\nNew words.\n${END}`), 'New words.');
  assert.equal(textOfComment(`${LEGACY_BEGIN}\nold\n${END}`), null, 'lines of two spellings do not make a comment');
});

test('a comment an earlier version posted counts as posted: a run after the update does not post a second one', () => {
  const real = { ...verdict(), legacyMarker: legacyMarkerFor(pull(), THIS) };
  const w = writes();
  const did = apply(real, issue({ labels: [{ name: LABEL_WAITING }] }), w, [{ user: BOT, body: `Fixed in #45.\n\n${legacyMarkerFor(pull(), THIS)}` }]);
  assert.deepEqual(w.log, []);
  assert.deepEqual(did, []);
  const person = writes();
  apply(real, issue({ labels: [{ name: LABEL_WAITING }] }), person, [{ user: PERSON, body: legacyMarkerFor(pull(), THIS) }]);
  assert.deepEqual(person.log.map((x) => x[0]), ['comment'], 'the older line in a person\'s comment is only words');
  const other = writes();
  apply(real, issue({ labels: [{ name: LABEL_WAITING }] }), other, [{ user: BOT, body: legacyMarkerFor(pull({ number: 46 }), THIS) }]);
  assert.deepEqual(other.log.map((x) => x[0]), ['comment'], 'an older comment about another pull request is not this one');
});

test('a second pull request that closes the issue again gets its own comment', () => {
  const w = writes();
  const earlier = [{ user: BOT, body: markerFor(pull({ number: 40 }), THIS) }];
  apply(verdict(), issue({ labels: [{ name: LABEL_WAITING }] }), w, earlier);
  assert.deepEqual(w.log.map((x) => x[0]), ['comment']);
});

test('a dry run reports and writes nothing', () => {
  const w = { ...writes(), dryRun: true };
  const did = apply(verdict(), issue(), w, []);
  assert.deepEqual(w.log, []);
  assert.equal(did.length, 2);
});

test('an already released fix gets the released label', () => {
  const w = writes();
  apply(verdict({ label: LABEL_RELEASED, released: 'v1.0.0' }), issue(), w, []);
  assert.deepEqual(w.log[0], ['label', 12, LABEL_RELEASED]);
});
