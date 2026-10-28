import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCEPT_MARKER, STOP_LABELS, effectiveNeed, main, mayUse, menuCandidates, menuKind, neutralizeMentions, optionsFor, parseCommand, planMenu, planReason,
  runCommand, situationOf, syncOptions,
} from './commands.mjs';
import { OPTIONS_MARKER, isOptionsComment } from './issue-concierge-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse('2026-10-27T12:00:00Z');
const REPO = 'o/r';
const BOT = { login: 'github-actions[bot]', type: 'Bot' };
const iso = (ms) => new Date(NOW - ms).toISOString();
const H = 3600000;

const issue = (labels = [], extra = {}) => ({ number: 7, state: 'open', labels: labels.map((name) => ({ name })), user: { login: 'reporter', type: 'User' }, assignees: [], ...extra });
const comment = (id, body, user = { login: 'reporter', type: 'User' }, ageMs = (100 - id) * 1000) => ({ id, body, user, created_at: iso(ageMs) });
const plan = (id, extra = '') => comment(id, `## Plan\n\n**Size:** small\n${extra}\n\n<!-- gh-aw-workflow-call-id: ${REPO}/plan-worker -->`, BOT);
const SETTINGS = { commands: { on: true, need: 'triage' } };
const classifiedHold = ['plan-approval-required', 'complexity/low', 'risk/high'];

// ---------------------------------------------------------------- reading a command

test('parseCommand: the first non-empty line, the command and its reason, in any case', () => {
  assert.deepEqual(parseCommand('/accept'), { name: 'accept', argument: '' });
  assert.deepEqual(parseCommand('/DECLINE  not now, sorry '), { name: 'decline', argument: 'not now, sorry' });
  assert.deepEqual(parseCommand('\n\n/approve\nlooks good to me'), { name: 'approve', argument: '' });
  assert.deepEqual(parseCommand('/replan  use the library function\r\nthanks'), { name: 'replan', argument: 'use the library function' });
  assert.equal(parseCommand(`/decline ${'x'.repeat(500)}`).argument.length, 300);
  for (const name of ['accept', 'decline', 'approve', 'replan', 'retry', 'help']) assert.equal(parseCommand(`/${name}`).name, name);
});

test('parseCommand: a command in a quote, a code block, a sentence or a path does nothing', () => {
  for (const body of ['> /accept', 'please /accept this', '```\n/accept\n```', 'I think /approve is wrong', '//accept', ' x /accept', '/acceptable', '/accepted', '/unknown', '/', '', undefined, 'thanks!\n/accept']) {
    assert.equal(parseCommand(body), null, String(body));
  }
});

// ---------------------------------------------------------------- roles

test('effectiveNeed and mayUse: triage is enough in an organisation, write is the floor in a personal repository', () => {
  assert.equal(effectiveNeed('triage', true), 'triage');
  assert.equal(effectiveNeed('triage', false), 'write');
  assert.equal(effectiveNeed('admin', false), 'admin');
  assert.equal(effectiveNeed('maintain', false), 'maintain');
  const org = (role, need) => mayUse(role, need, { organisation: true });
  assert.deepEqual(['read', 'triage', 'write', 'maintain', 'admin'].map((r) => org(r, 'triage')), [false, true, true, true, true]);
  assert.deepEqual(['read', 'triage', 'write', 'maintain', 'admin'].map((r) => org(r, 'maintain')), [false, false, false, true, true]);
  assert.deepEqual(['triage', 'write'].map((r) => mayUse(r, 'triage', { organisation: false })), [false, true]);
  for (const role of ['none', '', null, undefined, 'owner-of-nothing']) assert.equal(mayUse(role, 'triage'), false, String(role));
  assert.equal(mayUse('ADMIN', 'write'), true, 'case does not matter');
});

test('neutralizeMentions turns a mention into code, so the bot\'s comment notifies nobody', () => {
  assert.equal(neutralizeMentions('thanks @octocat and @team-a/b'), 'thanks `@octocat` and `@team-a`/b');
  assert.equal(neutralizeMentions('see #12'), 'see #12');
  assert.equal(neutralizeMentions(undefined), '');
});

// ---------------------------------------------------------------- what waits for a maintainer

test('situationOf: what the issue waits for, from its labels', () => {
  assert.equal(situationOf(issue(['needs-decision', 'plan-approval-required', 'complexity/low', 'risk/low'])), 'decision');
  assert.equal(situationOf(issue(['scope-review'])), 'scope');
  assert.equal(situationOf(issue(['scope-review', 'needs-decision'])), 'decision', 'a decision comes before a doubt about the scope');
  assert.equal(situationOf(issue(['scope-review', ...classifiedHold])), 'scope');
  assert.equal(situationOf(issue(classifiedHold)), 'plan');
  assert.equal(situationOf(issue(['backlog', 'needs-info', 'dependency-required'])), null, 'parked and waiting for others needs no command');
  assert.equal(situationOf(issue([])), null);
});

test('situationOf: a hold nobody has classified yet has no plan to approve, so no menu', () => {
  assert.equal(situationOf(issue(['plan-approval-required'])), null);
  assert.equal(situationOf(issue(['plan-approval-required', 'complexity/low'])), null);
});

test('situationOf: a gate label is stalled after an hour, not before', () => {
  const ev = (ageMs) => [{ event: 'labeled', label: { name: 'plan-worker-ready' }, created_at: iso(ageMs) }];
  assert.equal(situationOf(issue(['plan-worker-ready']), { events: ev(2 * H), now: NOW }), 'stalled');
  assert.equal(situationOf(issue(['plan-worker-ready']), { events: ev(30 * 60000), now: NOW }), null);
  assert.equal(situationOf(issue(['plan-worker-ready']), { events: [], now: NOW }), null);
});

test('situationOf: nothing waits for a maintainer on a closed issue, a pull request, a bot\'s issue or an opted-out one', () => {
  for (const extra of [{ state: 'closed' }, { pull_request: {} }, { user: BOT }]) assert.equal(situationOf(issue(['needs-decision'], extra)), null);
  assert.equal(situationOf(issue(['needs-decision', 'no-auto-processing'])), null);
});

test('planReason reads the lines plan triage reads, from the latest plan only', () => {
  const reason = (extra) => planReason([plan(1, extra)], REPO);
  assert.equal(reason(''), 'plain');
  assert.equal(reason('Wrong layer: the fix belongs in o/lib, see src/a.js'), 'wrong-layer');
  assert.equal(reason('Work item: o/r | x | where: y | order: this\nWork item: o/lib | x | where: y | order: first'), 'work-item');
  assert.equal(reason('### Decisions that apply\n- Conflicts with https://x/0003.md: needs a decision'), 'conflict');
  assert.equal(reason('Breaking change: removes `listWidgets` (src/widgets.js)'), 'breaking');
  assert.equal(planReason([plan(1, 'Wrong layer: x'), plan(2, '')], REPO), 'plain', 'the latest plan wins');
  assert.equal(planReason([comment(1, `Wrong layer: nope\n<!-- gh-aw-workflow-call-id: ${REPO}/plan-worker -->`, { login: 'a-person' })], REPO), 'plain', 'a person can type the text and the marker');
  assert.equal(planReason([], REPO), 'plain');
});

// ---------------------------------------------------------------- the options comment

test('optionsFor: nothing when nobody has to act', () => {
  assert.equal(optionsFor(issue([]), { settings: SETTINGS, repo: REPO }), null);
  assert.equal(optionsFor(issue(['backlog']), { settings: SETTINGS, repo: REPO }), null);
});

test('optionsFor: what is needed in plain words, then the commands for this situation, in a collapsed block', () => {
  const o = (labels, comments = []) => optionsFor(issue(labels), { comments, settings: SETTINGS, repo: REPO, now: NOW });
  const decision = o(['needs-decision']);
  assert.equal(decision.kind, 'decision');
  assert.equal(decision.body.split('\n')[0], '<!-- concierge:options kind=decision -->');
  assert.match(decision.body, /\nThis request changes something that already exists, so a maintainer needs to decide on it before anything is planned\.\n/);
  assert.match(decision.body, /<details><summary>Maintainer options<\/summary>/);
  assert.match(decision.body, /\| `\/accept` \| Plan it: removes `needs-decision` and hands the issue to the plan worker\. \|/);
  assert.match(decision.body, /\| `\/decline \[reason\]` \| Close it as not planned: adds `declined` and tells the reporter, with your reason\. \|/);
  assert.doesNotMatch(decision.body, /\/approve|\/retry/);
  assert.match(o(['scope-review']).body, /removes `scope-review`/);
  const held = o(classifiedHold, [plan(1)]);
  assert.equal(held.kind, 'plan.plain');
  assert.deepEqual([...held.body.matchAll(/^\| `(\/[a-z]+)/gm)].map((m) => m[1]), ['/approve', '/replan', '/decline']);
});

test('optionsFor: the sentence a reporter reads has no label, no command and no workflow in it', () => {
  for (const labels of [['needs-decision'], ['scope-review'], classifiedHold]) {
    const visible = optionsFor(issue(labels), { comments: [plan(1)], settings: SETTINGS, repo: REPO, now: NOW }).body.split('<details>')[0];
    assert.doesNotMatch(visible.split('\n').slice(1).join('\n'), /`|label|\/|workflow|gate/i, visible);
  }
});

test('optionsFor: a plan held for another reason says so, and adds what the maintainer can do about it', () => {
  const o = (extra) => optionsFor(issue(classifiedHold), { comments: [plan(1, extra)], settings: SETTINGS, repo: REPO, now: NOW });
  assert.equal(o('Work item: o/lib | x | where: y | order: first').kind, 'plan.work-item');
  assert.match(o('Work item: o/lib | x | where: y | order: first').body, /run \*\*Spawn Work Items\*\* from the Actions tab/);
  assert.match(o('Wrong layer: o/lib').body, /The plan found that the fix belongs in another repository/);
  assert.match(o('- Conflicts with https://x/0003.md: y').body, /conflicts with a decision the project has taken/);
  assert.match(o('Breaking change: removes x').body, /The plan found a change to something that already exists/);
});

test('optionsFor: a stalled gate offers only a retry', () => {
  const events = [{ event: 'labeled', label: { name: 'issue-triage-handoff' }, created_at: iso(3 * H) }];
  const o = optionsFor(issue(['issue-triage-handoff']), { events, settings: SETTINGS, repo: REPO, now: NOW });
  assert.equal(o.kind, 'stalled');
  assert.deepEqual([...o.body.matchAll(/^\| `(\/[a-z]+)/gm)].map((m) => m[1]), ['/retry']);
});

test('optionsFor: it names the role the commands need, and says when a personal repository raised it', () => {
  const body = (need, organisation) => optionsFor(issue(['needs-decision']), { settings: { commands: { on: true, need } }, repo: REPO, organisation }).body;
  assert.match(body('triage', true), /needs the \*\*triage\*\* role or higher\. The same can be done by hand with the labels\./);
  assert.match(body('admin', true), /\*\*admin\*\* role/);
  assert.match(body('triage', false), /\*\*write\*\* role or higher \(this is a personal repository\)/);
  assert.match(body('write', false), /\*\*write\*\* role or higher\. The same/);
});

// ---------------------------------------------------------------- keeping it last

const menu = (id, kind = 'decision', body = `${OPTIONS_MARKER} kind=${kind} -->\nwords`, ageMs) => comment(id, body, BOT, ageMs);
const want = (kind = 'decision', body = `${OPTIONS_MARKER} kind=${kind} -->\nwords`) => ({ kind, body });

test('planMenu: nothing is wanted, so every options comment goes', () => {
  assert.deepEqual(planMenu({ desired: null, comments: [comment(1, 'hi'), menu(2), menu(3)] }), [{ op: 'delete', id: 2 }, { op: 'delete', id: 3 }]);
  assert.deepEqual(planMenu({ desired: null, comments: [comment(1, 'hi')] }), []);
});

test('planMenu: there is none, so it is posted at the end', () => {
  assert.deepEqual(planMenu({ desired: want(), comments: [comment(1, 'hi')] }), [{ op: 'post', body: want().body }]);
  assert.deepEqual(planMenu({ desired: want(), comments: [] }), [{ op: 'post', body: want().body }]);
});

test('planMenu: it is the last comment and says the same, so nothing is done', () => {
  assert.deepEqual(planMenu({ desired: want(), comments: [comment(1, 'hi'), menu(2)] }), []);
});

test('planMenu: it is the last comment and the words differ, so it is edited in place, without a new notification', () => {
  const desired = want('decision', `${OPTIONS_MARKER} kind=decision -->\nnew words`);
  assert.deepEqual(planMenu({ desired, comments: [comment(1, 'hi'), menu(2)] }), [{ op: 'edit', id: 2, body: desired.body }]);
});

test('planMenu: someone commented after it, so it is deleted and posted again at the end', () => {
  assert.deepEqual(planMenu({ desired: want(), comments: [comment(1, 'hi'), menu(2), comment(3, 'a reply')] }), [{ op: 'delete', id: 2 }, { op: 'post', body: want().body }]);
});

test('planMenu: what is waited for changed, so it is posted again even though it is last', () => {
  assert.deepEqual(planMenu({ desired: want('plan.plain'), comments: [comment(1, 'hi'), menu(2, 'decision')] }), [{ op: 'delete', id: 2 }, { op: 'post', body: want('plan.plain').body }]);
});

test('planMenu: duplicates are removed, the last one kept if it is the last comment', () => {
  assert.deepEqual(planMenu({ desired: want(), comments: [menu(1), comment(2, 'x'), menu(3)] }), [{ op: 'delete', id: 1 }]);
});

test('planMenu: a menu that is last in the list but not in time is not last', () => {
  const comments = [comment(2, 'later', undefined, 500), menu(3, 'decision', undefined, 1000)];
  assert.deepEqual(planMenu({ desired: want(), comments }), [{ op: 'delete', id: 3 }, { op: 'post', body: want().body }]);
});

test('planMenu: the last comment is found by time, not by the order the list came in', () => {
  const comments = [menu(3, 'decision', undefined, 1000), comment(2, 'later', undefined, 500), comment(1, 'earlier', undefined, 9000)];
  assert.deepEqual(planMenu({ desired: want(), comments }), [{ op: 'delete', id: 3 }, { op: 'post', body: want().body }]);
});

test('an options comment is the bot\'s with the marker; a person quoting it is not', () => {
  assert.ok(isOptionsComment(menu(1)));
  assert.ok(!isOptionsComment(comment(1, `${OPTIONS_MARKER} kind=decision -->`, { login: 'a-person' })));
  assert.ok(!isOptionsComment(comment(1, 'hello', BOT)));
  assert.equal(menuKind(menu(1, 'plan.work-item')), 'plan.work-item');
  assert.equal(menuKind(comment(1, 'none')), null);
});

// ---------------------------------------------------------------- a fake GitHub

function fakeApi({ issues = {}, comments = {}, events = {}, roles = {}, open = [], recent = [], files = {}, listFails = false } = {}) {
  const calls = [];
  const reads = [];
  const rec = (...a) => calls.push(a);
  const api = {
    calls,
    reads,
    getIssue: (n) => { reads.push(['getIssue', n]); return issues[n] ?? null; },
    listComments: (n) => { reads.push(['listComments', n]); return comments[n] ?? []; },
    listEvents: (n) => events[n] ?? [],
    listOpenIssues: () => (listFails ? null : open),
    listRecentComments: () => recent,
    role: (login) => (login in roles ? roles[login] : 'none'),
    removeLabel: (n, l) => rec('removeLabel', n, l),
    addLabel: (n, l) => rec('addLabel', n, l),
    addLabelSignal: (n, l) => rec('addLabelSignal', n, l),
    closeSignal: (n) => rec('closeSignal', n),
    reopen: (n) => rec('reopen', n),
    reply: (n, body) => rec('reply', n, body),
    react: (id, content) => rec('react', id, content),
    postComment: (n, body) => rec('postComment', n, body),
    editComment: (id, body) => rec('editComment', id, body),
    deleteComment: (id) => rec('deleteComment', id),
    read: (f) => files[f] ?? null,
  };
  return api;
}
const names = (api) => api.calls.map((c) => c[0]);

// ---------------------------------------------------------------- the commands

const run = (name, i, { argument = '', actor = 'maint' } = {}) => {
  const api = fakeApi();
  const result = runCommand({ name, argument }, { issue: i, actor, api });
  return { result, api };
};

test('every command is refused on an issue that is kept out of the Concierge', () => {
  for (const name of ['accept', 'decline', 'approve', 'replan', 'retry']) {
    const { result, api } = run(name, issue(['no-auto-processing', 'needs-decision', ...classifiedHold]));
    assert.equal(result.ok, false, name);
    assert.match(result.reason, /carries `no-auto-processing`, so the Concierge does not touch it/);
    assert.deepEqual(api.calls, [], name);
  }
});

test('while the Concierge is paused a command that would hand an issue on is refused and changes nothing, and declining and listing still work', () => {
  for (const [name, labels] of [['accept', ['needs-decision']], ['approve', classifiedHold], ['replan', classifiedHold], ['retry', ['plan-worker-ready']]]) {
    const api = fakeApi();
    const result = runCommand({ name, argument: '' }, { issue: issue(labels), actor: 'maint', api, paused: true });
    assert.equal(result.ok, false, name);
    assert.match(result.reason, /The Concierge is paused \(the repository variable `CONCIERGE_PAUSED` is `true`\), so nothing would start\. Resume it first/, name);
    assert.deepEqual(api.calls, [], name);
  }
  for (const name of ['decline', 'help']) {
    const api = fakeApi();
    assert.equal(runCommand({ name, argument: 'no' }, { issue: issue(['needs-decision']), actor: 'maint', api, paused: true }).ok, true, name);
    assert.ok(api.calls.length > 0, name);
  }
});

test('main: the variable reaches the commands through the environment', () => {
  const { env } = eventEnv('issue_comment', commentEvent('/accept'));
  const api = fakeApi({ ...held, roles: { maint: 'admin' } });
  assert.equal(main({ ...env, CONCIERGE_PAUSED: 'true' }, api, () => {}), 0);
  assert.ok(!api.calls.some((c) => c[0] === 'removeLabel' || c[0] === 'addLabelSignal'));
  assert.match(api.calls.find((c) => c[0] === 'reply')[2], /The Concierge is paused/);
  const running = fakeApi({ ...held, roles: { maint: 'admin' } });
  main({ ...env, CONCIERGE_PAUSED: '' }, running, () => {});
  assert.ok(running.calls.some((c) => c[0] === 'removeLabel'));
});

const ACCEPTED = (actor = 'maint') => ['reply', 7, `${ACCEPT_MARKER}\nAccepted by @${actor} with /accept. The request goes to planning now.`];

test('/accept removes what stops the issue with the workflow token, records the decision, and hands it on with the signal token', () => {
  const { result, api } = run('accept', issue(['needs-decision', 'enhancement', 'plan-approval-required']));
  assert.equal(result.ok, true);
  assert.deepEqual(api.calls, [['removeLabel', 7, 'needs-decision'], ACCEPTED(), ['addLabelSignal', 7, 'issue-triage-handoff']]);
});

test('/accept records the decision in a comment of the bot, with a marker, naming the maintainer, before the label that hands the issue on', () => {
  const { api } = run('accept', issue(['needs-decision']), { actor: 'volker' });
  const order = api.calls.map((c) => c[0]);
  assert.ok(order.indexOf('reply') > -1 && order.indexOf('reply') < order.indexOf('addLabelSignal'), 'the record comes first, so nothing the hand-over starts can miss it');
  const body = api.calls.find((c) => c[0] === 'reply')[2];
  assert.equal(ACCEPT_MARKER, '<!-- concierge:accepted -->');
  assert.ok(body.startsWith(`${ACCEPT_MARKER}\n`), 'the marker opens the comment');
  assert.match(body, /Accepted by @volker with \/accept\. The request goes to planning now\.$/);
  assert.doesNotMatch(body, /needs-decision|issue-triage-handoff|plan-approval-required/, 'the reporter reads it: no internal labels');
});

test('a command that is refused records nothing', () => {
  for (const i of [issue(['enhancement']), issue(classifiedHold), issue([], { state: 'closed' })]) {
    assert.equal(run('accept', i).api.calls.some((c) => c[0] === 'reply'), false);
  }
});

test('/accept takes every stop away, reopens a declined issue, records the decision and starts the plan once', () => {
  const { result, api } = run('accept', issue(['scope-review', 'backlog', 'declined'], { state: 'closed' }));
  assert.equal(result.ok, true);
  assert.deepEqual(api.calls, [['removeLabel', 7, 'scope-review'], ['removeLabel', 7, 'backlog'], ['removeLabel', 7, 'declined'], ['reopen', 7], ACCEPTED(), ['addLabelSignal', 7, 'issue-triage-handoff']]);
  assert.deepEqual(STOP_LABELS, ['needs-decision', 'scope-review', 'backlog', 'out-of-scope', 'declined', 'needs-info']);
});

test('/accept says why it cannot: nothing stops the issue, a hold waits for /approve, a closed issue is not a held one', () => {
  assert.match(run('accept', issue(['enhancement'])).result.reason, /already been handed on/);
  assert.match(run('accept', issue(classifiedHold)).result.reason, /which is `\/approve`/);
  assert.match(run('accept', issue([], { state: 'closed' })).result.reason, /closed and nothing marks it/);
  assert.deepEqual(run('accept', issue(['enhancement'])).api.calls, []);
});

test('/decline labels, tells the reporter in plain words with the reason, and closes as not planned with the signal token', () => {
  const { result, api } = run('decline', issue(['needs-decision']), { argument: 'out of our hands, thanks @octocat' });
  assert.equal(result.ok, true);
  assert.deepEqual(names(api), ['addLabel', 'reply', 'closeSignal']);
  assert.deepEqual(api.calls[0], ['addLabel', 7, 'declined']);
  assert.equal(api.calls[1][2], 'Thanks for the report. A maintainer has decided not to take this on.\n\nout of our hands, thanks `@octocat`');
  assert.doesNotMatch(api.calls[1][2], /label|gate|workflow/i);
});

test('/decline without a reason, on a closed issue, and twice', () => {
  const plain = run('decline', issue(['scope-review']));
  assert.equal(plain.api.calls[1][2], 'Thanks for the report. A maintainer has decided not to take this on.');
  assert.deepEqual(names(run('decline', issue([], { state: 'closed' })).api), ['addLabel', 'reply'], 'a closed issue is not closed again');
  assert.match(run('decline', issue(['declined'], { state: 'closed' })).result.reason, /already declined/);
});

test('/approve takes the hold away with the workflow token and names the person who approved', () => {
  const { result, api } = run('approve', issue(classifiedHold), { actor: 'maint' });
  assert.equal(result.ok, true);
  assert.deepEqual(api.calls[0], ['removeLabel', 7, 'plan-approval-required']);
  assert.deepEqual(api.calls[1], ['addLabelSignal', 7, 'plan-triage-handoff']);
  assert.equal(api.calls[2][0], 'reply');
  assert.match(api.calls[2][2], /^<!-- plan-approval-resume -->\nPlan approved by @maint with \/approve\. Handing the issue to implementation\.$/);
});

test('/approve is refused with the reason plan approval gives: not classified, waiting on a dependency, already handed off, no hold', () => {
  assert.match(run('approve', issue(['plan-approval-required'])).result.reason, /plan triage has not classified the issue yet/);
  assert.match(run('approve', issue([...classifiedHold, 'dependency-required'])).result.reason, /waiting on a dependency/);
  assert.match(run('approve', issue([...classifiedHold, 'plan-triage-handoff'])).result.reason, /already handed off/);
  assert.match(run('approve', issue(['complexity/low', 'risk/low'])).result.reason, /does not carry `plan-approval-required`/);
  assert.match(run('approve', issue(classifiedHold, { state: 'closed' })).result.reason, /issue is closed/);
  assert.deepEqual(run('approve', issue(['plan-approval-required'])).api.calls, []);
});

test('/replan hands the issue to the plan worker again, and only for a plan that waits for approval', () => {
  const again = run('replan', issue([...classifiedHold, 'issue-triage-handoff']), { argument: 'use the library' });
  assert.deepEqual(again.api.calls, [['removeLabel', 7, 'issue-triage-handoff'], ['addLabelSignal', 7, 'issue-triage-handoff']]);
  assert.deepEqual(run('replan', issue(classifiedHold)).api.calls, [['addLabelSignal', 7, 'issue-triage-handoff']]);
  assert.match(run('replan', issue(['risk/low'])).result.reason, /waits for approval/);
  assert.match(run('replan', issue(classifiedHold, { state: 'closed' })).result.reason, /waits for approval/);
});

test('/retry gives the gate label that is there again, and refuses when no gate has the issue', () => {
  assert.deepEqual(run('retry', issue(['plan-worker-ready'])).api.calls, [['removeLabel', 7, 'plan-worker-ready'], ['addLabelSignal', 7, 'plan-worker-ready']]);
  assert.match(run('retry', issue(['enhancement'])).result.reason, /Nothing is in a gate/);
});

test('/help lists every command in one comment', () => {
  const { result, api } = run('help', issue([]));
  assert.equal(result.ok, true);
  assert.deepEqual(names(api), ['reply']);
  for (const c of ['/accept', '/decline [reason]', '/approve', '/replan [what to change]', '/retry']) assert.ok(api.calls[0][2].includes(`\`${c}\``), c);
});

// ---------------------------------------------------------------- syncing one issue

test('syncOptions posts the menu for an issue that waits, deletes it for one that does not', () => {
  const waiting = fakeApi({ comments: { 7: [comment(1, 'analysis', BOT)] } });
  const ops = syncOptions(waiting, issue(['needs-decision']), { repo: REPO, settings: SETTINGS, organisation: true, now: NOW });
  assert.deepEqual(ops.map((o) => o.op), ['post']);
  assert.equal(waiting.calls[0][0], 'postComment');
  assert.equal(waiting.calls[0][1], 7);

  const done = fakeApi({ comments: { 7: [comment(1, 'x'), menu(2)] } });
  syncOptions(done, issue(['enhancement']), { repo: REPO, settings: SETTINGS, organisation: true, now: NOW });
  assert.deepEqual(done.calls, [['deleteComment', 2]]);
});

test('syncOptions does nothing when commands are off, except to remove a menu that is left', () => {
  const api = fakeApi({ comments: { 7: [comment(1, 'x'), menu(2)] } });
  syncOptions(api, issue(['needs-decision']), { repo: REPO, settings: { commands: { on: false, need: 'triage' } }, organisation: true, now: NOW });
  assert.deepEqual(api.calls, [['deleteComment', 2]]);
});

test('syncOptions leaves the issue alone when its comments cannot be read', () => {
  const api = fakeApi();
  api.listComments = () => null;
  assert.deepEqual(syncOptions(api, issue(['needs-decision']), { repo: REPO, settings: SETTINGS, organisation: true, now: NOW }), []);
  assert.deepEqual(api.calls, []);
});

test('syncOptions reads the events only for an issue in a gate, to see how long it has been there', () => {
  let read = 0;
  const api = fakeApi({ comments: { 7: [] } });
  api.listEvents = () => { read += 1; return []; };
  syncOptions(api, issue(['needs-decision']), { repo: REPO, settings: SETTINGS, organisation: true, now: NOW });
  assert.equal(read, 0);
  syncOptions(api, issue(['issue-triage-handoff']), { repo: REPO, settings: SETTINGS, organisation: true, now: NOW });
  assert.equal(read, 1);
});

test('menuCandidates: the issues that wait or are in a gate, and those that hold a recent menu', () => {
  const open = [issue(['needs-decision'], { number: 1 }), issue(['backlog'], { number: 2 }), issue(['issue-triage-handoff'], { number: 3 }), issue([], { number: 4, pull_request: {} }), issue([], { number: 5 })];
  const recent = [{ ...menu(9), issue_url: 'https://api.github.com/repos/o/r/issues/5' }, { ...comment(10, 'x'), issue_url: 'https://api.github.com/repos/o/r/issues/2' }];
  assert.deepEqual(menuCandidates(fakeApi({ open, recent }), NOW).numbers, [1, 3, 5]);
  assert.equal(menuCandidates(fakeApi({ listFails: true }), NOW), null);
});

// ---------------------------------------------------------------- the events

function eventEnv(event, payload, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
  const file = path.join(dir, 'event.json');
  fs.writeFileSync(file, JSON.stringify(payload));
  return { env: { GITHUB_REPOSITORY: REPO, GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: file, SIGNAL_TOKEN: 's', GH_TOKEN: 'g' }, files };
}
const commentEvent = (body, { login = 'maint', type = 'User', assoc = 'OWNER', labels = ['needs-decision'], owner = 'Organization', pr = false } = {}) => ({
  issue: { number: 7, labels: labels.map((name) => ({ name })), ...(pr ? { pull_request: {} } : {}) },
  comment: { id: 500, body, user: { login, type }, author_association: assoc },
  repository: { owner: { type: owner } },
});
function go(event, payload, apiOptions = {}) {
  const { env } = eventEnv(event, payload);
  const api = fakeApi(apiOptions);
  const out = [];
  const code = main(env, api, (m) => out.push(m));
  return { code, api, out };
}
const held = { issues: { 7: issue(['needs-decision']) }, comments: { 7: [comment(1, 'analysis', BOT)] } };

test('main: a maintainer\'s /accept runs, gets a rocket, and the menu is brought up to date from the labels as they are then', () => {
  const api = { ...held, roles: { maint: 'admin' } };
  const first = fakeApi(api);
  const { env } = eventEnv('issue_comment', commentEvent('/accept'));
  const out = [];
  // the labels change when the command runs: the menu is then computed from the fresh issue
  const real = first.removeLabel;
  first.removeLabel = (n, l) => { real(n, l); first.getIssue = () => issue([]); };
  assert.equal(main(env, first, (m) => out.push(m)), 0);
  assert.deepEqual(names(first).slice(0, 4), ['removeLabel', 'reply', 'addLabelSignal', 'react']);
  assert.deepEqual(first.calls.find((c) => c[0] === 'react'), ['react', 500, 'rocket']);
  assert.ok(out.some((l) => l.includes('/accept by maint: removed needs-decision')));
});

test('main: a refused command gets a confused face and a reply that says why, and the menu is still last', () => {
  const { api } = go('issue_comment', commentEvent('/approve'), { ...held, roles: { maint: 'admin' } });
  assert.deepEqual(api.calls.find((c) => c[0] === 'react'), ['react', 500, 'confused']);
  const reply = api.calls.find((c) => c[0] === 'reply');
  assert.match(reply[2], /^Could not run `\/approve`: There is no plan waiting for approval/);
  assert.equal(names(api).at(-1), 'postComment', 'the menu is posted after the reply, so it is last');
});

test('main: a stranger\'s command is ignored without a word, a collaborator below the role is told', () => {
  const stranger = go('issue_comment', commentEvent('/accept', { login: 'passer-by', assoc: 'NONE' }), { ...held, roles: {} });
  assert.deepEqual(names(stranger.api).filter((n) => n !== 'postComment'), []);
  assert.ok(stranger.out.some((l) => l.includes('ignored (not a collaborator)')));

  const reader = go('issue_comment', commentEvent('/accept', { login: 'viewer', assoc: 'COLLABORATOR' }), { ...held, roles: { viewer: 'read' } });
  assert.deepEqual(reader.api.calls.find((c) => c[0] === 'react'), ['react', 500, 'confused']);
  assert.match(reader.api.calls.find((c) => c[0] === 'reply')[2], /commands need the \*\*triage\*\* role or higher, and yours is read/);
  assert.ok(!reader.api.calls.some((c) => c[0] === 'removeLabel'), 'nothing was changed');
});

test('main: when GitHub does not tell the role, a collaborator is told so, and nothing is changed', () => {
  const api = fakeApi({ ...held });
  api.role = () => null;
  const { env } = eventEnv('issue_comment', commentEvent('/accept'));
  assert.equal(main(env, api, () => {}), 0);
  assert.match(api.calls.find((c) => c[0] === 'reply')[2], /did not tell the Concierge your role/);
  assert.ok(!api.calls.some((c) => c[0] === 'removeLabel' || c[0] === 'addLabelSignal'));
});

test('main: the setting decides the role, and a personal repository needs write', () => {
  const need = (value) => ({ ...held, roles: { maint: 'triage' }, files: { '.github/issue-concierge/settings.yml': `commands-need: ${value}\n` } });
  assert.ok(go('issue_comment', commentEvent('/accept'), need('triage')).api.calls.some((c) => c[0] === 'removeLabel'));
  assert.ok(!go('issue_comment', commentEvent('/accept'), need('write')).api.calls.some((c) => c[0] === 'removeLabel'));
  assert.ok(!go('issue_comment', commentEvent('/accept', { owner: 'User' }), need('triage')).api.calls.some((c) => c[0] === 'removeLabel'), 'triage does not exist in a personal repository');
});

test('main: settings.yml is read from the old folder in a repository that has not been updated yet, and the new folder wins when both have it', () => {
  const OLD = '.github/agentic-workflows/settings.yml';
  const NEW = '.github/issue-concierge/settings.yml';
  const withFiles = (files) => ({ ...held, roles: { maint: 'admin' }, files });
  const old = go('issue_comment', commentEvent('/accept'), withFiles({ [OLD]: 'commands: false\n' }));
  assert.deepEqual(old.api.calls, [], 'the setting in the old folder switches the commands off');
  assert.ok(old.out.some((l) => l.startsWith('commands is false')));
  const both = go('issue_comment', commentEvent('/accept'), withFiles({ [OLD]: 'commands: false\n', [NEW]: 'commands: true\n' }));
  assert.ok(both.api.calls.some((c) => c[0] === 'removeLabel'), 'the new folder wins');
  const need = go('issue_comment', commentEvent('/accept'), { ...held, roles: { maint: 'triage' }, files: { [OLD]: 'commands-need: write\n' } });
  assert.ok(!need.api.calls.some((c) => c[0] === 'removeLabel'), 'commands-need in the old folder applies as well');
  const none = go('issue_comment', commentEvent('/accept'), withFiles({}));
  assert.ok(none.api.calls.some((c) => c[0] === 'removeLabel'), 'no file in either folder: the defaults apply');
});

test('main: a comment that is no command keeps the menu last on an issue that waits, and costs nothing on one that does not', () => {
  const waiting = go('issue_comment', commentEvent('thanks!', { login: 'reporter', assoc: 'NONE' }), { ...held, comments: { 7: [comment(1, 'analysis', BOT), menu(2), comment(3, 'thanks!')] } });
  assert.deepEqual(names(waiting.api), ['deleteComment', 'postComment']);
  const idle = go('issue_comment', commentEvent('thanks!', { labels: ['enhancement'] }), { issues: { 7: issue(['enhancement']) } });
  assert.deepEqual(idle.api.calls, []);
  assert.deepEqual(idle.api.reads, [], 'not even a read');
});

test('main: a pull request comment, a bot\'s comment and the setting off do nothing', () => {
  assert.deepEqual(go('issue_comment', commentEvent('/accept', { pr: true }), held).api.calls, []);
  const bot = go('issue_comment', commentEvent('/accept', { login: 'github-actions[bot]', type: 'Bot' }), { ...held, comments: { 7: [comment(1, 'x'), menu(2)] } });
  assert.ok(!bot.api.calls.some((c) => c[0] === 'removeLabel' || c[0] === 'react'));
  const off = go('issue_comment', commentEvent('/accept'), { ...held, roles: { maint: 'admin' }, files: { '.github/issue-concierge/settings.yml': 'commands: false\n' } });
  assert.deepEqual(off.api.calls, []);
  assert.ok(off.out.some((l) => l.startsWith('commands is false')));
});

test('main: a label event brings that issue\'s menu up to date, and a close takes it away', () => {
  const labelled = go('issues', { action: 'labeled', issue: { number: 7 }, repository: { owner: { type: 'Organization' } } }, held);
  assert.deepEqual(names(labelled.api), ['postComment']);
  const closed = go('issues', { action: 'closed', issue: { number: 7 }, repository: { owner: { type: 'Organization' } } }, { issues: { 7: issue(['needs-decision'], { state: 'closed' }) }, comments: { 7: [menu(2)] } });
  assert.deepEqual(closed.api.calls, [['deleteComment', 2]]);
});

test('main: the hourly run and a manual run go through every issue that waits or holds a menu', () => {
  const open = [issue(['needs-decision'], { number: 7 }), issue(['enhancement'], { number: 8 })];
  const recent = [{ ...menu(9), issue_url: 'https://api.github.com/repos/o/r/issues/8' }];
  const options = { open, recent, issues: { 7: open[0], 8: open[1] }, comments: { 7: [comment(1, 'a', BOT)], 8: [comment(1, 'a'), menu(9)] } };
  const { api, code } = go('schedule', { repository: { owner: { type: 'Organization' } } }, options);
  assert.equal(code, 0);
  assert.deepEqual(api.calls, [['postComment', 7, api.calls[0][2]], ['deleteComment', 9]], 'one gets its menu, the other loses the one it should not have');

  const { env } = eventEnv('workflow_dispatch', {});
  const one = fakeApi(options);
  assert.equal(main({ ...env, ISSUE_NUMBER: '7' }, one, () => {}), 0);
  assert.deepEqual(names(one), ['postComment']);
});

test('main: when the issues cannot be listed the hourly run fails and changes nothing', () => {
  const { code, api, out } = go('schedule', {}, { listFails: true });
  assert.equal(code, 1);
  assert.deepEqual(api.calls, []);
  assert.ok(out.some((l) => l.startsWith('::error::')));
});

// ---------------------------------------------------------------- the source

test('the comment is data: the module never starts a shell, and the commenter\'s login is the only thing asked about a role', () => {
  const source = fs.readFileSync(path.join(HERE, 'commands.mjs'), 'utf8');
  assert.deepEqual([...source.matchAll(/^import .* from 'node:child_process';$/gm)].map((m) => m[0]), ["import { execFileSync } from 'node:child_process';"], 'only execFileSync, with an argument list');
  assert.ok(!/shell:\s*true|execSync|\bspawn/.test(source));
  assert.match(source, /api\.role\(commenter\.login\)/);
  assert.ok(!/api\.role\([^)]*body/.test(source));
  assert.ok(!/payload\.comment\.body[^;]*(addLabel|closeSignal|removeLabel)/.test(source));
});

test('what starts the next gate uses the signal token and what must not uses the workflow token', () => {
  const source = fs.readFileSync(path.join(HERE, 'commands.mjs'), 'utf8');
  assert.match(source, /addLabelSignal: \(n, label\) => json\('POST', `repos\/\$\{repo\}\/issues\/\$\{n\}\/labels`, \{ labels: \[label\] \}, signal\)/);
  assert.match(source, /closeSignal: \(n\) => json\('PATCH'[^\n]*, signal\)/);
  assert.match(source, /removeLabel: \(n, label\) => ignore404\(\(\) => json\('DELETE'[^\n]*labels\/\$\{encodeURIComponent\(label\)\}`\)\),/, 'a removal uses the default, the workflow token');
  assert.match(source, /reopen: \(n\) => json\('PATCH', `repos\/\$\{repo\}\/issues\/\$\{n\}`, \{ state: 'open' \}\)/, 'a reopen starts nothing');
});
