import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_MARKER, LEGACY_MENTION_MARKER, LEGACY_TITLE, LIST_CAP, MARKER, MENTION_CAP, MENTION_MARKER, TITLE, collect, hasStatusMarker, findStatusIssue, main, maintainersOf, normalise, nudge, overdue, planMention, reconcile, render, renderMention, summarize } from './status-issue.mjs';
import { DEFAULTS } from './issue-concierge-settings.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse('2026-10-27T12:00:00Z');
const REPO = 'o/r';
const SETTINGS = { ...DEFAULTS };
const ago = (ms) => new Date(NOW - ms).toISOString();
const H = 3600000;
const D = 86400000;

const issue = (number, labels = [], extra = {}) => ({
  number, title: `Issue ${number}`, state: 'open', body: '', labels: labels.map((name) => ({ name })), user: { login: 'someone', type: 'User' },
  assignees: [], updated_at: ago(D), node_id: `N${number}`, ...extra,
});
const labelled = (label, at) => [{ event: 'labeled', label: { name: label }, created_at: at }];
const comment = (n, login, at, extra = {}) => ({
  id: Date.parse(at), issueNumber: n, created_at: at, user: { login, type: extra.type ?? 'User' }, author_association: extra.assoc ?? 'NONE',
  html_url: `https://github.com/${REPO}/issues/${n}#c`, body: extra.body ?? 'text', ...extra,
});
const PIN = { source: 'o/concierge', version: 'v1.8.0', channel: 'stable' };

function raw(over = {}) {
  return {
    repo: REPO, issues: [], comments: [], analysed: new Set(), events: new Map(), runs: [], pin: PIN, latest: 'v1.8.0',
    token: { state: 'ok', expiresAt: NOW + 40 * D }, problems: [], ...over,
  };
}

/** One repository's worth of every kind of issue. */
function fixture() {
  const issues = [
    issue(1, ['needs-decision']),
    issue(2, ['needs-decision']),
    issue(3, ['plan-approval-required', 'complexity/low']),
    issue(4, ['issue-triage-handoff']),
    issue(5, ['plan-worker-ready']),
    issue(6, ['needs-info']),
    issue(7, ['backlog']),
    issue(8, ['dependency-required']),
    issue(9, ['no-auto-processing'], { title: 'Old report' }),
    issue(10, [], { title: '[aw] Issue Worker failed', user: { login: 'github-actions[bot]', type: 'Bot' } }),
    issue(11, ['bug']),
    issue(12, ['enhancement']),
    issue(13, ['risk/low'], { assignees: [{ login: 'Copilot' }] }),
    issue(14, [], { pull_request: {} }),
  ];
  const events = new Map([
    [1, labelled('needs-decision', ago(2 * D))],
    [2, labelled('needs-decision', ago(5 * D))],
    [3, labelled('plan-approval-required', ago(3 * H))],
    [4, labelled('issue-triage-handoff', ago(3 * H))],
    [5, labelled('plan-worker-ready', ago(10 * 60000))],
  ]);
  const comments = [
    comment(9, 'old-reporter', ago(3 * H)),
    comment(6, 'reporter', ago(1 * H), { body: 'SECRET-TEXT @everyone' }),
    comment(1, 'maintainer', ago(1 * H), { assoc: 'OWNER' }),
  ];
  return raw({ issues, events, comments, analysed: new Set([12]) });
}

// ---------------------------------------------------------------- summarize

test('summarize counts the open issues by what the Concierge is to them, and leaves pull requests out', () => {
  const m = summarize(fixture(), SETTINGS, NOW);
  assert.deepEqual(m.counts, { open: 13, managed: 10, optedOut: 1, botAuthored: 1, notPickedUp: 1 });
  assert.equal(m.counts.managed + m.counts.optedOut + m.counts.botAuthored + m.counts.notPickedUp, m.counts.open);
});

test('summarize: each queue lists its issues oldest first, from when the label was applied', () => {
  const m = summarize(fixture(), SETTINGS, NOW);
  const q = (id) => m.queues.find((x) => x.id === id).items;
  assert.deepEqual(q('decision').map((i) => i.number), [2, 1]);
  assert.deepEqual(q('plan').map((i) => i.number), [3]);
  assert.deepEqual(q('reporter').map((i) => i.number), [6]);
  assert.deepEqual(q('parked').map((i) => i.number), [7]);
  assert.deepEqual(q('dependency').map((i) => i.number), [8]);
  assert.equal(m.stages['with-agent'], 1);
  assert.equal(m.stages.settled, 1, 'the analysed issue with no label');
});

test('summarize: an issue in a gate for over an hour is stuck, one that just entered is not', () => {
  const m = summarize(fixture(), SETTINGS, NOW);
  assert.deepEqual(m.stages['in-flight'].map((i) => [i.number, i.gate, i.stuck]), [[4, 'issue-triage-handoff', true], [5, 'plan-worker-ready', false]]);
});

test('summarize: reporter replies include an opted-out issue, marked, and leave out a maintainer\'s last word', () => {
  const m = summarize(fixture(), SETTINGS, NOW);
  assert.deepEqual(m.replies.map((r) => [r.number, r.login, r.optedOut]), [[6, 'reporter', false], [9, 'old-reporter', true]]);
  assert.equal(m.replies[0].title, 'Issue 6');
});

test('summarize: the pinned version is behind only when the channel has a newer release', () => {
  assert.equal(summarize(fixture(), SETTINGS, NOW).behind, null);
  assert.equal(summarize({ ...fixture(), latest: 'v2.0.0' }, SETTINGS, NOW).behind, 'v2.0.0');
  assert.equal(summarize({ ...fixture(), latest: 'v1.7.0' }, SETTINGS, NOW).behind, null);
  assert.equal(summarize({ ...fixture(), latest: null }, SETTINGS, NOW).behind, null);
});

// ---------------------------------------------------------------- render

test('the page opens with the marker, then the sections in the order a maintainer needs them', () => {
  const body = render(summarize(fixture(), SETTINGS, NOW));
  assert.equal(body.split('\n')[0], MARKER);
  const headings = [...body.matchAll(/^#{1,2} (.+)$/gm)].map((m) => m[1].replace(/ \(\d+\).*$/, '').replace(/ · .*$/, ''));
  assert.deepEqual(headings, [TITLE, 'Needs you', 'Reporter replies waiting', 'In flight', 'Everything else the Concierge manages', 'Which issues the Concierge manages', 'Health', 'Spend', 'Settings']);
});

test('the page says whose move it is, how long it has waited, and links the whole queue', () => {
  const body = render(summarize(fixture(), SETTINGS, NOW));
  assert.match(body, /## Needs you \(3\)/);
  assert.match(body, /\*\*Held: changes what exists\*\* · \[2 issues\]\(https:\/\/github\.com\/o\/r\/issues\?q=is%3Aissue%20is%3Aopen%20label%3Aneeds-decision\)/);
  assert.ok(body.indexOf('- #2 Issue 2') < body.indexOf('- #1 Issue 1'), 'the oldest first');
  assert.match(body, /- #2 Issue 2 · waiting 5 d/);
  assert.match(body, /- #3 Issue 3 · waiting 3 h/);
  assert.match(body, /## In flight \(2\) · 1 stuck/);
  assert.match(body, /- #4 Issue 4 · `issue-triage-handoff` for 3 h ⚠ stuck/);
});

test('the page counts what the Concierge manages next to what it does not, so every number has a denominator', () => {
  const body = render(summarize(fixture(), SETTINGS, NOW));
  assert.match(body, /13 open issues = \*\*10 managed\*\* · 1 opted out \(`no-auto-processing`\) · 1 opened by bots · 1 not yet picked up/);
  assert.match(body, /Every number on this page counts the 10 managed issues, except the reporter replies, which also include opted-out issues\./);
});

test('reporter replies show the login and a link and never the text of the comment', () => {
  const body = render(summarize(fixture(), SETTINGS, NOW));
  assert.match(body, /## Reporter replies waiting \(2\)/);
  assert.match(body, /- #6 Issue 6 · `reporter` replied 1 h ago · \[comment\]\(https:\/\/github\.com\/o\/r\/issues\/6#c\)/);
  assert.match(body, /- #9 Old report · `old-reporter` replied 3 h ago · opted out, the Concierge will not answer/);
  assert.ok(!body.includes('SECRET-TEXT') && !body.includes('@everyone'));
});

test('text from outside cannot mention anyone or link the page into another issue', () => {
  const f = fixture();
  f.issues[0].title = 'Please @octocat see #123 <img src=x onerror=1> `x` [y](z)';
  f.comments.push(comment(1, 'x', ago(60000)));
  const body = render(summarize(f, SETTINGS, NOW));
  const line = body.split('\n').find((l) => l.startsWith('- #1 '));
  assert.ok(!/@|<|`|\[|(?<!&)#\d/.test(line.replace(/^- #1 /, '').replace(/ · waiting.*$/, '')), line);
  assert.match(line, /&#64;octocat see &#35;123/);
});

test('a long queue shows ten and links the rest', () => {
  const f = fixture();
  for (let n = 100; n < 115; n += 1) f.issues.push(issue(n, ['needs-decision']));
  const body = render(summarize(f, SETTINGS, NOW));
  assert.equal(LIST_CAP, 10);
  const held = body.split('**Held: changes what exists**')[1].split('\n\n')[0];
  assert.equal(held.split('\n').filter((l) => l.startsWith('- #')).length, 10);
  assert.match(held, /- and 7 more: \[all 17\]\(https:\/\/github\.com\/o\/r\/issues\?q=is%3Aissue%20is%3Aopen%20label%3Aneeds-decision\)/);
});

test('five hundred open issues still make a page that fits', () => {
  const f = fixture();
  for (let n = 1000; n < 1500; n += 1) f.issues.push(issue(n, [['needs-decision', 'backlog', 'needs-info', 'plan-approval-required', 'issue-triage-handoff'][n % 5]], { title: 'x'.repeat(300) }));
  const body = render(summarize(f, SETTINGS, NOW));
  assert.ok(body.length < 60000, `${body.length} characters`);
  assert.ok(body.startsWith(MARKER));
});

test('the numbers come as JSON for a dashboard, and agree with the page', () => {
  const body = render(summarize(fixture(), SETTINGS, NOW));
  const json = JSON.parse(body.split('```json\n')[1].split('\n```')[0]);
  assert.equal(json.schema, 1);
  assert.equal(json.repo, REPO);
  assert.deepEqual([json.open, json.managed, json.optedOut, json.botAuthored, json.notPickedUp], [13, 10, 1, 1, 1]);
  assert.deepEqual(json.queues, { decision: 2, scope: 0, plan: 1, dependency: 1, reporter: 1, parked: 1 });
  assert.equal(json.stuck, 1);
  assert.equal(json.replies, 2);
  assert.equal(json.pinned, 'v1.8.0');
});

test('health shows the last good run, failures with a link, the pin, and each state of the token', () => {
  const f = fixture();
  f.runs = [
    { name: 'Issue Concierge 1a ▸ Issue Worker', conclusion: 'success', status: 'completed', created_at: ago(12 * 60000), html_url: 'https://x/1' },
    { name: 'Issue Concierge 2a Plan Worker', conclusion: 'failure', status: 'completed', created_at: ago(2 * H), html_url: 'https://x/2' },
  ];
  const text = (token) => render(summarize({ ...f, token }, SETTINGS, NOW));
  const body = text({ state: 'ok', expiresAt: NOW + 40 * D });
  assert.match(body, /- Last good run: 1a ▸ Issue Worker under 1 h ago/);
  // runs from before the rename carry the old prefix and read the same
  f.runs = [{ ...f.runs[0], name: 'Concierge 1a ▸ Issue Worker' }, { ...f.runs[1], name: 'Concierge 2a Plan Worker' }];
  const old = text({ state: 'ok', expiresAt: NOW + 40 * D });
  assert.match(old, /- Last good run: 1a ▸ Issue Worker under 1 h ago/);
  assert.match(old, /  - \[2a Plan Worker\]\(https:\/\/x\/2\) 2 h ago/);
  f.runs = [{ ...f.runs[0], name: 'Issue Concierge 1a ▸ Issue Worker' }, { ...f.runs[1], name: 'Issue Concierge 2a Plan Worker' }];
  assert.match(body, /- Failed runs in the last 7 days: 1\n  - \[2a Plan Worker\]\(https:\/\/x\/2\) 2 h ago/);
  assert.match(body, /- Pinned: `v1\.8\.0` \(stable\) from `o\/concierge` · up to date/);
  assert.match(body, /`SIGNAL_TOKEN` expires 2026-12-06 \(in 40 days\)\./);
  assert.match(text({ state: 'ok', expiresAt: NOW + 9 * D }), /⚠ `SIGNAL_TOKEN` expires 2026-11-05 \(in 9 days\)\. Renew it before then\./);
  assert.match(text({ state: 'ok', expiresAt: null }), /`SIGNAL_TOKEN` is accepted and has no expiry date\./);
  assert.match(text({ state: 'rejected', status: 401 }), /⚠ `SIGNAL_TOKEN` is rejected by GitHub \(HTTP 401\): the gates cannot label\. Renew it\./);
  assert.match(text({ state: 'missing' }), /⚠ `SIGNAL_TOKEN` is not set/);
  assert.match(text({ state: 'unknown' }), /could not be checked/);
  assert.match(render(summarize({ ...f, latest: 'v1.9.0' }, SETTINGS, NOW)), /⚠ v1\.9\.0 is available, the updater opens a pull request/);
  assert.match(render(summarize({ ...f, pin: { source: null, version: null, channel: 'stable' } }, SETTINGS, NOW)), /No pin file/);
});

test('spend and settings are on the page, and so is every settings line that could not be used', () => {
  const f = fixture();
  f.comments.push({ ...comment(3, 'github-actions[bot]', ago(2 * H)), body: '> Generated by [Issue Concierge 2a Plan Worker](https://x) for #3 · copilot · auto · ~14 AIC · ⊞ 4.5K' });
  f.problems = ['settings.yml line 4: unknown setting "colour" (ignored)'];
  const body = render(summarize(f, SETTINGS, NOW));
  assert.match(body, /About 14 AIC in the last 7 days \(14 in the last 24 hours\), from 1 comment of the gates\. A run that posts no comment is not counted\./);
  assert.match(body, /`status-issue`: true · `reporter-replies-days`: 14\./);
  assert.match(body, /- ⚠ settings\.yml line 4: unknown setting "colour" \(ignored\)/);
  assert.match(render(summarize({ ...fixture(), pinNote: 'a repository holds at most three pinned issues' }, SETTINGS, NOW)), /> ⚠ This issue is not pinned: a repository holds at most three pinned issues/);
});

test('a paused Concierge says so at the top of the page, since when, and how to resume', () => {
  const body = render(summarize({ ...fixture(), paused: { since: '2026-10-27T09:30:00Z' } }, SETTINGS, NOW));
  const banner = body.split('\n').find((l) => l.startsWith('> ⏸'));
  assert.match(banner, /^> ⏸ \*\*Paused\*\* since 2026-10-27 09:30 UTC\. No gate, sweep, closer or notifier touches an issue or a pull request, and runs that are already in flight finish\./);
  assert.match(banner, /delete the repository variable `ISSUE_CONCIERGE_PAUSED` \(and `CONCIERGE_PAUSED`, its older name, if it is set\) or set it to anything but `true`: \[Settings › Variables\]\(https:\/\/github\.com\/o\/r\/settings\/variables\/actions\)/);
  assert.match(banner, /may need `\/retry` afterwards/);
  assert.ok(body.indexOf('> ⏸') < body.indexOf('## Needs you'), 'before the first section');
  assert.match(render(summarize({ ...fixture(), paused: { since: null } }, SETTINGS, NOW)), /> ⏸ \*\*Paused\*\*\. No gate/, 'without a date when the variable cannot be read');
  assert.ok(!render(summarize(fixture(), SETTINGS, NOW)).includes('Paused'), 'and not a word when it is not paused');
  const json = (m) => JSON.parse(render(m).split('```json\n')[1].split('\n```')[0]).paused;
  assert.equal(json(summarize({ ...fixture(), paused: { since: null } }, SETTINGS, NOW)), true);
  assert.equal(json(summarize(fixture(), SETTINGS, NOW)), false);
});

test('collect reads the date of the variable only when the Concierge is paused, and goes on without it when it cannot', () => {
  const idle = fakeCtx({ issues: [] });
  assert.equal(collect(idle, REPO, SETTINGS, 't').paused, null);
  assert.equal(idle.calls.variableRead, undefined);
  const paused = fakeCtx({ issues: [] });
  assert.deepEqual(collect(paused, REPO, SETTINGS, 't', ['ISSUE_CONCIERGE_PAUSED']).paused, { since: '2026-10-27T09:30:00Z' });
  assert.deepEqual(paused.calls.variablesRead, ['ISSUE_CONCIERGE_PAUSED'], 'it asks for the variable that is set, and for no other');
  const old = fakeCtx({ issues: [] });
  assert.deepEqual(collect(old, REPO, SETTINGS, 't', ['CONCIERGE_PAUSED']).paused, { since: '2026-10-27T09:30:00Z' });
  assert.deepEqual(old.calls.variablesRead, ['CONCIERGE_PAUSED']);
  const denied = fakeCtx({ issues: [], variable: { status: 403, data: null } });
  assert.deepEqual(collect(denied, REPO, SETTINGS, 't', ['ISSUE_CONCIERGE_PAUSED']).paused, { since: null });
});

test('collect with both variables set says the pause began with the earlier one, and with only one readable uses that one', () => {
  const stamp = (updated_at) => ({ status: 200, data: { updated_at } });
  const both = fakeCtx({ issues: [], variableByName: { ISSUE_CONCIERGE_PAUSED: stamp('2026-10-28T08:00:00Z'), CONCIERGE_PAUSED: stamp('2026-10-27T09:30:00Z') } });
  assert.deepEqual(collect(both, REPO, SETTINGS, 't', ['ISSUE_CONCIERGE_PAUSED', 'CONCIERGE_PAUSED']).paused, { since: '2026-10-27T09:30:00Z' });
  assert.deepEqual(both.calls.variablesRead, ['ISSUE_CONCIERGE_PAUSED', 'CONCIERGE_PAUSED']);
  const half = fakeCtx({ issues: [], variableByName: { ISSUE_CONCIERGE_PAUSED: { status: 403, data: null }, CONCIERGE_PAUSED: stamp('2026-10-27T09:30:00Z') } });
  assert.deepEqual(collect(half, REPO, SETTINGS, 't', ['ISSUE_CONCIERGE_PAUSED', 'CONCIERGE_PAUSED']).paused, { since: '2026-10-27T09:30:00Z' });
});

test('main: the variable reaches the page through the environment', () => {
  const ctx = fakeCtx({ issues: [] });
  const { lines } = run(ctx, { DRY_RUN: 'true', ISSUE_CONCIERGE_PAUSED: 'true' });
  assert.ok(lines.some((l) => l.includes('> ⏸ **Paused** since 2026-10-27 09:30 UTC')));
  for (const vars of [{ CONCIERGE_PAUSED: 'true' }, { ISSUE_CONCIERGE_PAUSED: 'TRUE', CONCIERGE_PAUSED: 'false' }]) {
    const older = run(fakeCtx({ issues: [] }), { DRY_RUN: 'true', ...vars });
    assert.ok(older.lines.some((l) => l.includes('> ⏸ **Paused**')), JSON.stringify(vars));
  }
  for (const vars of [{}, { ISSUE_CONCIERGE_PAUSED: 'false', CONCIERGE_PAUSED: 'false' }, { ISSUE_CONCIERGE_PAUSED: '', CONCIERGE_PAUSED: '' }]) {
    const other = run(fakeCtx({ issues: [] }), { DRY_RUN: 'true', ...vars });
    assert.ok(!other.lines.some((l) => l.includes('Paused')), JSON.stringify(vars));
  }
});

test('an empty repository gets a page that says so, not a blank one', () => {
  const body = render(summarize(raw(), SETTINGS, NOW));
  assert.match(body, /Nothing is waiting for a maintainer\./);
  assert.match(body, /No issue is in a gate\./);
  assert.match(body, /0 open issues = \*\*0 managed\*\*/);
});

test('normalise ignores the time of the last change and nothing else', () => {
  const a = render(summarize(fixture(), SETTINGS, NOW));
  const b = render(summarize(fixture(), SETTINGS, NOW + 7 * 60000)); // seven minutes later: the same hours
  assert.notEqual(a, b);
  assert.equal(normalise(a), normalise(b));
  assert.notEqual(normalise(a), normalise(render(summarize(raw(), SETTINGS, NOW))));
});

// ---------------------------------------------------------------- GitHub

/** A fake GitHub: routes the calls of the script to canned answers and records every write. */
function fakeCtx({ collaborators = [{ login: 'alice', type: 'User', role_name: 'admin' }, { login: 'bob', type: 'User', role_name: 'maintain' }], collaboratorsFail = [], variableByName = null, variable = { status: 200, data: { value: 'true', updated_at: '2026-10-27T09:30:00Z' } }, issues = [], botIssues = [], comments = [], issueComments = {}, events = {}, runs = [], files = {}, releases = [{ tag_name: 'v1.8.0', prerelease: false }], probe = { state: 'ok', expiresAt: null }, pinned = false, pinFails = null } = {}) {
  const calls = { list: [], write: [], graphql: [] };
  let isPinned = pinned;
  return {
    calls,
    now: NOW,
    list(p, opts = {}) {
      calls.list.push(p);
      if (p === 'repos/o/r/collaborators') {
        (calls.collaboratorTokens ??= []).push(opts.token ?? 'workflow');
        return collaboratorsFail.includes(opts.token ?? 'workflow') ? null : collaborators;
      }
      if (/^repos\/o\/r\/issues\?state=all&creator=/.test(p)) return botIssues;
      if (p === 'repos/o/r/issues?state=open') return issues;
      if (p.startsWith('repos/o/r/issues/comments?since=')) return comments;
      let m = /^repos\/o\/r\/issues\/(\d+)\/comments$/.exec(p);
      if (m) return issueComments[m[1]] ?? [];
      m = /^repos\/o\/r\/issues\/(\d+)\/events$/.exec(p);
      if (m) return events[m[1]] ?? [];
      throw new Error(`unexpected list ${p}`);
    },
    get(p) {
      if (p.startsWith('repos/o/concierge/releases')) return { status: 200, data: releases };
      const named = /^repos\/o\/r\/actions\/variables\/(ISSUE_CONCIERGE_PAUSED|CONCIERGE_PAUSED)$/.exec(p);
      if (named) {
        calls.variableRead = (calls.variableRead ?? 0) + 1;
        (calls.variablesRead ??= []).push(named[1]);
        return variableByName?.[named[1]] ?? variable;
      }
      throw new Error(`unexpected get ${p}`);
    },
    runs: () => runs,
    probe: () => probe,
    write(method, p, body) {
      calls.write.push({ method, path: p, body });
      return method === 'POST' ? { number: 99, node_id: 'N99', state: 'open', body: body.body } : null;
    },
    graphql(query, vars, token) {
      calls.graphql.push({ kind: /unpinIssue/.test(query) ? 'unpin' : /pinIssue/.test(query) ? 'pin' : 'isPinned', vars, token });
      if (/isPinned/.test(query)) return { data: { node: { isPinned } } };
      if (pinFails) throw new Error(pinFails);
      isPinned = !/unpinIssue/.test(query);
      return { data: {} };
    },
    read: (file) => files[file] ?? null,
  };
}

test('collect reads what the page needs and nothing it does not', () => {
  const ctx = fakeCtx({
    issues: [
      issue(1, ['needs-decision']),
      issue(2, ['bug']),
      issue(3, ['enhancement']),
      issue(4, ['issue-triage-handoff']),
      issue(5, ['backlog']),
      issue(50, [], { body: `${MARKER}\n# ${TITLE}`, user: { login: 'github-actions[bot]', type: 'Bot' } }),
      issue(60, [], { pull_request: {} }),
    ],
    issueComments: { 2: [], 3: [{ user: { login: 'github-actions[bot]' }, body: '<!-- gh-aw-workflow-call-id: o/r/issue-worker -->' }] },
    comments: [{ ...comment(1, 'r', ago(H)), issue_url: 'https://api.github.com/repos/o/r/issues/1' }],
    files: { '.github/concierge.yml': 'source: o/concierge\nversion: v1.8.0\nchannel: stable\n' },
  });
  const out = collect(ctx, REPO, SETTINGS, 'tok');
  assert.deepEqual(out.issues.map((i) => i.number), [1, 2, 3, 4, 5], 'the status issue and the pull request are not issues to count');
  assert.deepEqual([...out.analysed], [3]);
  assert.deepEqual(ctx.calls.list.filter((p) => /\/comments$/.test(p)), ['repos/o/r/issues/2/comments', 'repos/o/r/issues/3/comments'], 'comments only for issues the labels cannot place');
  assert.deepEqual(ctx.calls.list.filter((p) => /\/events$/.test(p)), ['repos/o/r/issues/1/events', 'repos/o/r/issues/4/events'], 'events only where a wait is timed');
  assert.match(ctx.calls.list.find((p) => p.includes('/issues/comments?since=')), new RegExp(`since=${encodeURIComponent(new Date(NOW - 14 * D).toISOString())}`));
  assert.equal(out.comments[0].issueNumber, 1);
  assert.deepEqual(out.pin, PIN.version ? { source: 'o/concierge', version: 'v1.8.0', channel: 'stable' } : null);
  assert.equal(out.latest, 'v1.8.0');
  assert.deepEqual(out.token, { state: 'ok', expiresAt: null });
});

test('collect looks back as far as the longest thing the page shows', () => {
  const ctx = fakeCtx({ issues: [] });
  collect(ctx, REPO, { ...SETTINGS, 'reporter-replies-days': 3 }, 't');
  assert.match(ctx.calls.list.find((p) => p.includes('/issues/comments?since=')), new RegExp(`since=${encodeURIComponent(new Date(NOW - 7 * D).toISOString())}`), 'seven days for the spend');
  const ctx2 = fakeCtx({ issues: [] });
  collect(ctx2, REPO, { ...SETTINGS, 'reporter-replies-days': 60 }, 't');
  assert.match(ctx2.calls.list.find((p) => p.includes('/issues/comments?since=')), new RegExp(`since=${encodeURIComponent(new Date(NOW - 60 * D).toISOString())}`));
});

test('collect gives up, rather than write a page from nothing, when the issues cannot be listed', () => {
  const ctx = fakeCtx();
  ctx.list = () => null;
  assert.equal(collect(ctx, REPO, SETTINGS, 't'), null);
});

test('findStatusIssue picks the bot\'s issue with the marker, open or closed, and no other', () => {
  const marker = issue(7, [], { body: `${MARKER}\nbody`, state: 'closed' });
  const ctx = fakeCtx({ botIssues: [issue(3, [], { body: 'an [aw] failure' }), issue(4, [], { body: MARKER, pull_request: {} }), marker] });
  assert.equal(findStatusIssue(ctx, REPO).number, 7);
  assert.equal(findStatusIssue(fakeCtx({ botIssues: [issue(3, [])] }), REPO), null);
});

test('the page and its mentions carry the product\'s name, and the older lines and title are what an earlier version wrote', () => {
  assert.deepEqual([TITLE, MARKER, MENTION_MARKER], ['Issue Concierge status', '<!-- issue-concierge:status -->', '<!-- issue-concierge:mention -->']);
  assert.deepEqual([LEGACY_TITLE, LEGACY_MARKER, LEGACY_MENTION_MARKER], ['Concierge status', '<!-- concierge:status -->', '<!-- concierge:mention -->']);
  assert.equal(hasStatusMarker(`${MARKER}\nx`), true);
  assert.equal(hasStatusMarker(`${LEGACY_MARKER}\nx`), true);
  assert.equal(hasStatusMarker('x'), false);
  assert.equal(hasStatusMarker(undefined), false);
});

test('findStatusIssue finds the page by either marker, and by either title when the marker is gone; it never takes another issue of the bot', () => {
  for (const marker of [MARKER, LEGACY_MARKER]) {
    assert.equal(findStatusIssue(fakeCtx({ botIssues: [issue(3, [], { body: 'an [aw] failure' }), issue(9, [], { body: `${marker}\nbody` })] }), REPO).number, 9, marker);
  }
  for (const title of [TITLE, LEGACY_TITLE]) {
    assert.equal(findStatusIssue(fakeCtx({ botIssues: [issue(3, [], { body: 'an [aw] failure' }), issue(8, [], { title, body: 'no marker any more' })] }), REPO).number, 8, title);
  }
  const both = fakeCtx({ botIssues: [issue(8, [], { title: LEGACY_TITLE, body: 'no marker' }), issue(9, [], { title: 'Whatever', body: `${LEGACY_MARKER}\nbody` })] });
  assert.equal(findStatusIssue(both, REPO).number, 9, 'the marker wins over a title');
  assert.equal(findStatusIssue(fakeCtx({ botIssues: [issue(3, [], { title: 'Concierge status of something else' })] }), REPO), null, 'a title that only resembles one is not the page');
  assert.equal(findStatusIssue(fakeCtx({ botIssues: [issue(4, [], { title: TITLE, pull_request: {} })] }), REPO), null, 'a pull request is not the page');
});

test('collect does not count the page as an issue, whichever marker it carries', () => {
  for (const marker of [MARKER, LEGACY_MARKER]) {
    const ctx = fakeCtx({
      issues: [issue(1, ['needs-decision']), issue(50, [], { body: `${marker}\n# page`, user: { login: 'github-actions[bot]', type: 'Bot' } })],
      comments: [],
      files: { '.github/concierge.yml': 'source: o/concierge\nversion: v1.8.0\nchannel: stable\n' },
    });
    assert.deepEqual(collect(ctx, REPO, SETTINGS, 'tok').issues.map((i) => i.number), [1], marker);
  }
});

// ---------------------------------------------------------------- reconcile

const build = (note) => `${MARKER}\n# ${TITLE}\nLast changed 2026-10-27 12:00 UTC · [x](y)\nbody${note ? `\n> ⚠ This issue is not pinned: ${note}` : ''}`;

test('reconcile creates the issue with the opt-out label and pins it with the signal token', () => {
  const ctx = fakeCtx();
  const out = reconcile(ctx, REPO, SETTINGS, null, build, 'signal');
  assert.equal(out.action, 'created');
  assert.equal(out.pinned, true);
  assert.deepEqual(ctx.calls.write, [{ method: 'POST', path: 'repos/o/r/issues', body: { title: TITLE, body: build(null), labels: ['no-auto-processing'] } }]);
  assert.deepEqual(ctx.calls.graphql.map((g) => [g.kind, g.vars.id, g.token]), [['isPinned', 'N99', 'signal'], ['pin', 'N99', 'signal']]);
});

test('reconcile writes nothing when the page has not changed, only the time', () => {
  const existing = issue(7, [], { body: build(null).replace('12:00', '11:00') });
  const ctx = fakeCtx({ pinned: true });
  const out = reconcile(ctx, REPO, SETTINGS, existing, build, 'signal');
  assert.equal(out.action, 'unchanged');
  assert.deepEqual(ctx.calls.write, []);
  assert.deepEqual(ctx.calls.graphql.map((g) => g.kind), ['isPinned'], 'it is pinned already');
});

test('reconcile edits the body when it changed, and reopens a closed status issue', () => {
  const changed = (note) => `${build(note)}\nmore`;
  const ctx = fakeCtx({ pinned: true });
  assert.equal(reconcile(ctx, REPO, SETTINGS, issue(7, [], { body: build(null) }), changed, 's').action, 'updated');
  assert.deepEqual(ctx.calls.write.map((w) => [w.method, w.path, Object.keys(w.body)]), [['PATCH', 'repos/o/r/issues/7', ['body']]]);

  const ctx2 = fakeCtx();
  const out = reconcile(ctx2, REPO, SETTINGS, issue(7, [], { state: 'closed', body: build(null) }), build, 's');
  assert.equal(out.action, 'reopened');
  assert.deepEqual(ctx2.calls.write[0], { method: 'PATCH', path: 'repos/o/r/issues/7', body: { state: 'open' } });
  assert.deepEqual(ctx2.calls.graphql.map((g) => g.kind), ['isPinned', 'pin'], 'and pins it again');
});

test('reconcile renames the page an earlier version opened, in the same edit, and opens no second one', () => {
  const old = issue(7, [], { title: LEGACY_TITLE, body: build(null).replace(MARKER, LEGACY_MARKER).replace(`# ${TITLE}`, `# ${LEGACY_TITLE}`) });
  const ctx = fakeCtx({ pinned: true });
  const out = reconcile(ctx, REPO, SETTINGS, old, build, 's');
  assert.equal(out.action, 'updated');
  assert.equal(out.number, 7);
  assert.deepEqual(ctx.calls.write.map((w) => [w.method, w.path, Object.keys(w.body).sort()]), [['PATCH', 'repos/o/r/issues/7', ['body', 'title']]], 'one edit, no POST');
  assert.equal(ctx.calls.write[0].body.title, TITLE);
  assert.ok(ctx.calls.write[0].body.body.startsWith(MARKER), 'the body carries the new marker from then on');

  // the same page, already current: nothing to write
  const current = fakeCtx({ pinned: true });
  assert.equal(reconcile(current, REPO, SETTINGS, issue(7, [], { title: TITLE, body: build(null) }), build, 's').action, 'unchanged');
  assert.deepEqual(current.calls.write, []);
});

test('reconcile leaves a title a maintainer chose alone', () => {
  const ctx = fakeCtx({ pinned: true });
  reconcile(ctx, REPO, SETTINGS, issue(7, [], { title: 'Our robot', body: `${build(null)}\nmore` }), build, 's');
  assert.deepEqual(ctx.calls.write.map((w) => Object.keys(w.body)), [['body']]);
});

test('reconcile says so on the page when the issue cannot be pinned, and takes the note away once it can', () => {
  const ctx = fakeCtx({ pinFails: 'Maximum number of pinned issues reached' });
  const out = reconcile(ctx, REPO, SETTINGS, null, build, 's');
  assert.equal(out.pinned, false);
  assert.equal(out.action, 'created');
  assert.deepEqual(ctx.calls.write.map((w) => w.method), ['POST', 'PATCH']);
  assert.match(ctx.calls.write[1].body.body, /> ⚠ This issue is not pinned: Maximum number of pinned issues reached/);

  const withNote = issue(7, [], { body: build('Maximum number of pinned issues reached') });
  const ctx2 = fakeCtx();
  const out2 = reconcile(ctx2, REPO, SETTINGS, withNote, build, 's');
  assert.equal(out2.pinned, true);
  assert.equal(out2.action, 'updated');
  assert.ok(!ctx2.calls.write[0].body.body.includes('not pinned'));
});

test('with status-issue false the issue is unpinned and closed as not planned, never deleted, and nothing is created', () => {
  const off = { ...SETTINGS, 'status-issue': false };
  const ctx = fakeCtx({ pinned: true });
  const out = reconcile(ctx, REPO, off, issue(7, [], { body: build(null) }), build, 's');
  assert.equal(out.action, 'closed');
  assert.deepEqual(ctx.calls.graphql.map((g) => g.kind), ['unpin']);
  assert.deepEqual(ctx.calls.write, [{ method: 'PATCH', path: 'repos/o/r/issues/7', body: { state: 'closed', state_reason: 'not_planned' } }]);

  const none = fakeCtx();
  assert.equal(reconcile(none, REPO, off, null, build, 's').action, 'off');
  assert.deepEqual(none.calls.write, []);
  const closed = fakeCtx();
  assert.equal(reconcile(closed, REPO, off, issue(7, [], { state: 'closed' }), build, 's').action, 'off');
  assert.deepEqual(closed.calls.write, []);
});

// ---------------------------------------------------------------- main

function run(ctx, env = {}) {
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let code;
  try {
    code = main({ GITHUB_REPOSITORY: REPO, SIGNAL_TOKEN: 'signal', ...env }, ctx);
  } finally {
    console.log = log;
  }
  return { code, lines };
}

test('main: a dry run prints the page and writes nothing', () => {
  const ctx = fakeCtx({ issues: [issue(1, ['needs-decision'])], events: { 1: labelled('needs-decision', ago(D)) } });
  const { code, lines } = run(ctx, { DRY_RUN: 'true' });
  assert.equal(code, 0);
  assert.ok(lines.some((l) => l.includes('- #1 Issue 1 · waiting 24 h')));
  assert.ok(lines.includes('dry run: nothing was written'));
  assert.deepEqual(ctx.calls.write, []);
  assert.deepEqual(ctx.calls.graphql, []);
});

test('main: settings.yml is read, a bad line is a warning and the default stays', () => {
  const ctx = fakeCtx({ files: { '.github/issue-concierge/settings.yml': 'reporter-replies-days: 200\n' } });
  const { code, lines } = run(ctx, { DRY_RUN: 'true' });
  assert.equal(code, 0);
  assert.ok(lines.some((l) => l.startsWith('::warning::settings.yml line 1: reporter-replies-days must be from 1 to 90')));
  assert.ok(lines.some((l) => l.includes('`reporter-replies-days`: 14')));
});

test('main: settings.yml is read from the old folder in a repository that has not been updated yet, and the new folder wins when both have it', () => {
  const OLD = '.github/agentic-workflows/settings.yml';
  const NEW = '.github/issue-concierge/settings.yml';
  const old = run(fakeCtx({ files: { [OLD]: 'reporter-replies-days: 200\n' } }), { DRY_RUN: 'true' });
  assert.ok(old.lines.some((l) => l.startsWith('::warning::settings.yml line 1: reporter-replies-days must be from 1 to 90')), 'a bad line in the old file is reported');
  const both = run(fakeCtx({ files: { [OLD]: 'reporter-replies-days: 30\n', [NEW]: 'reporter-replies-days: 7\n' } }), { DRY_RUN: 'true' });
  assert.ok(both.lines.some((l) => l.includes('`reporter-replies-days`: 7')), 'the new file wins');
  assert.ok(!both.lines.some((l) => l.includes('`reporter-replies-days`: 30')));
  const off = fakeCtx({ botIssues: [issue(7, [], { body: MARKER })], files: { [OLD]: 'status-issue: false\n' }, pinned: true });
  assert.ok(run(off).lines.some((l) => l.includes('the status issue was closed and unpinned')), 'status-issue: false in the old folder is honoured');
});

test('main: a repository that turned the status issue off is left with it closed, and nothing is collected', () => {
  const ctx = fakeCtx({ botIssues: [issue(7, [], { body: MARKER })], files: { '.github/issue-concierge/settings.yml': 'status-issue: false\n' }, pinned: true });
  const { code, lines } = run(ctx);
  assert.equal(code, 0);
  assert.ok(lines.some((l) => l.includes('the status issue was closed and unpinned')));
  assert.ok(!ctx.calls.list.some((p) => p === 'repos/o/r/issues?state=open'), 'no issue is listed');
});

test('main: when the issues cannot be listed it fails and leaves the page as it is', () => {
  const ctx = fakeCtx();
  const list = ctx.list;
  ctx.list = (p) => (p === 'repos/o/r/issues?state=open' ? null : list(p));
  const { code, lines } = run(ctx);
  assert.equal(code, 1);
  assert.ok(lines.some((l) => l.startsWith('::error::')));
  assert.deepEqual(ctx.calls.write, []);
});

// ---------------------------------------------------------------- the source

test('the signal token is for pinning and for probing, never for writing the page', () => {
  const source = fs.readFileSync(path.join(HERE, 'status-issue.mjs'), 'utf8');
  assert.ok(!/ctx\.write\([^)]*(signalToken|SIGNAL_TOKEN)/.test(source), 'writes use the workflow token, so the bot is the author');
  assert.equal([...source.matchAll(/ctx\.graphql\([^)]*signalToken/g)].length, 3, 'is-pinned, pin and unpin, each with it');
  assert.match(source, /ctx\.probe\(signalToken\)/);
});

test('a page of a hundred workflow runs fits the buffer of the gh calls', () => {
  const source = fs.readFileSync(path.join(HERE, 'status-issue.mjs'), 'utf8');
  assert.match(source, /const MAX_BUFFER = 64 \* 1024 \* 1024;/);
  assert.equal([...source.matchAll(/maxBuffer: MAX_BUFFER/g)].length, 2, 'the reads and the writes');
});

// ---------------------------------------------------------------- the nudge

const waiting = (days, labels = ['needs-decision']) => {
  const f = raw({ issues: [issue(1, labels, { title: 'Remove the widgets command' }), issue(2, labels, { title: 'Newer request' })], events: new Map([[1, labelled(labels[0], ago(days * D))], [2, labelled(labels[0], ago(1 * D))]]) });
  return summarize(f, SETTINGS, NOW);
};

test('overdue: what waits for a maintainer at least that many days, oldest first, and nothing for 0', () => {
  const m = waiting(5);
  assert.deepEqual(overdue(m, 5).map((i) => i.number), [1], 'exactly the period counts');
  assert.deepEqual(overdue(m, 1).map((i) => i.number), [1, 2]);
  assert.deepEqual(overdue(m, 6), []);
  assert.deepEqual(overdue(m, 0), []);
  assert.equal(overdue(m, 5)[0].queue, 'Held: changes what exists');
});

test('overdue: only what waits for a maintainer, not what waits for the reporter, a dependency or nobody', () => {
  for (const label of ['needs-info', 'backlog', 'dependency-required']) assert.deepEqual(overdue(waiting(30, [label]), 1), [], label);
  assert.deepEqual(overdue(waiting(30, ['scope-review']), 7).map((i) => i.number), [1]);
  assert.deepEqual(overdue(waiting(30, ['plan-approval-required']), 7).map((i) => i.number), [1]);
});

test('maintainersOf: users with the maintain or admin role, once each, by name, at most twenty', () => {
  const c = (login, role_name, type = 'User') => ({ login, role_name, type });
  assert.deepEqual(maintainersOf([c('zed', 'admin'), c('amy', 'maintain'), c('amy', 'maintain'), c('bo', 'write'), c('cy', 'triage'), c('di', 'read'), c('bot', 'admin', 'Bot')]), ['amy', 'zed']);
  assert.deepEqual(maintainersOf([c('has space', 'admin'), c('@x', 'admin'), c('', 'admin'), c('a'.repeat(40), 'admin')]), [], 'a login must look like one');
  assert.equal(maintainersOf(Array.from({ length: 30 }, (_, i) => c(`user${String(i).padStart(2, '0')}`, 'admin'))).length, MENTION_CAP);
  assert.deepEqual(maintainersOf(null), []);
});

test('renderMention: the logins are the only mentions, the titles mention nobody, and a long list is cut', () => {
  const items = Array.from({ length: 13 }, (_, i) => ({ number: i + 1, title: i === 0 ? 'Ping @everyone about #99 <b>x</b>' : `Item ${i + 1}`, since: NOW - (20 - i) * D, queue: 'Held: changes what exists' }));
  const body = renderMention(['amy', 'zed'], items, 7, NOW);
  assert.equal(body.split('\n')[0], MENTION_MARKER);
  assert.equal(body.split('\n')[1], '@amy @zed');
  assert.equal((body.match(/@/g) || []).length, 2, 'two logins and no other @');
  assert.ok(!/(?<!&)#99|<b>/.test(body));
  assert.match(body, /13 issues have waited for a maintainer for 7 days or more:/);
  assert.match(body, /- #1 Ping &#64;everyone about &#35;99 &#60;b&#62;x&#60;\/b&#62; · held: changes what exists · waiting 20 d/);
  assert.equal(body.split('\n').filter((l) => l.startsWith('- #')).length, 10);
  assert.match(body, /- and 3 more, listed on this page/);
  assert.match(body, /set `mention-after-days: 0` in `\.github\/issue-concierge\/settings\.yml`/);
  assert.match(renderMention(['amy'], items.slice(0, 1), 1, NOW), /^1 issue has waited for a maintainer for 1 day or more:/m);
});

test('planMention: one comment per period, the old one goes with the new one or when nothing waits, nobody to mention means silence', () => {
  const some = [{ number: 1 }];
  const previous = (daysAgo) => ({ id: 77, created_at: ago(daysAgo * D) });
  const plan = (over) => planMention({ previous: null, items: some, logins: ['amy'], days: 7, now: NOW, ...over });
  assert.deepEqual(plan({}), { post: true, remove: null, reason: '1 item waited 7 days or more' });
  assert.deepEqual(plan({ previous: previous(8) }), { post: true, remove: 77, reason: '1 item waited 7 days or more' });
  assert.deepEqual(plan({ previous: previous(2) }), { post: false, remove: null, reason: 'the last mention is newer than the period' });
  assert.deepEqual(plan({ items: [], previous: previous(2) }), { post: false, remove: 77, reason: 'nothing has waited that long' });
  assert.deepEqual(plan({ items: [] }), { post: false, remove: null, reason: 'nothing has waited that long' });
  assert.deepEqual(plan({ logins: [], previous: previous(9) }), { post: false, remove: null, reason: 'nobody to mention: the collaborators could not be listed' });
  assert.equal(plan({ previous: previous(7) }).post, true, 'exactly the period is enough');
});

const NUDGE = { ...SETTINGS, 'mention-after-days': 7 };
const ctxWith = (over = {}) => fakeCtx({ issueComments: { 99: [] }, ...over });
const botComment = (id, daysAgo, body = `${MENTION_MARKER}\n@amy\n\nold`) => ({ id, user: { login: 'github-actions[bot]' }, body, created_at: ago(daysAgo * D) });
const written = (c, method) => c.calls.write.filter((w) => w.method === method);

test('nudge: something waited a week, so the maintainers are mentioned once on the status issue', () => {
  const ctx = ctxWith();
  const log = nudge(ctx, REPO, 99, waiting(9), NUDGE, 'signal');
  assert.match(log, /^mention: mentioned 2 people about 1 issue$/);
  const [post] = written(ctx, 'POST');
  assert.equal(post.path, 'repos/o/r/issues/99/comments');
  assert.match(post.body.body, /^<!-- issue-concierge:mention -->\n@alice @bob\n/);
  assert.deepEqual(ctx.calls.collaboratorTokens, ['workflow'], 'the workflow token was enough');
});

test('nudge: when the workflow token may not list the collaborators the signal token is tried, and when neither may nobody is mentioned', () => {
  const second = ctxWith({ collaboratorsFail: ['workflow'] });
  assert.match(nudge(second, REPO, 99, waiting(9), NUDGE, 'signal'), /^mention: mentioned 2 people/);
  assert.deepEqual(second.calls.collaboratorTokens, ['workflow', 'signal']);
  const none = ctxWith({ collaboratorsFail: ['workflow', 'signal'] });
  assert.equal(nudge(none, REPO, 99, waiting(9), NUDGE, 'signal'), 'mention: nobody to mention: the collaborators could not be listed');
  assert.deepEqual(written(none, 'POST'), []);
  const noToken = ctxWith({ collaboratorsFail: ['workflow'] });
  assert.match(nudge(noToken, REPO, 99, waiting(9), NUDGE, ''), /nobody to mention/);
  assert.deepEqual(noToken.calls.collaboratorTokens, ['workflow'], 'no token to fall back to');
});

test('nudge: a mention newer than the period is the only one, an older one is replaced, and none is left when nothing waits', () => {
  const recent = ctxWith({ issueComments: { 99: [botComment(5, 2)] } });
  assert.match(nudge(recent, REPO, 99, waiting(9), NUDGE, 's'), /the last mention is newer than the period/);
  assert.deepEqual(recent.calls.write, []);

  const old = ctxWith({ issueComments: { 99: [botComment(5, 9)] } });
  nudge(old, REPO, 99, waiting(9), NUDGE, 's');
  assert.deepEqual(old.calls.write.map((w) => [w.method, w.path]), [['DELETE', 'repos/o/r/issues/comments/5'], ['POST', 'repos/o/r/issues/99/comments']]);

  const settled = ctxWith({ issueComments: { 99: [botComment(5, 2)] } });
  assert.equal(nudge(settled, REPO, 99, waiting(3), NUDGE, 's'), 'mention: nothing has waited that long');
  assert.deepEqual(settled.calls.write.map((w) => [w.method, w.path]), [['DELETE', 'repos/o/r/issues/comments/5']]);
  assert.equal(settled.calls.collaboratorTokens, undefined, 'nobody is looked up when nothing waits');
});

test('nudge: a mention an earlier version wrote is the previous one, and the new mention carries the new line', () => {
  const legacy = (id, daysAgo) => botComment(id, daysAgo, `${LEGACY_MENTION_MARKER}\n@amy\n\nold`);
  const recent = ctxWith({ issueComments: { 99: [legacy(5, 2)] } });
  assert.match(nudge(recent, REPO, 99, waiting(9), NUDGE, 's'), /the last mention is newer than the period/, 'an older line counts, so nobody is mentioned twice');
  assert.deepEqual(recent.calls.write, []);
  const old = ctxWith({ issueComments: { 99: [legacy(5, 9)] } });
  nudge(old, REPO, 99, waiting(9), NUDGE, 's');
  assert.deepEqual(old.calls.write.map((w) => [w.method, w.path]), [['DELETE', 'repos/o/r/issues/comments/5'], ['POST', 'repos/o/r/issues/99/comments']]);
  assert.ok(written(old, 'POST')[0].body.body.startsWith(`${MENTION_MARKER}\n`));
  assert.ok(!written(old, 'POST')[0].body.body.includes(LEGACY_MENTION_MARKER), 'the older line is never written');
  const person = { id: 8, user: { login: 'a-person' }, body: `${LEGACY_MENTION_MARKER}\ntyped by hand`, created_at: ago(30 * D) };
  const typed = ctxWith({ issueComments: { 99: [person] } });
  nudge(typed, REPO, 99, waiting(9), NUDGE, 's');
  assert.deepEqual(written(typed, 'DELETE'), [], 'the older line in a person\'s comment is only words');
});

test('nudge: only the bot\'s own mention comment is the previous one, and duplicates are cleaned up', () => {
  const person = { id: 8, user: { login: 'a-person' }, body: `${MENTION_MARKER}\ntyped by hand`, created_at: ago(30 * D) };
  const ctx = ctxWith({ issueComments: { 99: [person, botComment(5, 20), botComment(6, 10)] } });
  nudge(ctx, REPO, 99, waiting(9), NUDGE, 's');
  assert.deepEqual(written(ctx, 'DELETE').map((w) => w.path), ['repos/o/r/issues/comments/5', 'repos/o/r/issues/comments/6']);
  assert.equal(written(ctx, 'POST').length, 1);
});

const mainEnv = { DRY_RUN: undefined };
const overdueIssues = { issues: [issue(1, ['needs-decision'], { title: 'Remove the widgets command' })], events: { 1: labelled('needs-decision', ago(9 * D)) } };

test('main: with mention-after-days set, an issue that has waited that long is mentioned on the status issue', () => {
  const ctx = ctxWith({ ...overdueIssues, files: { '.github/issue-concierge/settings.yml': 'mention-after-days: 7\n' } });
  const { lines } = run(ctx);
  assert.ok(lines.includes('mention: mentioned 2 people about 1 issue'));
  assert.equal(written(ctx, 'POST').filter((w) => w.path.endsWith('/comments')).length, 1);
});

test('main: nothing is mentioned when the setting is 0, in a dry run, while paused, or with the status issue off', () => {
  const comments = (ctx) => ctx.calls.list.filter((p) => /issues\/99\/comments$/.test(p) || p === 'repos/o/r/collaborators');
  const settings = (text) => ({ ...overdueIssues, files: { '.github/issue-concierge/settings.yml': text } });
  const off = ctxWith(settings('mention-after-days: 0\n'));
  run(off);
  assert.deepEqual(comments(off), [], 'the default asks nothing of GitHub');
  const dry = ctxWith(settings('mention-after-days: 7\n'));
  run(dry, { DRY_RUN: 'true' });
  assert.deepEqual(written(dry, 'POST'), []);
  const paused = ctxWith(settings('mention-after-days: 7\n'));
  const { lines } = run(paused, { ISSUE_CONCIERGE_PAUSED: 'true' });
  assert.ok(!lines.some((l) => l.startsWith('mention:')));
  assert.deepEqual(comments(paused), []);
  const pausedOld = ctxWith(settings('mention-after-days: 7\n'));
  run(pausedOld, { CONCIERGE_PAUSED: 'true' });
  assert.deepEqual(comments(pausedOld), [], 'the older name pauses the nudge too');
  const noPage = ctxWith({ ...settings('status-issue: false\nmention-after-days: 7\n'), botIssues: [] });
  run(noPage);
  assert.deepEqual(comments(noPage), []);
});

test('the mention is a comment of the status page and nothing else: the signal token only lists, and no mention is made by a model', () => {
  const source = fs.readFileSync(path.join(HERE, 'status-issue.mjs'), 'utf8');
  assert.ok(!/ctx\.write\([^\n]*(signalToken|SIGNAL_TOKEN)/.test(source), 'the comment is written with the workflow token');
  assert.match(source, /ctx\.list\(`repos\/\$\{repo\}\/collaborators`, \{ token: signalToken \}\)/);
  assert.match(source, /if \(settings\['mention-after-days'\] > 0 && result\.number && !raw\.paused\) \{/);
});
