import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONCIERGE_LABELS, GATE_LABELS, LEGACY_OPTIONS_MARKER, OPTIONS_MARKER, QUEUES, STUCK_AFTER_MINUTES, aicOf, ago, classify, compareVersions, isAnalysis, isConciergeLabel,
  GATE_PREFIX, MAINTAINER_ROLES, isOptionsComment, labelledAt, latestRelease, queueOf, readPin, reporterReplies, runHealth, safeText, shortGateName, spend, tokenExpiry,
} from './issue-concierge-state.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const requirements = JSON.parse(fs.readFileSync(path.join(ROOT, 'requirements.json'), 'utf8'));
const NOW = Date.parse('2026-10-27T12:00:00Z');
const issue = (labels = [], extra = {}) => ({ number: 1, state: 'open', labels: labels.map((name) => ({ name })), user: { login: 'someone', type: 'User' }, assignees: [], ...extra });

// ---------------------------------------------------------------- the labels

test('every label the state model names exists in requirements.json, so a rename cannot leave it behind', () => {
  const known = new Set(requirements.labels.map((l) => l.name));
  for (const label of CONCIERGE_LABELS) assert.ok(known.has(label), `${label} is not in requirements.json`);
  for (const q of QUEUES) assert.ok(known.has(q.label), `${q.label} is not in requirements.json`);
});

test('a label of the Concierge is a gate, a stop, the classification or a link; a label a repository may use for itself is not', () => {
  for (const label of [...GATE_LABELS, 'needs-decision', 'plan-approval-required', 'complexity/low', 'risk/high', 'related-repo']) assert.ok(isConciergeLabel(label), label);
  for (const label of ['bug', 'enhancement', 'duplicate', 'spam', 'invalid', 'help wanted']) assert.ok(!isConciergeLabel(label), label);
});

// ---------------------------------------------------------------- whose move it is

test('classify: a pull request, an opted-out issue, a bot-authored issue and an issue nobody has touched are not managed', () => {
  assert.deepEqual(classify(issue([], { pull_request: {} })), { kind: 'pull-request' });
  assert.deepEqual(classify(issue(['no-auto-processing', 'needs-decision'])), { kind: 'opted-out' });
  assert.deepEqual(classify(issue(['no-auto-processing'], { user: { login: 'github-actions[bot]', type: 'Bot' } })), { kind: 'opted-out' });
  assert.deepEqual(classify(issue(['needs-decision'], { user: { login: 'github-actions[bot]', type: 'Bot' } })), { kind: 'bot-authored' });
  assert.deepEqual(classify(issue(['bug', 'enhancement'])), { kind: 'not-picked-up' });
});

test('classify: a label only the Concierge applies makes an issue managed, and so does an analysis without any label', () => {
  assert.deepEqual(classify(issue(['complexity/low'])), { kind: 'managed', queue: 'settled' });
  assert.deepEqual(classify(issue(['enhancement']), { analysed: true }), { kind: 'managed', queue: 'settled' });
  assert.deepEqual(classify(issue(['duplicate'])), { kind: 'not-picked-up' }, 'a repository may label duplicates for itself');
});

test('queueOf: a maintainer\'s move comes before anyone else\'s, and a gate label before the coding agent', () => {
  assert.equal(queueOf(issue(['needs-info', 'needs-decision'])), 'decision');
  assert.equal(queueOf(issue(['scope-review'])), 'scope');
  assert.equal(queueOf(issue(['plan-approval-required', 'complexity/low'])), 'plan');
  assert.equal(queueOf(issue(['needs-info', 'dependency-required'])), 'dependency');
  assert.equal(queueOf(issue(['needs-info'])), 'reporter');
  assert.equal(queueOf(issue(['backlog'])), 'parked');
  assert.equal(queueOf(issue(['issue-triage-handoff'])), 'in-flight');
  assert.equal(queueOf(issue(['issue-triage-handoff'], { assignees: [{ login: 'Copilot' }] })), 'in-flight');
  assert.equal(queueOf(issue(['risk/low'], { assignees: [{ login: 'Copilot' }] })), 'with-agent');
  assert.equal(queueOf(issue(['related-repo'])), 'elsewhere');
  assert.equal(queueOf(issue(['risk/low'])), 'settled');
  assert.deepEqual(QUEUES.filter((q) => q.who === 'you').map((q) => q.label), ['needs-decision', 'scope-review', 'plan-approval-required']);
});

test('isAnalysis: the issue worker of this repository, as the bot, and nothing that only starts with its name', () => {
  const bot = { login: 'github-actions[bot]' };
  const comment = (body, user = bot) => ({ user, body });
  assert.ok(isAnalysis(comment('hi\n<!-- gh-aw-workflow-call-id: o/r/issue-worker -->'), 'o/r'));
  assert.ok(!isAnalysis(comment('<!-- gh-aw-workflow-call-id: o/r/issue-worker-extra -->'), 'o/r'));
  assert.ok(!isAnalysis(comment('<!-- gh-aw-workflow-call-id: o/other/issue-worker -->'), 'o/r'));
  assert.ok(!isAnalysis(comment('gh-aw-workflow-call-id: o/r/issue-worker', { login: 'a-person' }), 'o/r'), 'a person can type the text');
});

test('labelledAt: the last time the label was applied, from the events, or null', () => {
  const events = [
    { event: 'labeled', label: { name: 'needs-decision' }, created_at: '2026-10-26T10:00:00Z' },
    { event: 'unlabeled', label: { name: 'needs-decision' }, created_at: '2026-10-26T11:00:00Z' },
    { event: 'labeled', label: { name: 'needs-decision' }, created_at: '2026-10-27T09:00:00Z' },
    { event: 'labeled', label: { name: 'backlog' }, created_at: '2026-10-27T11:00:00Z' },
  ];
  assert.equal(labelledAt(events, 'needs-decision'), Date.parse('2026-10-27T09:00:00Z'));
  assert.equal(labelledAt(events, 'scope-review'), null);
  assert.equal(labelledAt(undefined, 'scope-review'), null);
  assert.equal(STUCK_AFTER_MINUTES, 60);
});

// ---------------------------------------------------------------- reporter replies

const reply = (n, login, at, association = 'NONE', extra = {}) => ({ issueNumber: n, id: Date.parse(at), created_at: at, user: { login, type: extra.type ?? 'User' }, author_association: association, html_url: `https://x/${n}#${login}` });
const open = new Set([1, 2, 3, 4, 5]);

test('reporterReplies: only the latest comment of an issue counts, and it must be a reporter\'s', () => {
  const out = reporterReplies(
    [
      reply(1, 'reporter', '2026-10-27T09:00:00Z'),
      reply(1, 'maintainer', '2026-10-27T10:00:00Z', 'OWNER'),
      reply(2, 'maintainer', '2026-10-27T09:00:00Z', 'MEMBER'),
      reply(2, 'reporter', '2026-10-27T10:00:00Z'),
      reply(3, 'someone', '2026-10-27T10:00:00Z', 'COLLABORATOR'),
      reply(4, 'github-actions[bot]', '2026-10-27T11:00:00Z', 'NONE', { type: 'Bot' }),
      reply(5, 'dependabot[bot]', '2026-10-27T11:00:00Z', 'NONE'),
    ],
    { now: NOW, days: 14, openNumbers: open }
  );
  assert.deepEqual(out.map((r) => [r.number, r.login]), [[2, 'reporter']]);
  assert.equal(out[0].url, 'https://x/2#reporter');
});

test('the options comment is the bot\'s, whichever line it carries, and nobody else\'s', () => {
  assert.equal(OPTIONS_MARKER, '<!-- issue-concierge:options');
  assert.equal(LEGACY_OPTIONS_MARKER, '<!-- concierge:options');
  const bot = { login: 'github-actions[bot]', type: 'Bot' };
  for (const marker of [OPTIONS_MARKER, LEGACY_OPTIONS_MARKER]) {
    assert.equal(isOptionsComment({ user: bot, body: `${marker} kind=decision -->\nwords` }), true, marker);
    assert.equal(isOptionsComment({ user: { login: 'someone', type: 'User' }, body: `${marker} kind=decision -->` }), false, `${marker} in a person's comment is only words`);
  }
  assert.equal(isOptionsComment({ user: bot, body: 'an answer' }), false);
  assert.equal(isOptionsComment({ user: bot }), false);
  assert.equal(isOptionsComment({ body: OPTIONS_MARKER }), false);
});

for (const marker of [OPTIONS_MARKER, LEGACY_OPTIONS_MARKER]) {
  test(`reporterReplies: the options comment (${marker}) is the last comment of an issue that waits, and a reply under it is still a reply`, () => {
    const menuComment = { ...reply(1, 'github-actions[bot]', '2026-10-27T11:00:00Z', 'NONE', { type: 'Bot' }), body: `${marker} kind=decision -->\nwords` };
    const out = reporterReplies([reply(1, 'reporter', '2026-10-27T10:00:00Z'), menuComment], { now: NOW, days: 14, openNumbers: open });
    assert.deepEqual(out.map((r) => [r.number, r.login]), [[1, 'reporter']]);
    const answered = reporterReplies([reply(1, 'reporter', '2026-10-27T09:00:00Z'), reply(1, 'maintainer', '2026-10-27T10:00:00Z', 'OWNER'), menuComment], { now: NOW, days: 14, openNumbers: open });
    assert.deepEqual(answered, [], 'a maintainer answered before the menu was posted again');
  });
}

test('reporterReplies: a repository role of write or more is a maintainer whatever the association says, because a private member reads as a CONTRIBUTOR', () => {
  const comments = [
    reply(1, 'private-member', '2026-10-27T10:00:00Z', 'CONTRIBUTOR'),
    reply(2, 'reader', '2026-10-27T10:00:00Z', 'CONTRIBUTOR'),
    reply(3, 'unasked', '2026-10-27T10:00:00Z', 'CONTRIBUTOR'),
    reply(4, 'triager', '2026-10-27T10:00:00Z', 'NONE'),
    reply(5, 'maintainer', '2026-10-27T10:00:00Z', 'NONE'),
  ];
  const roles = new Map([['private-member', 'admin'], ['reader', 'read'], ['unasked', null], ['triager', 'triage'], ['maintainer', 'maintain']]);
  const out = reporterReplies(comments, { now: NOW, days: 14, openNumbers: open, roles });
  assert.deepEqual(out.map((r) => r.login).sort(), ['reader', 'triager', 'unasked'], 'only write, maintain and admin answer for the maintainers');
  for (const role of ['write', 'maintain', 'admin']) assert.equal(MAINTAINER_ROLES.has(role), true, role);
  for (const role of ['read', 'triage', 'none', null, undefined]) assert.equal(MAINTAINER_ROLES.has(role), false, String(role));
  assert.deepEqual(reporterReplies(comments, { now: NOW, days: 14, openNumbers: open }).length, 5, 'without roles the association alone decides, as before');
});

test('reporterReplies: the reporter is told from another commenter by the login the issue has on record, and comes first', () => {
  const comments = [
    reply(1, 'Tsigle', '2026-10-27T08:00:00Z'),
    reply(2, 'passer-by', '2026-10-27T11:00:00Z'),
    reply(3, 'someone-else', '2026-10-27T10:00:00Z'),
    reply(4, 'the-author', '2026-10-27T09:00:00Z', 'CONTRIBUTOR'),
  ];
  const reporters = new Map([[1, 'tsigle'], [2, 'tsigle'], [4, 'the-author']]);
  const out = reporterReplies(comments, { now: NOW, days: 14, openNumbers: open, reporters });
  assert.deepEqual(out.map((r) => [r.number, r.login, r.reporter]), [[4, 'the-author', true], [1, 'Tsigle', true], [2, 'passer-by', false], [3, 'someone-else', false]], 'the case of a login does not matter; the reporter first, then newest first');
  assert.deepEqual(reporterReplies(comments, { now: NOW, days: 14, openNumbers: open }).map((r) => r.reporter), [false, false, false, false], 'nobody is the reporter when nobody is named');
});

test('reporterReplies: a contributor or a first-time commenter is a reporter, a closed issue and an old reply are not listed, newest first', () => {
  const out = reporterReplies(
    [
      reply(1, 'a', '2026-10-27T08:00:00Z', 'CONTRIBUTOR'),
      reply(2, 'b', '2026-10-27T10:00:00Z', 'FIRST_TIME_CONTRIBUTOR'),
      reply(3, 'c', '2026-10-01T10:00:00Z'),
      reply(99, 'd', '2026-10-27T10:00:00Z'),
    ],
    { now: NOW, days: 14, openNumbers: open }
  );
  assert.deepEqual(out.map((r) => r.number), [2, 1]);
  assert.deepEqual(reporterReplies([reply(3, 'c', '2026-10-20T13:00:00Z')], { now: NOW, days: 7, openNumbers: open }).map((r) => r.number), [3], 'just inside seven days');
  assert.deepEqual(reporterReplies([reply(3, 'c', '2026-10-20T11:00:00Z')], { now: NOW, days: 7, openNumbers: open }), [], 'just outside');
});

// ---------------------------------------------------------------- spend and health

const FOOTER = (n) => `A plan.\n\n> Generated by [Issue Concierge 2a Plan Worker](https://github.com/o/r/actions/runs/1) for #3 · copilot · auto · ~${n} AIC · ⊞ 4.5K · [◷](https://github.com/search?q=x)\n`;

test('aicOf: the cost a gate reports in its footer, and zero for a comment without one', () => {
  assert.equal(aicOf(FOOTER(14)), 14);
  assert.equal(aicOf(FOOTER('1.5')), 1.5);
  assert.equal(aicOf('> Generated by [Issue Concierge 1a ▸ Issue Worker](https://x) for #9 · copilot · small · ~1 AIC · ⌖ ~1 AIC'), 1);
  assert.equal(aicOf('I think it costs ~20 AIC'), 0, 'only the gate footer counts');
  assert.equal(aicOf(''), 0);
  assert.equal(aicOf(undefined), 0);
});

test('spend: the bot\'s comments of the last seven days, and how much of it was in the last 24 hours', () => {
  const bot = { login: 'github-actions[bot]' };
  const c = (at, body, user = bot) => ({ created_at: at, body, user });
  const out = spend(
    [
      c('2026-10-27T10:00:00Z', FOOTER(14)),
      c('2026-10-26T10:00:00Z', FOOTER(15.5)),
      c('2026-10-19T10:00:00Z', FOOTER(100)),
      c('2026-10-27T10:00:00Z', FOOTER(50), { login: 'a-person' }),
      c('2026-10-27T10:00:00Z', 'no footer here'),
    ],
    { now: NOW }
  );
  assert.deepEqual(out, { total: 29.5, last24h: 14, comments: 2 });
});

test('runHealth: the last good run of each gate, and only real failures of the last seven days', () => {
  const run = (name, conclusion, at, extra = {}) => ({ name, conclusion, status: extra.status ?? 'completed', created_at: at, html_url: `https://x/${name}` });
  const out = runHealth(
    [
      run('Issue Concierge 1a ▸ Issue Worker', 'success', '2026-10-27T10:00:00Z'),
      run('Issue Concierge 1a ▸ Issue Worker', 'success', '2026-10-27T11:00:00Z'),
      run('Issue Concierge 1a ▸ Issue Worker', 'skipped', '2026-10-27T11:30:00Z'),
      run('Issue Concierge 2a Plan Worker', 'failure', '2026-10-27T09:00:00Z'),
      run('Issue Concierge 2b Plan Triage', 'timed_out', '2026-10-26T09:00:00Z'),
      run('Issue Concierge 3a PR Worker', 'cancelled', '2026-10-27T09:00:00Z'),
      run('Issue Concierge 1b Issue Triage', 'failure', '2026-10-27T09:00:00Z', { status: 'in_progress' }),
      run('Issue Concierge 4a ▸ Janitor', 'startup_failure', '2026-10-10T09:00:00Z'),
      run('CI', 'failure', '2026-10-27T09:00:00Z'),
    ],
    { now: NOW }
  );
  assert.deepEqual(out.lastGood, [{ name: 'Issue Concierge 1a ▸ Issue Worker', at: Date.parse('2026-10-27T11:00:00Z') }]);
  assert.deepEqual(out.failures.map((f) => f.name), ['Issue Concierge 2a Plan Worker', 'Issue Concierge 2b Plan Triage']);
});

test('the workflows are the Concierge\'s under either name: the runs from before the rename count, and one gate is one entry', () => {
  const run = (name, conclusion, at) => ({ name, conclusion, status: 'completed', created_at: at, html_url: `https://x/${encodeURIComponent(name)}` });
  const out = runHealth(
    [
      run('Concierge 1a ▸ Issue Worker', 'success', '2026-10-27T10:00:00Z'),
      run('Issue Concierge 1a ▸ Issue Worker', 'success', '2026-10-27T11:00:00Z'),
      run('Concierge 2a Plan Worker', 'success', '2026-10-27T09:00:00Z'),
      run('Concierge 2b Plan Triage', 'failure', '2026-10-27T08:00:00Z'),
      run('Issue Concierge 3a PR Worker', 'failure', '2026-10-27T07:00:00Z'),
      run('Issue Conciergex 5a', 'failure', '2026-10-27T06:00:00Z'),
      run('Conciergerie', 'failure', '2026-10-27T06:00:00Z'),
    ],
    { now: NOW }
  );
  assert.deepEqual(out.lastGood.map((g) => [shortGateName(g.name), g.at]), [
    ['1a ▸ Issue Worker', Date.parse('2026-10-27T11:00:00Z')],
    ['2a Plan Worker', Date.parse('2026-10-27T09:00:00Z')],
  ], 'the gate that ran under both names is listed once, with its latest run');
  assert.equal(out.lastGood[0].name, 'Issue Concierge 1a ▸ Issue Worker', 'under the name of its latest run');
  assert.deepEqual(out.failures.map((f) => f.name), ['Concierge 2b Plan Triage', 'Issue Concierge 3a PR Worker'], 'a failure counts under either name, and a name that only looks similar does not');
});

test('the cost in a gate\'s footer is read under either name, and not from a footer of something else', () => {
  const footer = (name, aic) => `> Generated by [${name}](https://github.com/o/r/actions/runs/1) for #3 · copilot · auto · ~${aic} AIC · ⊞ 4.5K`;
  assert.equal(aicOf(footer('Issue Concierge 1a ▸ Issue Worker', 14)), 14, 'a comment written since the rename');
  assert.equal(aicOf(footer('Concierge 1a ▸ Issue Worker', 9.5)), 9.5, 'a comment written before it');
  assert.equal(aicOf(footer('Some Other Bot', 7)), 0, 'a footer of another workflow is not the Concierge\'s cost');
});

test('shortGateName drops the product\'s prefix, old or new, and nothing else', () => {
  assert.equal(shortGateName('Issue Concierge 1a ▸ Issue Worker'), '1a ▸ Issue Worker');
  assert.equal(shortGateName('Concierge 1a ▸ Issue Worker'), '1a ▸ Issue Worker');
  assert.equal(shortGateName('CI'), 'CI');
  assert.equal(shortGateName(undefined), '');
  assert.ok(GATE_PREFIX.test('Issue Concierge 4e ▸ Updater') && GATE_PREFIX.test('Concierge 4e ▸ Updater') && !GATE_PREFIX.test('My Issue Concierge 1a'));
});

// ---------------------------------------------------------------- the pin, releases, the token

test('readPin reads source, version and channel, with stable as the default channel', () => {
  assert.deepEqual(readPin('# note\nsource: o/issue-concierge\nversion: v1.8.0\nsha: abc\nchannel: prerelease\n'), { source: 'o/issue-concierge', version: 'v1.8.0', channel: 'prerelease' });
  assert.deepEqual(readPin('source: o/r\nversion: v1.0.0\n'), { source: 'o/r', version: 'v1.0.0', channel: 'stable' });
  assert.deepEqual(readPin(null), { source: null, version: null, channel: 'stable' });
});

test('compareVersions orders numbers, not text, and a prerelease below its release', () => {
  assert.ok(compareVersions('v1.10.0', 'v1.9.0') > 0);
  assert.ok(compareVersions('v2.0.0', 'v1.99.99') > 0);
  assert.ok(compareVersions('v2.0.0-rc.1', 'v2.0.0') < 0);
  assert.ok(compareVersions('v2.0.0', 'v2.0.0-rc.1') > 0);
  assert.ok(compareVersions('v2.0.0-rc.10', 'v2.0.0-rc.9') > 0);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('latest', 'v1.0.0'), null);
});

test('latestRelease: stable skips prereleases and drafts, the prerelease channel takes any published one', () => {
  const releases = [
    { tag_name: 'v2.0.0-rc.1', prerelease: true },
    { tag_name: 'v1.9.0', prerelease: false },
    { tag_name: 'v1.10.0', prerelease: false, draft: true },
    { tag_name: 'nightly', prerelease: true },
  ];
  assert.equal(latestRelease(releases, 'stable'), 'v1.9.0');
  assert.equal(latestRelease(releases, 'prerelease'), 'v2.0.0-rc.1');
  assert.equal(latestRelease([], 'stable'), null);
  assert.equal(latestRelease(undefined, 'stable'), null);
});

test('tokenExpiry reads the header GitHub sends, and nothing else', () => {
  assert.equal(tokenExpiry('2026-11-25 06:34:56 UTC'), Date.parse('2026-11-25T06:34:56Z'));
  assert.equal(tokenExpiry(''), null);
  assert.equal(tokenExpiry(undefined), null);
  assert.equal(tokenExpiry('never'), null);
});

// ---------------------------------------------------------------- text from outside

test('safeText: no mention, no reference, no markup and no HTML survives, and the length is bounded', () => {
  const nasty = 'Fix @everyone and @octocat in #12 <script>alert(1)</script> `code` *bold* _it_ [x](http://a) | pipe \\ ~strike~ &amp;';
  const out = safeText(nasty, 500);
  for (const c of ['@', '<', '>', '`', '*', '[', ']', '|', '\\', '~']) assert.ok(!out.includes(c), `"${c}" is still in ${out}`);
  assert.ok(!/(?<!&)#/.test(out), 'every # is part of an entity, so #12 links nothing');
  assert.ok(!/&(?!#\d+;)/.test(out), 'every ampersand is an entity of its own');
  assert.match(out, /&#64;octocat/);
  assert.equal(safeText('a'.repeat(200), 80).length, 80);
  assert.ok(safeText('a'.repeat(200), 80).endsWith('…'));
  assert.equal(safeText('  two\n\nlines\there  '), 'two lines here');
  assert.equal(safeText(undefined), '');
});

test('ago: never finer than an hour, so that the page changes at most once an hour', () => {
  assert.equal(ago(0), 'under 1 h');
  assert.equal(ago(59 * 60000), 'under 1 h');
  assert.equal(ago(60 * 60000), '1 h');
  assert.equal(ago(119 * 60000), '1 h');
  assert.equal(ago(3 * 3600000), '3 h');
  assert.equal(ago(47 * 3600000), '47 h');
  assert.equal(ago(48 * 3600000), '2 d');
  assert.equal(ago(3.9 * 86400000), '3 d');
  assert.equal(ago(-5000), 'under 1 h');
});
