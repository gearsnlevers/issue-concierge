import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { START_FAILURE, decide, latestAgentComment, main } from './agent-start-watch.mjs';

// The coding agent reports in one comment when its session cannot start, after it has opened an empty draft pull request: on
// frodo-lib#783 (2026-11-02) and #754 (2026-10-23) nothing else in the Concierge noticed, and the issue sat with an assignee and
// no work. The two comments below are the ones GitHub wrote, word for word (docs/multi-phase-design.md, "When the coding agent
// does not start"; decision 0041).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = 'o/r';
const RULESET = 'The agent encountered an error and was unable to start working on this issue: This may be caused by a repository ruleset violation. See [granting bypass permissions for the agent](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository#granting-bypass-permissions-for-your-branch-or-tag-ruleset), or please contact support if the issue persists. (Request id: 19C2:65FE8:10DE187:371EB32:6AE8D241)';
const UNAVAILABLE = 'The agent encountered an error and was unable to start working on this issue: The service is temporarily unavailable. Please try again later. (Request id: 0E18:1FA680:1091ABF:362666D:6ADB78F3)';
const AGENT = { login: 'Copilot', type: 'Bot' };

const issue = (labels = ['enhancement', 'complexity/low', 'risk/high'], extra = {}) => ({
  number: 7, state: 'open', labels: labels.map((name) => ({ name })), user: { login: 'someone', type: 'User' }, assignees: [{ login: 'maint', type: 'User' }, { login: 'Copilot', type: 'Bot' }], ...extra,
});
const comment = (body, user = AGENT, at = '2026-11-02T18:11:35Z') => ({ id: Date.parse(at), body, user, created_at: at });

test('decide: the agent\'s own report that it could not start, on an issue the Concierge handed to it, gets the label', () => {
  for (const body of [RULESET, UNAVAILABLE]) {
    assert.deepEqual(decide(issue(), comment(body)), { label: true, reason: 'the coding agent reported that it could not start' });
  }
  for (const login of ['Copilot', 'copilot-swe-agent', 'copilot-swe-agent[bot]']) assert.equal(decide(issue(), comment(RULESET, { login, type: 'Bot' })).label, true, login);
  assert.equal(decide(issue(), comment(RULESET.toUpperCase())).label, true, 'in any case');
});

test('START_FAILURE reads the words of the comment and nothing a progress report or a pull request comment says', () => {
  assert.ok(START_FAILURE.test(RULESET) && START_FAILURE.test(UNAVAILABLE));
  for (const body of ['I am working on this now.', 'The agent encountered an error while working on this issue.', 'unable to start working on this pull request', 'Started work on the plan', '']) assert.equal(START_FAILURE.test(body), false, body);
});

test('decide: only the coding agent\'s account counts, because anyone can type the words', () => {
  assert.equal(decide(issue(), comment(RULESET, { login: 'a-person', type: 'User' })).label, false);
  assert.equal(decide(issue(), comment(RULESET, { login: 'Copilot', type: 'User' })).label, false, 'a person named Copilot is not the agent');
  assert.equal(decide(issue(), comment(RULESET, { login: 'github-actions[bot]', type: 'Bot' })).label, false);
  assert.equal(decide(issue(), comment(RULESET, { login: 'copilot-pull-request-reviewer[bot]', type: 'Bot' })).label, false);
  assert.equal(decide(issue(), { body: RULESET }).label, false);
  assert.equal(decide(issue(), null).label, false);
});

test('decide: the other comments of the agent do not label the issue', () => {
  assert.match(decide(issue(), comment('Plan: I will start with the library.')).reason, /not a report that the agent could not start/);
});

test('decide: not a pull request, not a closed issue, not an opted-out one, not a bot\'s issue', () => {
  assert.equal(decide(issue(undefined, { pull_request: {} }), comment(RULESET)).label, false);
  assert.match(decide(issue(undefined, { state: 'closed' }), comment(RULESET)).reason, /closed/);
  assert.match(decide(issue(['complexity/low', 'risk/high', 'no-auto-processing']), comment(RULESET)).reason, /no-auto-processing/);
  assert.match(decide(issue(undefined, { user: { login: 'github-actions[bot]', type: 'Bot' } }), comment(RULESET)).reason, /bot/);
});

test('decide: the agent has to be assigned still, and the issue not labelled already', () => {
  assert.match(decide(issue(undefined, { assignees: [{ login: 'maint' }] }), comment(RULESET)).reason, /no longer assigned/);
  assert.match(decide(issue(undefined, { assignees: [] }), comment(RULESET)).reason, /no longer assigned/);
  assert.match(decide(issue(['complexity/low', 'risk/high', 'agent-start-failed']), comment(RULESET)).reason, /already labelled/);
});

// frodo-lib#783: the first attempt failed at 18:11:35 (assigned 18:11:15); a maintainer started the agent again at 18:53:53, and the
// second attempt, which works, wrote nothing on the issue. A run by hand at 20:00 looked at the latest comment of the agent, the old
// failure, and would have labelled an issue the agent is working on.
test('decide: a report from before the agent\'s latest assignment is about an attempt that is over', () => {
  const at = (s) => Date.parse(`2026-11-02T${s}Z`);
  const failure = comment(RULESET, AGENT, '2026-11-02T18:11:35Z');
  assert.equal(decide(issue(), failure, { assigned: at('18:11:15') }).label, true, 'the report came after the assignment it is about');
  assert.match(decide(issue(), failure, { assigned: at('18:53:53') }).reason, /assigned again after this comment/);
  assert.equal(decide(issue(), failure, { assigned: at('18:53:53') }).label, false);
  assert.equal(decide(issue(), failure, { assigned: null }).label, true, 'without events there is nothing to compare');
  assert.equal(decide(issue(), failure).label, true);
  assert.equal(decide(issue(), failure, { assigned: at('18:11:35') }).label, true, 'the same second is the same attempt');
});

test('decide: an issue plan triage has not classified is not one the Concierge handed to the agent, so starting it again is not the Concierge\'s to offer', () => {
  for (const labels of [[], ['enhancement'], ['complexity/low'], ['risk/high']]) assert.match(decide(issue(labels), comment(RULESET)).reason, /did not hand it to the agent/, labels.join());
});

test('latestAgentComment: the newest comment of the coding agent, not a person\'s and not another bot\'s', () => {
  const comments = [
    comment('first', AGENT, '2026-11-02T18:00:00Z'),
    comment(RULESET, AGENT, '2026-11-02T18:11:35Z'),
    comment('later, by a person', { login: 'maint', type: 'User' }, '2026-11-02T19:00:00Z'),
    comment('later, by the Concierge', { login: 'github-actions[bot]', type: 'Bot' }, '2026-11-02T19:30:00Z'),
  ];
  assert.equal(latestAgentComment(comments).body, RULESET);
  assert.equal(latestAgentComment([comments[2], comments[3]]), null);
  assert.equal(latestAgentComment([]), null);
});

// ---------------------------------------------------------------- main

function fakeApi({ issues = {}, comments = {}, events = {} } = {}) {
  const calls = [];
  return {
    calls,
    getIssue: (n) => issues[n] ?? null,
    listComments: (n) => comments[n] ?? [],
    listEvents: (n) => events[n] ?? [],
    addLabel: (n, label) => calls.push(['addLabel', n, label]),
  };
}
function run(event, payload, { env = {}, argv = [], ...apiOptions } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
  const file = path.join(dir, 'event.json');
  fs.writeFileSync(file, JSON.stringify(payload));
  const api = fakeApi(apiOptions);
  const out = [];
  const code = main(argv, { GITHUB_REPOSITORY: REPO, GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: file, ...env }, api, (m) => out.push(m));
  return { code, api, out };
}

test('main: the agent\'s comment on a comment event labels the issue once, from the live issue and not from the event', () => {
  const stale = { number: 7, labels: [], assignees: [] }; // what the event carried: nothing to decide on
  const { code, api, out } = run('issue_comment', { issue: stale, comment: comment(RULESET) }, { issues: { 7: issue() } });
  assert.equal(code, 0);
  assert.deepEqual(api.calls, [['addLabel', 7, 'agent-start-failed']]);
  assert.deepEqual(out, ['#7: labelled (the coding agent reported that it could not start)']);
});

test('main: a comment that is not the report changes nothing', () => {
  for (const c of [comment('Working on it'), comment(RULESET, { login: 'a-person', type: 'User' })]) {
    const { api, out } = run('issue_comment', { issue: { number: 7 }, comment: c }, { issues: { 7: issue() } });
    assert.deepEqual(api.calls, []);
    assert.match(out[0], /^#7: skipped \(/);
  }
});

test('main: --dry-run says what it would do and does not label', () => {
  const { api, out } = run('issue_comment', { issue: { number: 7 }, comment: comment(RULESET) }, { issues: { 7: issue() }, argv: ['--dry-run'] });
  assert.deepEqual(api.calls, []);
  assert.match(out[0], /^#7: labelled/);
});

test('main: a run by hand looks at the latest comment of the agent on one issue', () => {
  const env = { ISSUE_NUMBER: '7' };
  const failed = run('workflow_dispatch', {}, { env, issues: { 7: issue() }, comments: { 7: [comment('plan', AGENT, '2026-11-02T18:00:00Z'), comment(RULESET)] } });
  assert.deepEqual(failed.api.calls, [['addLabel', 7, 'agent-start-failed']]);
  const recovered = run('workflow_dispatch', {}, { env, issues: { 7: issue() }, comments: { 7: [comment(RULESET, AGENT, '2026-11-02T18:00:00Z'), comment('Started work', AGENT, '2026-11-02T18:54:22Z')] } });
  assert.deepEqual(recovered.api.calls, [], 'the agent went on to work, so its last word is not a failure');
  const silent = run('workflow_dispatch', {}, { env, issues: { 7: issue() }, comments: { 7: [] } });
  assert.deepEqual(silent.api.calls, []);
  assert.match(silent.out[0], /the coding agent has not commented/);
});

const assigned = (login, at) => ({ event: 'assigned', assignee: { login, type: 'Bot' }, created_at: at });

test('main: the timeline of frodo-lib#783: the report labels the issue when it comes, and not a run by hand after the second attempt', () => {
  const first = [assigned('Copilot', '2026-11-02T18:11:15Z')];
  const second = [...first, { event: 'unassigned', assignee: AGENT, created_at: '2026-11-02T18:50:07Z' }, assigned('Copilot', '2026-11-02T18:53:53Z')];
  const options = (events) => ({ issues: { 7: issue() }, comments: { 7: [comment(RULESET)] }, events: { 7: events } });
  const live = run('issue_comment', { issue: { number: 7 }, comment: comment(RULESET) }, options(first));
  assert.deepEqual(live.api.calls, [['addLabel', 7, 'agent-start-failed']], 'at 18:11:35');
  const byHand = run('workflow_dispatch', {}, { env: { ISSUE_NUMBER: '7' }, ...options(second) });
  assert.deepEqual(byHand.api.calls, [], 'at 20:00, with the agent working on its second attempt');
  assert.match(byHand.out[0], /^#7: skipped \(the coding agent was assigned again after this comment/);
  const stillFailed = run('workflow_dispatch', {}, { env: { ISSUE_NUMBER: '7' }, ...options(first) });
  assert.deepEqual(stillFailed.api.calls, [['addLabel', 7, 'agent-start-failed']], 'a failed attempt that nobody has retried is found by hand');
});

test('main: an issue that cannot be read is skipped, and a missing repository or number is an error', () => {
  const unread = run('workflow_dispatch', {}, { env: { ISSUE_NUMBER: '7' } });
  assert.equal(unread.code, 0);
  assert.match(unread.out[0], /could not be read/);
  assert.equal(main([], {}, fakeApi(), () => {}), 1);
  const none = run('workflow_dispatch', {}, { env: {} });
  assert.equal(none.code, 1);
  assert.match(none.out[0], /^::error::/);
  assert.equal(run('workflow_dispatch', {}, { env: { ISSUE_NUMBER: 'abc' } }).code, 1);
});

test('the script starts no shell, reads the comment only from the event file, and labels with the signal token', () => {
  const source = fs.readFileSync(path.join(HERE, 'agent-start-watch.mjs'), 'utf8');
  assert.deepEqual([...source.matchAll(/^import .* from 'node:child_process';$/gm)].map((m) => m[0]), ["import { execFileSync } from 'node:child_process';"]);
  assert.ok(!/shell:\s*true|execSync|\bspawn/.test(source));
  assert.match(source, /const signal = env\.SIGNAL_TOKEN \|\| env\.GH_TOKEN;/);
  assert.match(source, /addLabel: \(n, label\) => call\(\['api', `repos\/\$\{repo\}\/issues\/\$\{n\}\/labels`, '--method', 'POST', '-f', `labels\[\]=\$\{label\}`\], signal\)/);
  assert.match(source, /getIssue: \(n\) => get\(`repos\/\$\{repo\}\/issues\/\$\{n\}`\)/, 'the decision reads the live issue with the workflow token');
  assert.match(source, /assigned: assignedAt\(api\.listEvents\(number\)\)/, 'and the events say which attempt the report is about');
  assert.match(source, /listEvents\(n\) \{[^}]*get\(`repos\/\$\{repo\}\/issues\/\$\{n\}\/events\?per_page=100&page=\$\{page\}`\)/, 'the real api reads them');
});
