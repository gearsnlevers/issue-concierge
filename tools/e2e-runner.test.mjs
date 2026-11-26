import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGitHub, isStatusPage, LEGACY_STATUS_MARKER, STATUS_MARKER } from './e2e/github.mjs';
import { MARKER as PAGE_MARKER } from '../scripts/status-issue.mjs';
import { evaluateCheck, describeSnapshot, CHECK_TYPES } from './e2e/checks.mjs';
import { RUNNER, cleanupStale, expand, loadConfig, loadScenarios, main, numberOf, readPinText, renderSummary, runScenario, runSuite, validateScenario } from './e2e/run.mjs';

const config = loadConfig();
const scenarios = loadScenarios();
const byId = (id) => scenarios.find((s) => s.id === id);
const BOT = 'github-actions[bot]';

// ------------------------------------------------------------------ a fake GitHub that answers like the gates

function world({ failCreateAfter } = {}) {
  const w = { now: Date.parse('2026-10-27T10:00:00Z'), issues: [], runs: [], bot: [], dispatches: [], created: [], userCalls: 0, onTick: () => {}, onComment: () => {} };
  let runId = 1000;
  const find = (repo, n) => w.issues.find((i) => i.repo === repo && i.number === n);
  const gh = {
    user: async () => { w.userCalls += 1; return { login: 'runner' }; },
    createIssue: async (repo, { title, body, labels, assignees }) => {
      if (failCreateAfter !== undefined && w.issues.length >= failCreateAfter) throw new Error('boom');
      const number = w.issues.filter((i) => i.repo === repo).length + 1;
      w.created.push({ repo, title, labels, assignees });
      const issue = { repo, number, title, body, labels: [...labels], state: 'open', state_reason: null, assignees: (assignees ?? []).map((login) => ({ login, type: 'User' })), comments: [], timeline: [], html_url: `https://github.com/${repo}/issues/${number}`, ticks: 0 };
      w.issues.push(issue);
      return issue;
    },
    getIssue: async (repo, n) => ({ ...find(repo, n), labels: find(repo, n).labels.map((name) => ({ name })) }),
    listComments: async (repo, n) => find(repo, n).comments.map((c) => ({ user: { login: c.author, type: c.author === BOT ? 'Bot' : 'User' }, body: c.body })),
    timeline: async (repo, n) => find(repo, n).timeline,
    listRuns: async () => w.runs,
    listBotIssues: async (repo) => w.bot.filter((b) => b.repo === repo),
    findStatusIssue: async (repo) => w.status?.[repo] ?? null,
    comment: async (repo, n, body) => {
      find(repo, n).comments.push({ author: 'runner', body });
      w.onComment(find(repo, n), body);
    },
    addLabels: async (repo, n, labels) => {
      const issue = find(repo, n);
      for (const l of labels) if (!issue.labels.includes(l)) issue.labels.push(l);
    },
    removeLabel: async (repo, n, label) => {
      find(repo, n).labels = find(repo, n).labels.filter((l) => l !== label);
    },
    closeIssue: async (repo, n, reason) => Object.assign(find(repo, n), { state: 'closed', state_reason: reason }),
    dispatch: async (repo, workflow, inputs) => w.dispatches.push({ repo, workflow, inputs }),
    listOpenIssues: async (repo) => w.issues.filter((i) => i.repo === repo && i.state === 'open'),
    readFile: async () => 'source: x/y\nversion: v1.8.0\n',
  };
  const ctx = {
    gh, config, owner: 'o', runId: 'r1', runner: 'runner', pollMs: 30000, retries: 1, now: () => w.now, suiteSince: '2026-10-27T09:59:00Z', log: () => {},
    sleep: async (ms) => {
      w.now += ms;
      for (const issue of w.issues) {
        issue.ticks += 1;
        w.onTick(issue, w);
      }
    },
  };
  const gate = (issue, workflow, text = 'comment') => issue.comments.push({ author: BOT, body: `${text}\n<!-- gh-aw-workflow-call-id: ${issue.repo}/${workflow} -->` });
  // A gh-aw gate's run is titled with the workflow, not with the issue, so nothing but its start time ties it to the issue.
  const run = (_issue, name, conclusion = 'success', status = 'completed') => w.runs.push({ id: runId++, name, status, conclusion, created_at: new Date(w.now).toISOString(), display_title: name });
  return { w, gh, ctx, gate, run };
}

/** The gates do what the design says for the happy-path scenario: one analysis, one plan, a classification, the hold stays. */
function happyGates({ w, gate, run }) {
  w.onTick = (issue) => {
    if (issue.state !== 'open' || !issue.title.includes('listWidgets: sort numbers')) return;
    if (issue.ticks === 2) {
      gate(issue, 'issue-worker');
      run(issue, 'Issue Concierge 1a ▸ Issue Worker');
      run(issue, 'Issue Concierge 1b Issue Triage');
    }
    if (issue.ticks === 3) {
      gate(issue, 'plan-worker', '## Decisions that apply\n## Repository rules that apply');
      run(issue, 'Issue Concierge 2a Plan Worker');
      issue.labels.push('complexity/low', 'risk/low');
    }
  };
}

// ------------------------------------------------------------------ the scenario files

test('every scenario file is valid, has a unique id and says what it covers', () => {
  assert.ok(scenarios.length >= 5);
  assert.deepEqual(scenarios.flatMap((s) => validateScenario(s, config)), []);
  assert.equal(new Set(scenarios.map((s) => s.id)).size, scenarios.length);
  for (const s of scenarios) assert.ok(s.covers.length > 0 && s.profiles.length > 0, s.id);
});

test('every issue a scenario files carries the hold or the opt-out, so that no code is ever written', () => {
  for (const s of scenarios) {
    for (const issue of [s.issue, ...(s.files ?? [])]) {
      assert.ok(issue.labels.includes('plan-approval-required') || issue.labels.includes('no-auto-processing'), `${s.id}: "${issue.title}" can reach a coding agent`);
    }
  }
});

test('no scenario asks for a change that collides with the sandbox code, which the change guard rightly holds (the soak of v2.0.0-1)', () => {
  // flattenTree(node, visited = []) already uses its second parameter. A reporter who asks for "a second argument" asks for a
  // change to what exists; needs-info-then-details did, was held with needs-decision and never planned, on both pairs, twice.
  const source = fs.readFileSync(new URL('./e2e/sandbox/lib/src/tree.js', import.meta.url), 'utf8');
  assert.match(source, /export function flattenTree\(node, visited = \[\]\)/, 'the sandbox signature this test is about');
  for (const s of scenarios) {
    const text = JSON.stringify([s.issue, s.files, s.steps]);
    assert.doesNotMatch(text, /second (argument|parameter)/i, `${s.id}: names a position that flattenTree already uses`);
  }
});

test('scenario 13 files its issue assigned to the runner\'s own person, with the hold and nothing else, so that the intake guard is what has to stop the opened event', () => {
  const s = byId('assigned-issue-is-left-alone');
  assert.equal(s.number, 13);
  assert.deepEqual(s.profiles, ['public', 'private']);
  assert.equal(s.repo, 'lib');
  assert.deepEqual(s.files ?? [], [], 'one issue');
  // The hold satisfies the rule that no scenario can reach a coding agent (records 0033 and 0039) and is no term of the issue
  // worker's condition; the opt-out label would stop the worker by itself, and then the assignee term would never be exercised.
  assert.deepEqual(s.issue.labels, ['enhancement', 'plan-approval-required']);
  assert.deepEqual(s.issue.assignees, [RUNNER], 'the runner\'s own person: never a literal login, a bot or the coding agent');
  assert.equal(RUNNER, '{{runner}}');
  assert.match(s.covers.join('\n'), /not covered: handing the issue back[\s\S]*coding agent as an assignee/, 'the two things left out, and why, are in the file');
  assert.deepEqual(s.steps.map((step) => Object.keys(step)[0]), ['wait', 'settle', 'expect'], 'the wait for the label, the quiet period, then the facts');
  assert.ok(!s.steps.some((step) => 'label' in step || 'unlabel' in step || 'comment' in step || 'dispatch' in step), 'no hand-back, and nothing that starts a model run');
  const [wait, settle, expect] = s.steps.map((step) => Object.values(step)[0]);
  assert.ok(wait.timeoutMinutes >= 5 && wait.timeoutMinutes <= 15, 'a few minutes: the janitor job takes about one');
  assert.deepEqual(wait.checks.map((c) => c.type), ['labels', 'noFailedRuns', 'noFailureIssues']);
  assert.deepEqual(wait.checks[0].include, ['no-auto-processing']);
  assert.ok(settle.minutes >= 6, 'long enough for a wrongly started issue worker to have commented');
  const byType = (type) => expect.checks.filter((c) => c.type === type);
  assert.deepEqual(byType('comments').map((c) => [c.workflow, c.count]), [['issue-worker', 0]]);
  assert.equal(byType('noBotComments').length, 1);
  assert.deepEqual(byType('labels').map((c) => c.only), [['enhancement', 'plan-approval-required', 'no-auto-processing']]);
  assert.deepEqual(byType('assignees').map((c) => c.only), [[RUNNER]]);
  assert.deepEqual(byType('noPullRequest').map((c) => c.allowAssigned), [[RUNNER]]);
  assert.equal(byType('noFailedRuns').length + byType('noFailureIssues').length, 2);
});

test('no other scenario files an issue with an assignee: only scenario 13 does, and it is the runner', () => {
  for (const s of scenarios) {
    for (const issue of [s.issue, ...(s.files ?? [])]) {
      if (s.id === 'assigned-issue-is-left-alone') continue;
      assert.equal(issue.assignees, undefined, `${s.id}: assigns "${issue.title}"; an assignee is a claim, and the Concierge keeps out of it`);
    }
  }
});

test('validateScenario names what is wrong', () => {
  const ok = byId('out-of-scope-closes');
  const problems = (change) => validateScenario({ ...structuredClone(ok), ...change }, config).join(' | ');
  assert.match(problems({ id: 'Bad Id' }), /id must be lower case/);
  assert.match(problems({ profiles: ['nowhere'] }), /profiles must be among public, private/);
  assert.match(problems({ repo: 'web' }), /repo must be lib or app/);
  assert.match(problems({ covers: [] }), /covers must name/);
  assert.match(problems({ steps: [] }), /needs steps/);
  assert.match(problems({ steps: [{ wait: { timeoutMinutes: 5, checks: [{ type: 'vibes' }] } }] }), /unknown check type "vibes"/);
  assert.match(problems({ steps: [{ comment: 'x', label: ['y'] }] }), /exactly one of/);
  assert.match(problems({ steps: [{ wait: { checks: [{ type: 'runs' }] } }] }), /wait needs timeoutMinutes/);
  assert.match(problems({ steps: [{ close: 'completed', issue: 'ghost' }] }), /names the issue "ghost"/);
  assert.match(problems({ steps: [{ close: 'whenever' }] }), /close needs completed or not_planned/);
  assert.match(problems({ steps: [{ comment: 'see {{nowhere}}' }] }), /unknown placeholder {{nowhere}}/);
  assert.match(problems({ files: [{ id: 'issue', title: 't', body: 'b', labels: [] }] }), /file ids must be unique/);
});

test('validateScenario accepts the runner as an assignee, and rejects every other assignees value and an unknown placeholder', () => {
  const ok = byId('assigned-issue-is-left-alone');
  const issueWith = (assignees) => ({ ...structuredClone(ok), issue: { ...structuredClone(ok.issue), assignees } });
  const problems = (scenario) => validateScenario(scenario, config).join(' | ');
  assert.equal(problems(ok), '');
  assert.match(problems(issueWith([])), /assignees must be a list that holds only {{runner}}/, 'an empty list assigns nobody: leave the field out');
  assert.match(problems(issueWith('{{runner}}')), /assignees must be a list/, 'not a list');
  assert.match(problems(issueWith(['someone'])), /assignees must be a list that holds only {{runner}}.*never a literal login, never a bot, never the coding agent/);
  assert.match(problems(issueWith(['copilot-swe-agent[bot]'])), /assignees must be a list/);
  assert.match(problems(issueWith(['{{runner}}', 'copilot'])), /assignees must be a list/);
  assert.match(problems(issueWith(['{{lib}}'])), /assignees must be a list/, 'a placeholder that is not a person');
  assert.match(problems(issueWith([null])), /assignees must be a list/);
  assert.match(problems(issueWith(['{{nobody}}'])), /unknown placeholder {{nobody}}/, 'an unknown placeholder is named');
  const withFile = { ...structuredClone(ok), files: [{ id: 'dep', title: 't', body: 'b', labels: ['enhancement'], assignees: ['someone'] }] };
  assert.match(problems(withFile), /assignees must be a list/, 'a file that a scenario files first is held to the same rule');
  // the checks
  const checks = (...list) => ({ ...structuredClone(ok), steps: [{ expect: { checks: list } }] });
  assert.equal(problems(checks({ type: 'assignees', only: ['{{runner}}'] }, { type: 'assignees', only: [] }, { type: 'noPullRequest', allowAssigned: ['{{runner}}'] })), '');
  assert.match(problems(checks({ type: 'assignees' })), /an assignees check needs only, a list of logins/);
  assert.match(problems(checks({ type: 'assignees', only: 'runner' })), /an assignees check needs only/);
  assert.match(problems(checks({ type: 'assignees', only: [''] })), /an assignees check needs only/);
  assert.match(problems(checks({ type: 'assignees', only: ['{{nobody}}'] })), /unknown placeholder {{nobody}}/);
  assert.match(problems(checks({ type: 'noPullRequest', allowAssigned: [] })), /allowAssigned is a non-empty list of logins, and only for a noPullRequest check/);
  assert.match(problems(checks({ type: 'noPullRequest', allowAssigned: 'runner' })), /allowAssigned is a non-empty list/);
  assert.match(problems(checks({ type: 'noPullRequest', allowAssigned: ['{{nobody}}'] })), /unknown placeholder {{nobody}}/);
  assert.match(problems(checks({ type: 'labels', allowAssigned: ['{{runner}}'] })), /allowAssigned is a non-empty list of logins, and only for a noPullRequest check/);
});

test('expand fills known names and refuses unknown ones', () => {
  assert.equal(expand('see {{lib}}#{{dep.number}}', { lib: 'o/l', 'dep.number': '4' }), 'see o/l#4');
  assert.throws(() => expand('{{nope}}', {}), /unknown placeholder {{nope}}/);
});

// ------------------------------------------------------------------ the checks

const snap = (patch = {}) => ({
  repo: 'o/lib', runner: 'runner',
  issue: { state: 'open', state_reason: null, labels: ['enhancement'], assignees: [] },
  comments: [], pullRequests: [], runs: [], botIssues: [], ...patch,
});
const marked = (workflow, body = 'x', repo = 'o/lib') => ({ author: BOT, body: `${body}\n<!-- gh-aw-workflow-call-id: ${repo}/${workflow} -->` });

test('labels: include, exclude, only and one label per prefix', () => {
  const s = snap({ issue: { state: 'open', labels: ['a', 'complexity/low', 'risk/low', 'risk/high'], assignees: [] } });
  assert.equal(evaluateCheck({ type: 'labels', include: ['a'], exclude: ['b'] }, s).ok, true);
  assert.match(evaluateCheck({ type: 'labels', include: ['z'] }, s).detail, /missing z/);
  assert.match(evaluateCheck({ type: 'labels', exclude: ['a'] }, s).detail, /unexpected a/);
  assert.match(evaluateCheck({ type: 'labels', only: ['a'] }, s).detail, /unexpected complexity\/low, risk\/low, risk\/high/);
  assert.match(evaluateCheck({ type: 'labels', only: ['a', 'q', 'complexity/low', 'risk/low', 'risk/high'] }, s).detail, /missing q/);
  assert.match(evaluateCheck({ type: 'labels', oneWithPrefix: ['risk/'] }, s).detail, /expected one risk\/\* label, found 2/);
  assert.equal(evaluateCheck({ type: 'labels', oneWithPrefix: ['complexity/'] }, s).ok, true);
  assert.match(evaluateCheck({ type: 'labels', oneWithPrefix: ['priority/'] }, s).detail, /found 0/);
});

test('comments: counted per workflow of this repository, by author, and by text', () => {
  const s = snap({ comments: [marked('issue-worker', 'Hello'), marked('issue-worker-extra', 'Another workflow with the same start'), marked('plan-worker', 'A plan'), marked('issue-worker', 'Again', 'o/other'), { author: 'runner', body: 'thanks' }, { author: 'someone', body: `fake <!-- gh-aw-workflow-call-id: o/lib/issue-worker -->` }] });
  assert.equal(evaluateCheck({ type: 'comments', workflow: 'issue-worker', count: 1 }, s).ok, true, 'a marker of another repository, or by another author, does not count');
  assert.match(evaluateCheck({ type: 'comments', workflow: 'issue-worker', count: 2 }, s).detail, /1 issue-worker comments, wanted exactly 2/);
  assert.equal(evaluateCheck({ type: 'comments', workflow: 'plan-worker', match: 'plan', min: 1 }, s).ok, true);
  assert.equal(evaluateCheck({ type: 'comments', workflow: 'plan-worker', match: 'nothing like it', min: 1 }, s).ok, false);
  assert.equal(evaluateCheck({ type: 'comments', workflow: 'plan-worker', max: 0 }, s).ok, false);
  assert.match(evaluateCheck({ type: 'comments', workflow: 'plan-worker', count: 0 }, s).detail, /1 plan-worker comments, wanted exactly 0/, 'too many is wrong too');
  assert.equal(evaluateCheck({ type: 'comments', min: 2 }, s).ok, true, 'comments of the bot, any workflow');
  assert.equal(evaluateCheck({ type: 'comments', from: 'runner', count: 1 }, s).ok, true);
  assert.equal(evaluateCheck({ type: 'comments', from: 'any', count: 6 }, s).ok, true);
});

test('state, pull requests, runs and the bot', () => {
  assert.equal(evaluateCheck({ type: 'state', state: 'closed', reason: 'not_planned' }, snap({ issue: { state: 'closed', state_reason: 'not_planned', labels: [], assignees: [] } })).ok, true);
  assert.match(evaluateCheck({ type: 'state', state: 'closed', reason: 'not_planned' }, snap({ issue: { state: 'closed', state_reason: 'completed', labels: [], assignees: [] } })).detail, /wanted closed \(not_planned\)/);
  assert.equal(evaluateCheck({ type: 'noPullRequest' }, snap()).ok, true);
  assert.match(evaluateCheck({ type: 'noPullRequest' }, snap({ pullRequests: [7] })).detail, /#7/);
  assert.match(evaluateCheck({ type: 'noPullRequest' }, snap({ issue: { state: 'open', labels: [], assignees: ['copilot'] } })).detail, /assigned to copilot/);
  const assigned = (...logins) => snap({ issue: { state: 'open', labels: [], assignees: logins } });
  assert.equal(evaluateCheck({ type: 'noPullRequest' }, assigned('runner')).ok, false, 'by default anyone assigned fails it: no existing scenario changes');
  assert.equal(evaluateCheck({ type: 'noPullRequest', allowAssigned: ['runner'] }, assigned('runner')).ok, true, 'the logins that are allowed may be assigned');
  assert.match(evaluateCheck({ type: 'noPullRequest', allowAssigned: ['runner'] }, assigned('runner')).detail, /no pull request, nobody assigned but runner/);
  assert.equal(evaluateCheck({ type: 'noPullRequest', allowAssigned: ['Runner'] }, assigned('runner')).ok, true, 'logins do not differ by case');
  assert.equal(evaluateCheck({ type: 'noPullRequest', allowAssigned: ['runner'] }, assigned()).ok, true);
  const withAgent = evaluateCheck({ type: 'noPullRequest', allowAssigned: ['runner'] }, assigned('runner', 'copilot-swe-agent[bot]'));
  assert.equal(withAgent.ok, false, 'anyone else, the coding agent above all, still fails it');
  assert.match(withAgent.detail, /assigned to copilot-swe-agent\[bot\]$/, 'and only the one that is not allowed is named');
  assert.equal(evaluateCheck({ type: 'noPullRequest', allowAssigned: ['runner'] }, assigned('someone-else')).ok, false);
  assert.match(evaluateCheck({ type: 'noPullRequest', allowAssigned: ['runner'] }, { ...assigned('runner'), pullRequests: [7] }).detail, /pull requests #7/, 'a pull request fails it whoever is assigned');
  assert.equal(evaluateCheck({ type: 'assignees', only: ['runner'] }, assigned('runner')).ok, true);
  assert.equal(evaluateCheck({ type: 'assignees', only: ['Runner'] }, assigned('runner')).ok, true, 'logins do not differ by case');
  assert.match(evaluateCheck({ type: 'assignees', only: ['runner'] }, assigned('runner', 'copilot')).detail, /unexpected copilot; assigned to runner, copilot/);
  assert.match(evaluateCheck({ type: 'assignees', only: ['runner'] }, assigned()).detail, /missing runner; assigned to none/);
  assert.match(evaluateCheck({ type: 'assignees', only: ['runner'] }, assigned('other')).detail, /unexpected other; missing runner/);
  assert.equal(evaluateCheck({ type: 'assignees', only: [] }, assigned()).ok, true, 'an empty list means nobody');
  assert.equal(evaluateCheck({ type: 'assignees', only: [] }, assigned('runner')).ok, false);
  assert.match(describeSnapshot(assigned('runner')), /; assigned to runner\. /, 'a timeout report says who the issue is assigned to');
  assert.doesNotMatch(describeSnapshot(snap()), /assigned/, 'and says nothing about it when nobody is');
  const runs = (...conclusions) => snap({ runs: conclusions.map(([conclusion, status = 'completed'], i) => ({ name: `run ${i}`, conclusion, status })) });
  assert.equal(evaluateCheck({ type: 'noFailedRuns' }, runs(['success'], ['cancelled'], ['skipped'], [null, 'in_progress'])).ok, true);
  assert.match(evaluateCheck({ type: 'noFailedRuns' }, runs(['success'], ['failure'])).detail, /run 1 \(failure\)/);
  assert.equal(evaluateCheck({ type: 'noFailedRuns' }, runs(['timed_out'])).ok, false);
  assert.equal(evaluateCheck({ type: 'noFailedRuns' }, runs(['startup_failure'])).ok, false);
  assert.equal(evaluateCheck({ type: 'runs', min: 2 }, runs(['success'])).ok, false);
  assert.equal(evaluateCheck({ type: 'runs', min: 1, max: 1 }, runs(['success'])).ok, true);
  assert.equal(evaluateCheck({ type: 'noFailureIssues' }, snap({ botIssues: [{ number: 9, title: '[aw] failed' }] })).ok, false);
  assert.equal(evaluateCheck({ type: 'noBotComments' }, snap({ comments: [marked('x')] })).ok, false);
  assert.equal(evaluateCheck({ type: 'noBotComments' }, snap()).ok, true);
  assert.throws(() => evaluateCheck({ type: 'vibes' }, snap()), /unknown check type "vibes"/);
  assert.ok(CHECK_TYPES.includes('labels'));
  assert.match(describeSnapshot(snap({ comments: [marked('issue-worker')], runs: [{ name: 'Gate', status: 'completed', conclusion: 'success' }] })), /labels enhancement.*bot comments from issue-worker.*Gate: success/);
});

// ------------------------------------------------------------------ one scenario

test('a scenario files a tagged issue, waits for the gates, comments, settles, and leaves nothing open', async () => {
  const wd = world();
  happyGates(wd);
  const started = wd.w.now;
  const result = await runScenario(byId('happy-path-to-the-hold'), 'public', wd.ctx);
  assert.equal(result.status, 'pass', JSON.stringify(result.attempts[0].checks.filter((c) => !c.ok)));
  assert.equal(result.flaky, false);
  assert.equal(result.attempts.length, 1, 'a scenario that passes is not run again');
  assert.ok(wd.w.now - started >= 8 * 60 * 1000, 'the quiet period of the settle step was waited');
  const [issue] = wd.w.issues;
  assert.equal(issue.repo, 'o/e2e-lib');
  assert.match(issue.title, /^\[e2e r1-happy-path-to-the-hold\] listWidgets/);
  assert.match(issue.body, /<!-- e2e-run: e2e r1-happy-path-to-the-hold -->$/);
  assert.deepEqual(issue.comments.filter((c) => c.author === 'runner').map((c) => c.body), ['Thanks, this is what I meant.']);
  assert.equal(issue.state, 'closed');
  assert.equal(issue.state_reason, 'not_planned');
  assert.ok(issue.labels.includes('no-auto-processing'), 'the opt-out is added before the close');
  assert.ok(result.attempts[0].checks.some((c) => c.phase === 'step 5 expect' && c.name === 'still one plan' && c.ok));
});

test('the private profile runs against the private pair', async () => {
  const wd = world();
  happyGates(wd);
  await runScenario(byId('happy-path-to-the-hold'), 'private', wd.ctx);
  assert.equal(wd.w.issues[0].repo, 'o/e2e-lib-private');
});

test('a warning check that is false does not fail the scenario, and is reported', async () => {
  const wd = world();
  happyGates(wd);
  wd.w.onTick = ((inner) => (issue, w) => {
    inner(issue, w);
    if (issue.ticks === 3) issue.comments = issue.comments.map((c) => ({ ...c, body: c.body.replace('Decisions that apply', 'nothing') }));
  })(wd.w.onTick);
  const result = await runScenario(byId('happy-path-to-the-hold'), 'public', wd.ctx);
  assert.equal(result.status, 'pass');
  const warned = result.attempts[0].checks.filter((c) => !c.ok);
  assert.deepEqual(warned.map((c) => [c.name, c.warn]), [['the plan lists the decision records that apply', true]]);
  assert.match(renderSummary([result], { runId: 'r1', owner: 'o' }), /### Warnings \(not failures\)\n- happy-path-to-the-hold \(public\) step 1 wait: the plan lists the decision records/);
});

test('a scenario that gets no answer fails at its deadline, says where the issue stands, and is tried once more', async () => {
  const wd = world();
  const started = wd.w.now;
  const result = await runScenario(byId('out-of-scope-closes'), 'public', wd.ctx);
  assert.equal(result.status, 'fail');
  assert.equal(result.flaky, false, 'two failures are a failure, not flakiness');
  assert.equal(result.attempts.length, 2);
  assert.match(result.attempts[1].issues[0], /issues\/2$/, 'the second attempt files a new issue');
  assert.match(wd.w.issues[1].title, /^\[e2e r1-out-of-scope-closes-r2\]/);
  const timeout = result.attempts[0].checks.find((c) => c.type === 'wait');
  assert.match(timeout.name, /no answer after 20 minutes/);
  assert.match(timeout.detail, /state open; labels enhancement, plan-approval-required.*runs none yet/);
  assert.equal(wd.w.now - started >= 40 * 60 * 1000, true);
  assert.ok(wd.w.issues.every((i) => i.state === 'closed'), 'both attempts are cleaned up');
});

test('a scenario that passes only on the second attempt is flaky, not failed', async () => {
  const wd = world();
  wd.w.onTick = (issue) => {
    if (issue.title.includes('-r2]') && issue.ticks === 2) {
      Object.assign(issue, { state: 'closed', state_reason: 'not_planned' });
      issue.labels.push('out-of-scope');
      gateComment(issue);
      wd.run(issue, 'Issue Concierge 1a ▸ Issue Worker');
    }
  };
  const gateComment = (issue) => wd.gate(issue, 'issue-worker', 'Declined.');
  const result = await runScenario(byId('out-of-scope-closes'), 'public', wd.ctx);
  assert.equal(result.status, 'pass');
  assert.equal(result.flaky, true);
  assert.deepEqual(result.attempts.map((a) => a.status), ['fail', 'pass']);
  assert.match(renderSummary([result], { runId: 'r1', owner: 'o' }), /1 of 1 scenarios passed \(1 only on a second attempt\)/);
});

test('a failed run stops the wait at once, without waiting for the deadline', async () => {
  const wd = world();
  const started = wd.w.now;
  wd.w.onTick = (issue) => {
    if (issue.ticks === 2) wd.run(issue, 'Issue Concierge 1a ▸ Issue Worker', 'failure');
  };
  const result = await runScenario({ ...byId('out-of-scope-closes'), retry: false }, 'public', wd.ctx);
  assert.equal(result.status, 'fail');
  assert.equal(result.attempts.length, 1);
  assert.ok(wd.w.now - started < 5 * 60 * 1000, 'stopped within minutes, not after the 20-minute deadline');
  const names = result.attempts[0].checks.filter((c) => !c.ok).map((c) => c.name);
  assert.deepEqual(names, ['a run failed', 'no run failed'], 'the cause first, and not the checks that wait for an outcome');
});

test('a run, or a failure issue, from before the scenario started is not its business', async () => {
  const wd = world();
  happyGates(wd);
  wd.w.runs.push({ id: 1, name: 'Issue Concierge 1a ▸ Issue Worker', status: 'completed', conclusion: 'failure', created_at: '2026-10-27T09:30:00Z' });
  wd.w.bot.push({ repo: 'o/e2e-lib', number: 50, title: '[aw] earlier failure', created_at: '2026-10-27T09:30:00Z' });
  const result = await runScenario(byId('happy-path-to-the-hold'), 'public', wd.ctx);
  assert.equal(result.status, 'pass');
});

test('a gate run that fails while the scenario runs fails it, although the run says nothing about the issue', async () => {
  const wd = world();
  happyGates(wd);
  const inner = wd.w.onTick;
  wd.w.onTick = (issue, w) => {
    inner(issue, w);
    if (issue.ticks === 2) wd.run(issue, 'Issue Concierge 1a ▸ Issue Worker', 'failure');
  };
  const failed = await runScenario({ ...byId('happy-path-to-the-hold'), retry: false }, 'public', wd.ctx);
  assert.equal(failed.status, 'fail');
  assert.match(failed.attempts[0].checks.find((c) => c.name === 'no run failed').detail, /Issue Concierge 1a ▸ Issue Worker \(failure\)/);
});

test('a failure issue the bot opens while the scenario runs, in either repository of the pair, fails it', async () => {
  for (const repo of ['o/e2e-lib', 'o/e2e-app']) {
    const wd = world();
    happyGates(wd);
    const inner = wd.w.onTick;
    wd.w.onTick = (issue, w) => {
      inner(issue, w);
      if (issue.ticks === 2) wd.w.bot.push({ repo, number: 51, title: '[aw] Issue Worker failed', created_at: new Date(w.now).toISOString() });
    };
    const failed = await runScenario({ ...byId('happy-path-to-the-hold'), retry: false }, 'public', wd.ctx);
    assert.equal(failed.status, 'fail', repo);
    assert.match(failed.attempts[0].checks.find((c) => c.name === 'no failure issue was opened').detail, new RegExp(`${repo}#51 \\[aw\\] Issue Worker failed`));
  }
});

test('the next scenario starts only when the runs that closing the issue started are over', async () => {
  const wd = world();
  happyGates(wd);
  const inner = wd.w.onTick;
  wd.w.onTick = (issue, w) => {
    inner(issue, w);
    if (issue.state === 'closed' && !w.closingRun) {
      w.closingRun = true;
      wd.run(issue, 'Issue Concierge 4a ▸ Janitor', null, 'in_progress');
      w.closingRunTicks = 0;
    } else if (w.closingRun && wd.w.runs.at(-1).status !== 'completed' && ++w.closingRunTicks === 2) {
      Object.assign(wd.w.runs.at(-1), { status: 'completed', conclusion: 'success' });
    }
  };
  await runScenario(byId('happy-path-to-the-hold'), 'public', wd.ctx);
  assert.equal(wd.w.runs.at(-1).status, 'completed', 'the scenario returned only after the janitor run ended');
});

test('an error in the middle still closes what was filed', async () => {
  const wd = world({ failCreateAfter: 1 });
  const result = await runScenario({ ...byId('dependency-then-satisfied'), retry: false }, 'public', wd.ctx);
  assert.equal(result.status, 'error');
  assert.equal(result.attempts[0].error, 'boom');
  assert.equal(wd.w.issues.length, 1);
  assert.equal(wd.w.issues[0].state, 'closed');
});

test('the dependency scenario closes the other issue, then starts the watcher for this one', async () => {
  const wd = world();
  wd.w.onTick = (issue) => {
    if (!issue.title.includes('stop at a maximum depth')) return;
    const dep = wd.w.issues.find((i) => i.title.includes('Define the order'));
    if (dep.state === 'open' && issue.ticks === 2) {
      issue.labels.push('dependency-required');
      wd.run(issue, 'Issue Concierge 1b Issue Triage');
    }
    if (dep.state === 'closed' && !issue.satisfied) {
      issue.satisfied = true;
      issue.labels = issue.labels.filter((l) => l !== 'dependency-required');
      wd.gate(issue, 'plan-worker', 'plan');
    }
  };
  const result = await runScenario(byId('dependency-then-satisfied'), 'public', wd.ctx);
  assert.equal(result.status, 'pass', JSON.stringify(result.attempts[0].checks.filter((c) => !c.ok)));
  const [dep, issue] = wd.w.issues;
  assert.match(issue.body, /^Depends on: o\/e2e-lib#1$/m, 'the dependency line names the issue that was filed first');
  assert.deepEqual(wd.w.dispatches, [{ repo: 'o/e2e-lib', workflow: 'dependency-watch.yml', inputs: { issue_number: String(issue.number) } }]);
  assert.equal(dep.state_reason, 'not_planned', 'cleanup closes it again after the scenario closed it as completed');
});

test('the opt-out scenario adds the hold before it removes the opt-out label', async () => {
  const wd = world();
  const order = [];
  const { addLabels, removeLabel } = wd.gh;
  wd.gh.addLabels = async (repo, n, labels) => { order.push(`add ${labels}`); return addLabels(repo, n, labels); };
  wd.gh.removeLabel = async (repo, n, label) => { order.push(`remove ${label}`); return removeLabel(repo, n, label); };
  wd.w.onTick = (issue) => {
    if (issue.labels.includes('no-auto-processing') || issue.comments.length) return;
    wd.gate(issue, 'issue-worker', 'analysis');
    wd.run(issue, 'Issue Concierge 1a ▸ Issue Worker');
  };
  const result = await runScenario(byId('opt-out-then-hand-over'), 'public', wd.ctx);
  assert.equal(result.status, 'pass', JSON.stringify(result.attempts[0].checks.filter((c) => !c.ok)));
  assert.deepEqual(order.slice(0, 2), ['add plan-approval-required', 'remove no-auto-processing']);
});

test('the quiet period ends only when the runs of the issue have finished, so that a late failure is seen', async () => {
  const wd = world();
  wd.w.onTick = (issue) => {
    if (issue.ticks === 1) wd.run(issue, 'Issue Concierge 1a ▸ Issue Worker', null, 'in_progress'); // still running when the 6 quiet minutes are over
    if (issue.ticks === 3) Object.assign(wd.w.runs[0], { status: 'completed', conclusion: 'failure' });
  };
  const result = await runScenario({ ...byId('opt-out-then-hand-over'), retry: false }, 'public', wd.ctx);
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.attempts[0].checks.filter((c) => !c.ok).map((c) => c.name), ['no run failed'], 'the expect after the quiet period saw the failure');
});

test('an opted-out issue that the Concierge touches fails the scenario', async () => {
  const wd = world();
  wd.w.onTick = (issue) => {
    if (issue.ticks === 1) wd.gate(issue, 'issue-worker', 'I looked anyway');
  };
  const result = await runScenario({ ...byId('opt-out-then-hand-over'), retry: false }, 'public', wd.ctx);
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.attempts[0].checks.filter((c) => !c.ok).map((c) => c.name), ['the Concierge said nothing']);
});

// The runner's own person: a login that no test default and no hard-coded value can be mistaken for.
const PERSON = 'maintainer-7';

/** The Concierge does what record 0043 says: the janitor labels an issue that a person is assigned to, and nothing else happens. */
function assignedGates({ w, run }) {
  w.onTick = (issue) => {
    if (!issue.title.includes('accept a limit') || issue.state !== 'open' || issue.ticks !== 2) return;
    issue.labels.push('no-auto-processing');
    run(issue, 'Issue Concierge 4a ▸ Janitor');
  };
}

test('scenario 13 files its issue assigned to the runner\'s own person, waits for the janitor\'s label, and leaves nothing open', async () => {
  const wd = world();
  wd.ctx.runner = PERSON;
  assignedGates(wd);
  const started = wd.w.now;
  const result = await runScenario(byId('assigned-issue-is-left-alone'), 'public', wd.ctx);
  assert.equal(result.status, 'pass', JSON.stringify(result.attempts[0].checks.filter((c) => !c.ok)));
  assert.equal(result.attempts.length, 1);
  assert.ok(wd.w.now - started >= 6 * 60 * 1000, 'the quiet period was waited');
  assert.deepEqual(wd.w.created, [{ repo: 'o/e2e-lib', title: wd.w.issues[0].title, labels: ['enhancement', 'plan-approval-required'], assignees: [PERSON] }], 'the issue is created with the assignee, in the same call');
  const [issue] = wd.w.issues;
  assert.deepEqual(issue.assignees.map((a) => a.login), [PERSON], 'and is still assigned to them');
  assert.equal(wd.w.userCalls, 0, 'the login is the one the run read once, not read again for the scenario');
  assert.equal(issue.state, 'closed');
  assert.equal(issue.state_reason, 'not_planned');
  assert.ok(issue.labels.includes('no-auto-processing'));
  const checks = result.attempts[0].checks;
  assert.deepEqual(checks.filter((c) => c.type === 'assignees' || c.type === 'noPullRequest').map((c) => [c.type, c.ok, c.detail]), [
    ['assignees', true, `assigned to ${PERSON}`],
    ['noPullRequest', true, `no pull request, nobody assigned but ${PERSON}`],
  ]);
});

test('the runner\'s login is the one the run was given, for every scenario, profile and attempt, never a default or nothing', async () => {
  const wd = world();
  wd.ctx.runner = PERSON;
  assignedGates(wd);
  const scenario = byId('assigned-issue-is-left-alone');
  const results = await runSuite({ scenarios: [scenario, { ...scenario, id: 'again' }], profiles: ['public', 'private'], ctx: wd.ctx });
  assert.ok(results.every((r) => r.status === 'pass'), JSON.stringify(results.map((r) => [r.id, r.profile, r.status])));
  assert.equal(wd.w.created.length, 4);
  assert.deepEqual(wd.w.created.map((c) => c.assignees), [[PERSON], [PERSON], [PERSON], [PERSON]]);
  assert.equal(wd.w.userCalls, 0);
  // a scenario that names the runner, with a runner nobody could read, is an error that closes what was filed, not an issue assigned to "undefined"
  const nobody = world();
  nobody.ctx.runner = '';
  const failed = await runScenario({ ...scenario, retry: false }, 'public', nobody.ctx);
  assert.equal(failed.status, 'error');
  assert.match(failed.attempts[0].error, /cannot assign {{runner}}: the runner does not know whose token it runs/);
  assert.deepEqual(nobody.w.created, [], 'nothing was filed');
});

test('scenario 13 fails when the issue worker starts and comments, because the intake guard did not stop it', async () => {
  const wd = world();
  wd.ctx.runner = PERSON;
  assignedGates(wd);
  const inner = wd.w.onTick;
  wd.w.onTick = (issue, w) => {
    inner(issue, w);
    if (issue.ticks === 3) {
      wd.gate(issue, 'issue-worker', 'I looked at it.');
      wd.run(issue, 'Issue Concierge 1a ▸ Issue Worker');
    }
  };
  const result = await runScenario({ ...byId('assigned-issue-is-left-alone'), retry: false }, 'public', wd.ctx);
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.attempts[0].checks.filter((c) => !c.ok).map((c) => c.name), ['the issue worker left no comment', 'the Concierge said nothing']);
  assert.equal(wd.w.issues[0].state, 'closed', 'cleaned up all the same');
});

test('scenario 13 fails when the janitor never labels the issue, and says who the issue is assigned to', async () => {
  const wd = world();
  wd.ctx.runner = PERSON;
  const started = wd.w.now;
  const result = await runScenario({ ...byId('assigned-issue-is-left-alone'), retry: false }, 'public', wd.ctx);
  assert.equal(result.status, 'fail');
  const timeout = result.attempts[0].checks.find((c) => c.type === 'wait');
  assert.match(timeout.name, /no answer after 8 minutes/);
  assert.match(timeout.detail, new RegExp(`labels enhancement, plan-approval-required; assigned to ${PERSON}`));
  assert.ok(wd.w.now - started < 15 * 60 * 1000);
  assert.equal(wd.w.issues[0].state, 'closed');
  assert.ok(wd.w.issues[0].labels.includes('no-auto-processing'), 'the cleanup labels what the janitor did not');
});

test('scenario 13 fails when the coding agent is assigned, or the person is replaced, or a pull request appears', async () => {
  const cases = [
    ['the coding agent is assigned too', (issue) => issue.assignees.push({ login: 'copilot-swe-agent[bot]', type: 'Bot' }), ['the assignee is still the runner\'s person', 'nothing started coding']],
    ['someone else is assigned instead', (issue) => { issue.assignees = [{ login: 'someone-else', type: 'User' }]; }, ['the assignee is still the runner\'s person', 'nothing started coding']],
    ['nobody is assigned any more', (issue) => { issue.assignees = []; }, ['the assignee is still the runner\'s person']],
    ['a pull request refers to it', (issue) => issue.timeline.push({ event: 'cross-referenced', source: { issue: { number: 9, pull_request: {} } } }), ['nothing started coding']],
  ];
  for (const [what, change, failing] of cases) {
    const wd = world();
    wd.ctx.runner = PERSON;
    assignedGates(wd);
    const inner = wd.w.onTick;
    wd.w.onTick = (issue, w) => {
      inner(issue, w);
      if (issue.ticks === 3) change(issue);
    };
    const result = await runScenario({ ...byId('assigned-issue-is-left-alone'), retry: false }, 'public', wd.ctx);
    assert.equal(result.status, 'fail', what);
    assert.deepEqual(result.attempts[0].checks.filter((c) => !c.ok).map((c) => c.name), failing, what);
  }
});

test('an issue filed with an assignee is closed by the cleanup, the opt-out label first, and the assignee stays', async () => {
  const wd = world();
  const order = [];
  const { addLabels, closeIssue } = wd.gh;
  wd.gh.addLabels = async (repo, n, labels) => { order.push(`add ${labels}`); return addLabels(repo, n, labels); };
  wd.gh.closeIssue = async (repo, n, reason) => { order.push(`close ${reason}`); return closeIssue(repo, n, reason); };
  wd.ctx.runner = PERSON;
  const result = await runScenario({ ...byId('assigned-issue-is-left-alone'), retry: false }, 'public', wd.ctx);
  assert.equal(result.status, 'fail', 'no janitor in this world: the wait times out');
  assert.deepEqual(order, ['add no-auto-processing', 'close not_planned']);
  assert.deepEqual(result.attempts[0].cleanupErrors, []);
  assert.deepEqual(wd.w.issues[0].assignees.map((a) => a.login), [PERSON]);
});

// ------------------------------------------------------------------ the suite and its reports

test('the suite runs each scenario on each profile it names, the pairs side by side and the scenarios of a pair one at a time', async () => {
  const wd = world();
  const openAtFiling = [];
  const { createIssue } = wd.gh;
  wd.gh.createIssue = async (repo, spec) => {
    openAtFiling.push({ repo, open: wd.w.issues.filter((i) => i.repo === repo && i.state === 'open').length });
    return createIssue(repo, spec);
  };
  wd.w.onTick = (issue) => {
    if (issue.title.includes('web dashboard') && issue.ticks === 2) {
      Object.assign(issue, { state: 'closed', state_reason: 'not_planned' });
      issue.labels.push('out-of-scope');
      wd.gate(issue, 'issue-worker', 'Declined.');
      wd.run(issue, 'Issue Concierge 1a ▸ Issue Worker');
    }
  };
  const single = { ...byId('out-of-scope-closes'), profiles: ['public', 'private'] };
  const results = await runSuite({ scenarios: [single, { ...single, id: 'other', profiles: ['private'] }], profiles: ['public', 'private'], ctx: wd.ctx });
  assert.deepEqual(results.map((r) => `${r.id}/${r.profile}`), ['out-of-scope-closes/public', 'out-of-scope-closes/private', 'other/private']);
  assert.equal(results[0].status, 'pass');
  const repos = wd.w.issues.map((i) => i.repo).sort();
  assert.ok(repos.includes('o/e2e-lib') && repos.includes('o/e2e-lib-private'));
  assert.deepEqual(openAtFiling.filter((f) => f.open > 0), [], 'nothing of the pair was still open when the next scenario filed its issue');
});

test('the summary shows each result, the reason for each failure and what cleanup could not close', () => {
  const results = [
    { id: 'a', profile: 'public', status: 'pass', flaky: false, attempts: [{ seconds: 61, issues: ['https://github.com/o/e2e-lib/issues/3'], checks: [], cleanupErrors: [] }] },
    { id: 'b', profile: 'private', status: 'fail', flaky: false, attempts: [{ seconds: 5, issues: [], error: undefined, checks: [{ phase: 'step 1 wait', name: 'one analysis', ok: false, warn: false, detail: '0 issue-worker comments, wanted exactly 1' }], cleanupErrors: ['issue o/x#1: HTTP 403'] }] },
  ];
  const text = renderSummary(results, { runId: 'r9', owner: 'o', pins: { public: 'v1.8.0' } });
  assert.match(text, /## Issue Concierge end-to-end run r9/);
  assert.match(text, /1 of 2 scenarios passed.*public pair pinned at v1\.8\.0/);
  assert.match(text, /\| a \| public \| pass \| 1 \| 61 s \| \[e2e-lib#3\]\(https:\/\/github.com\/o\/e2e-lib\/issues\/3\) \|/);
  assert.match(text, /### b \(private\): fail\n- step 1 wait: \*\*one analysis\*\*: 0 issue-worker comments, wanted exactly 1/);
  assert.match(text, /### Cleanup left something open\n- b \(private\): issue o\/x#1: HTTP 403/);
});

test('stale cleanup closes only old issues of the runner, and marks them opted out first', async () => {
  const wd = world();
  const old = await wd.gh.createIssue('o/e2e-lib', { title: 'old', body: 'x\n<!-- e2e-run: tag -->', labels: [] });
  const fresh = await wd.gh.createIssue('o/e2e-lib', { title: 'new', body: 'x\n<!-- e2e-run: tag -->', labels: [] });
  const human = await wd.gh.createIssue('o/e2e-app', { title: 'human', body: 'a real issue', labels: [] });
  old.created_at = '2026-10-26T00:00:00Z';
  fresh.created_at = '2026-10-27T09:30:00Z';
  human.created_at = '2026-10-20T00:00:00Z';
  const closed = await cleanupStale({ gh: wd.gh, config, owner: 'o', hours: 6, now: () => wd.w.now });
  assert.deepEqual(closed, ['o/e2e-lib#1']);
  assert.ok(old.labels.includes('no-auto-processing'));
  assert.equal(fresh.state, 'open');
  assert.equal(human.state, 'open');
});

test('stale cleanup closes an old issue that a scenario filed assigned to the runner, and leaves an old issue of a person that it did not file', async () => {
  const wd = world();
  const mine = await wd.gh.createIssue('o/e2e-lib', { title: 'assigned', body: 'x\n<!-- e2e-run: tag -->', labels: ['enhancement', 'plan-approval-required'], assignees: [PERSON] });
  const theirs = await wd.gh.createIssue('o/e2e-lib', { title: 'a real one', body: 'someone\'s own work', labels: [], assignees: [PERSON] });
  mine.created_at = '2026-10-26T00:00:00Z';
  theirs.created_at = '2026-10-26T00:00:00Z';
  const closed = await cleanupStale({ gh: wd.gh, config, owner: 'o', hours: 6, now: () => wd.w.now });
  assert.deepEqual(closed, ['o/e2e-lib#1']);
  assert.ok(mine.labels.includes('no-auto-processing'));
  assert.equal(mine.state, 'closed');
  assert.equal(mine.state_reason, 'not_planned');
  assert.equal(theirs.state, 'open');
});

// ------------------------------------------------------------------ the command line

const io = () => {
  const out = [];
  const err = [];
  return { out: (m) => out.push(m), err: (m) => err.push(m), lines: out, errors: err };
};

test('without --yes the command line only prints the plan', async () => {
  const sink = io();
  assert.equal(await main(['--scenario', 'out-of-scope-closes', '--profile', 'private'], { E2E_OWNER: 'acme' }, sink), 0);
  assert.match(sink.lines[0], /^Plan only \(add --yes to run\)\. Sandbox owner acme; retries 1\./);
  assert.deepEqual(sink.lines.slice(1), ['- scenario 3, out-of-scope-closes, on acme/e2e-lib-private (private): A request that matches an explicit exclusion in the project\'s scope is declined and closed as not planned']);
});

test('the plan of a scenario that files an assigned issue says so, and calls nothing: not gh, not the network', async () => {
  const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-no-gh-'));
  const { PATH } = process.env;
  process.env.PATH = emptyPath; // a call to `gh` now fails: the plan must not make one, to read the login or anything else
  try {
    const sink = io();
    assert.equal(await main(['--scenario', '13', '--profile', 'public'], { E2E_OWNER: 'acme' }, sink), 0, sink.errors.join('\n'));
    assert.deepEqual(sink.lines.slice(1), [
      '- scenario 13, assigned-issue-is-left-alone, on acme/e2e-lib (public): ' + byId('assigned-issue-is-left-alone').title,
      '  assigned to the runner (the person whose token runs it, read when run with --yes): issue',
    ]);
    const both = io();
    assert.equal(await main(['--scenario', 'assigned-issue-is-left-alone'], { E2E_OWNER: 'acme' }, both), 0);
    assert.equal(both.lines.filter((l) => l.startsWith('  assigned to the runner')).length, 2, 'once for each pair');
    const plain = io();
    assert.equal(await main(['--scenario', '5'], {}, plain), 0);
    assert.ok(!plain.lines.some((l) => /assigned/.test(l)), 'a scenario that assigns nobody says nothing about it');
  } finally {
    process.env.PATH = PATH;
  }
});

test('a scenario is known by its number, the prefix of its file name: the numbers are 1, 2, 3 ... without gaps or repeats', () => {
  assert.deepEqual(scenarios.map((s) => s.number), scenarios.map((_, i) => i + 1));
  for (const s of scenarios) assert.equal(s.file, `${String(s.number).padStart(2, '0')}-${s.id}.json`, 'the file is named number, hyphen, id');
  assert.throws(() => numberOf('happy-path.json'), /starts with its number and a hyphen/);
  assert.equal(numberOf('07-removal-casual-is-held.json'), 7);
});

test('--scenario takes a number as well as an id, and --list says which number is which', async () => {
  const byNumber = io();
  assert.equal(await main(['--scenario', '10', '--profile', 'public'], { E2E_OWNER: 'acme' }, byNumber), 0);
  assert.match(byNumber.lines[1], /^- scenario 10, command-accepts-a-held-request, on acme\/e2e-lib \(public\): /);
  const mixed = io();
  assert.equal(await main(['--list', '--scenario', '11,2,out-of-scope-closes'], {}, mixed), 0);
  assert.deepEqual(mixed.lines.map((l) => l.split('\t').slice(0, 2).join(' ')), ['2 needs-info-then-details', '3 out-of-scope-closes', '11 command-declines-a-request']);
  const listed = io();
  assert.equal(await main(['--list'], {}, listed), 0);
  assert.ok(listed.lines.some((l) => l.startsWith('10\tcommand-accepts-a-held-request\t')));
  for (const token of ['0', '99', '010x', '-1']) {
    const bad = io();
    assert.equal(await main(['--scenario', token], {}, bad), 2, token);
    assert.match(bad.errors[0], new RegExp(`unknown scenario ${token}`));
  }
});

test('--list shows the scenarios; a mistake is explained and exits with 2', async () => {
  const sink = io();
  assert.equal(await main(['--list'], {}, sink), 0);
  assert.equal(sink.lines.length, scenarios.length);
  assert.match(sink.lines[0], /^1\thappy-path-to-the-hold\tpublic,private\t\d+ steps\t/);
  for (const [argv, message] of [
    [['--scenario', 'ghost'], /unknown scenario ghost/],
    [['--profile', 'moon'], /--profile must be all or one of public, private/],
    [['--retries'], /--retries needs a value/],
    [['stray'], /unexpected argument "stray"/],
  ]) {
    const bad = io();
    assert.equal(await main(argv, {}, bad), 2);
    assert.match(bad.errors[0], message);
  }
});

// ------------------------------------------------------------------ the GitHub wrapper

test('a transient failure is repeated, a missing label is not an error, and a real error says what failed', async () => {
  const calls = [];
  const sleeps = [];
  const answers = [new Error('HTTP 502: Bad Gateway'), '{"number":4}'];
  const run = (args) => {
    calls.push(args.join(' '));
    const next = answers.shift();
    if (next instanceof Error) throw Object.assign(next, { stderr: next.message });
    return next;
  };
  const gh = createGitHub({ run, sleep: async (ms) => sleeps.push(ms) });
  assert.deepEqual(await gh.getIssue('o/r', 4), { number: 4 });
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [2000]);

  const missing = createGitHub({ run: () => { throw Object.assign(new Error('x'), { stderr: 'gh: Label does not exist (HTTP 404)' }); }, sleep: async () => {} });
  await missing.removeLabel('o/r', 1, 'needs info'); // no throw
  const denied = createGitHub({ run: () => { throw Object.assign(new Error('x'), { stderr: 'gh: Forbidden (HTTP 403)\nmore' }); }, sleep: async () => {} });
  await assert.rejects(() => denied.getIssue('o/r', 1), (e) => e.status === 403 && /^GET \/repos\/o\/r\/issues\/1: gh: Forbidden \(HTTP 403\)$/.test(e.message));
  let tries = 0;
  const flaky = createGitHub({ run: () => { tries++; throw Object.assign(new Error('x'), { stderr: 'HTTP 503' }); }, sleep: async () => {}, retries: 2 });
  await assert.rejects(() => flaky.getIssue('o/r', 1), /HTTP 503/);
  assert.equal(tries, 3, 'one call and two repeats, then the error');
  let denials = 0;
  const once = createGitHub({ run: () => { denials++; throw Object.assign(new Error('x'), { stderr: 'HTTP 422' }); }, sleep: async () => {} });
  await assert.rejects(() => once.getIssue('o/r', 1));
  assert.equal(denials, 1, 'an error that is not transient is not repeated');
});

test('an empty or cut-off answer from GitHub is repeated, as the soak of v2.0.0-1 needed (two filings failed in six seconds)', async () => {
  for (const message of ['unexpected end of JSON input', 'unexpected EOF']) {
    const answers = [Object.assign(new Error('x'), { stderr: message }), '{"number":9}'];
    const sleeps = [];
    const gh = createGitHub({ run: () => { const next = answers.shift(); if (next instanceof Error) throw next; return next; }, sleep: async (ms) => sleeps.push(ms) });
    assert.deepEqual(await gh.createIssue('o/r', { title: 't', body: 'b', labels: [] }), { number: 9 }, message);
    assert.deepEqual(sleeps, [2000], message);
  }
  // a message that merely sounds alike is not repeated
  let tries = 0;
  const other = createGitHub({ run: () => { tries++; throw Object.assign(new Error('x'), { stderr: 'HTTP 422: Validation Failed' }); }, sleep: async () => {} });
  await assert.rejects(() => other.createIssue('o/r', { title: 't', body: 'b', labels: [] }));
  assert.equal(tries, 1);
});

test('an issue is created with its assignees in the same request, and without the field when it has none', async () => {
  const bodies = [];
  const gh = createGitHub({ run: (args, input) => { bodies.push({ args, input: JSON.parse(input) }); return '{"number":3}'; }, sleep: async () => {} });
  assert.deepEqual(await gh.createIssue('o/r', { title: 't', body: 'b', labels: ['enhancement'], assignees: ['maintainer-7'] }), { number: 3 });
  assert.deepEqual(bodies[0].input, { title: 't', body: 'b', labels: ['enhancement'], assignees: ['maintainer-7'] });
  assert.deepEqual(bodies[0].args.slice(0, 4), ['api', '-X', 'POST', '/repos/o/r/issues']);
  await gh.createIssue('o/r', { title: 't', body: 'b', labels: [] });
  assert.deepEqual(Object.keys(bodies[1].input), ['title', 'body', 'labels'], 'no assignees key: every other scenario files exactly what it did before');
});

test('lists are flattened from pages, and the shared lists are asked for once in a few seconds', async () => {
  let clock = 0;
  const calls = [];
  const flags = [];
  const run = (args) => {
    calls.push(args[3]);
    flags.push(args.includes('--paginate') && args.includes('--slurp'));
    if (args[3].includes('/actions/runs')) return JSON.stringify([{ workflow_runs: [{ id: 1 }] }, { workflow_runs: [{ id: 2 }] }]);
    if (args[3].includes('creator=')) return JSON.stringify([[{ number: 1, created_at: '2026-10-27T10:05:00Z' }, { number: 2, created_at: '2026-10-27T10:05:00Z', pull_request: {} }, { number: 3, created_at: '2026-10-27T08:00:00Z' }, { number: 4, created_at: '2026-10-27T10:06:00Z', body: `${STATUS_MARKER}\n# Concierge status` }, { number: 5, created_at: '2026-10-01T10:06:00Z', body: `${STATUS_MARKER}\npage` }]]);
    return JSON.stringify([[{ id: 5 }], [{ id: 6 }]]);
  };
  const gh = createGitHub({ run, sleep: async () => {}, now: () => clock, cacheMs: 20000 });
  assert.deepEqual((await gh.listComments('o/r', 1)).map((c) => c.id), [5, 6]);
  assert.deepEqual(flags, [true], 'a list asks for every page, as one array');
  assert.deepEqual((await gh.listRuns('o/r', '2026-10-27T10:00:00Z')).map((r) => r.id), [1, 2]);
  await gh.listRuns('o/r', '2026-10-27T10:00:00Z');
  clock += 5000;
  await gh.listRuns('o/r', '2026-10-27T10:00:00Z');
  assert.equal(calls.filter((c) => c.includes('/actions/runs')).length, 1, 'cached');
  clock += 20000;
  await gh.listRuns('o/r', '2026-10-27T10:00:00Z');
  assert.equal(calls.filter((c) => c.includes('/actions/runs')).length, 2, 'asked again after the cache expired');
  assert.deepEqual((await gh.listBotIssues('o/r', '2026-10-27T10:00:00Z')).map((i) => i.number), [1], 'pull requests, older issues and the status issue are dropped');
  assert.deepEqual(await gh.findStatusIssue('o/r'), { number: 4, body: `${STATUS_MARKER}\n# Concierge status` }, 'the status issue is found by its marker');
  assert.match(calls.find((c) => c.includes('/actions/runs')), /created=%3E%3D2026-10-27T10%3A00%3A00Z/);
  assert.match(calls.find((c) => c.includes('creator=')), /creator=github-actions%5Bbot%5D/);
});

test('the sandbox\'s status issue is the page under either marker: the runner finds it, and does not count it as a failure issue', async () => {
  assert.deepEqual([STATUS_MARKER, LEGACY_STATUS_MARKER], ['<!-- issue-concierge:status -->', '<!-- concierge:status -->']);
  assert.equal(STATUS_MARKER, PAGE_MARKER, 'the runner and the page write the same line');
  assert.equal(isStatusPage(`${STATUS_MARKER}\nx`), true);
  assert.equal(isStatusPage(`${LEGACY_STATUS_MARKER}\nx`), true);
  assert.equal(isStatusPage('an [aw] failure'), false);
  assert.equal(isStatusPage(undefined), false);
  for (const marker of [STATUS_MARKER, LEGACY_STATUS_MARKER]) {
    const run = (args) => JSON.stringify([[
      { number: 4, created_at: '2026-10-27T10:06:00Z', body: `${marker}\n# page` },
      { number: 6, created_at: '2026-10-27T10:07:00Z', body: 'an [aw] failure' },
    ]]);
    const gh = createGitHub({ run, sleep: async () => {}, now: () => 0, cacheMs: 0 });
    assert.deepEqual((await gh.listBotIssues('o/r', '2026-10-27T10:00:00Z')).map((i) => i.number), [6], marker);
    assert.equal((await gh.findStatusIssue('o/r')).number, 4, marker);
  }
});

test('the scenarios\' patterns for the Concierge\'s own comments match both spellings, so a sandbox that is part way through the rename still passes', () => {
  const scenarios = fs.readdirSync(new URL('./e2e/scenarios/', import.meta.url)).map((f) => JSON.parse(fs.readFileSync(new URL(`./e2e/scenarios/${f}`, import.meta.url), 'utf8')));
  const patterns = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      if (typeof v.match === 'string' && /concierge:/.test(v.match)) patterns.push(v.match);
      Object.values(v).forEach(walk);
    }
  };
  walk(scenarios);
  assert.ok(patterns.length >= 5, 'the scenarios do check the options and the accepted comments');
  for (const pattern of patterns) {
    const name = /concierge:([a-z]+)/.exec(pattern)[1];
    const kind = /kind=([a-z.]+)/.exec(pattern)?.[1] ?? 'decision';
    const sample = (prefix) => `<!-- ${prefix}concierge:${name} kind=${kind} -->\n\`/accept\` \`/decline [reason]\` \`/approve\``;
    assert.match(sample(''), new RegExp(pattern), `the older line: ${pattern}`);
    assert.match(sample('issue-'), new RegExp(pattern), `the new line: ${pattern}`);
  }
});

// ------------------------------------------------------------------ the status issue

test('the runner and the status script mark the page with the same line', () => {
  assert.equal(STATUS_MARKER, PAGE_MARKER);
});

test('lastComment: the last comment of the issue must match, or must not', () => {
  const s = (...bodies) => ({ repo: 'o/lib', runner: 'runner', issue: { state: 'open', state_reason: null, labels: [], assignees: [] }, comments: bodies.map((body, i) => ({ author: i % 2 ? BOT : 'runner', authorType: 'User', body })), pullRequests: [], runs: [], botIssues: [] });
  assert.equal(evaluateCheck({ type: 'lastComment', match: 'concierge:options kind=decision' }, s('hello', '<!-- concierge:options kind=decision -->')).ok, true);
  assert.equal(evaluateCheck({ type: 'lastComment', match: 'concierge:options' }, s('<!-- concierge:options -->', 'a reply')).ok, false, 'it is not last');
  assert.equal(evaluateCheck({ type: 'lastComment', match: 'concierge:options', absent: true }, s('<!-- concierge:options -->', 'a reply')).ok, true);
  assert.equal(evaluateCheck({ type: 'lastComment', match: 'x' }, s()).ok, false);
  assert.match(evaluateCheck({ type: 'lastComment', match: 'x' }, s('hello')).detail, /the last comment \(by runner\) does not match \/x\/, which it must/);
});

test('statusIssue: the page must match, or must not, and a repository without one fails the check', () => {
  const page = { number: 7, body: `${STATUS_MARKER}\n## Needs you (1)\n- #12 Remove the widgets command · waiting under 1 h\n` };
  const snap2 = (statusIssue) => ({ repo: 'o/lib', runner: 'runner', issue: { state: 'open', state_reason: null, labels: [], assignees: [] }, comments: [], pullRequests: [], runs: [], botIssues: [], statusIssue });
  assert.equal(evaluateCheck({ type: 'statusIssue', match: '\\n- #12 ' }, snap2(page)).ok, true);
  assert.equal(evaluateCheck({ type: 'statusIssue', match: '\\n- #13 ' }, snap2(page)).ok, false);
  assert.equal(evaluateCheck({ type: 'statusIssue', match: '\\n- #13 ', absent: true }, snap2(page)).ok, true);
  assert.equal(evaluateCheck({ type: 'statusIssue', match: '\\n- #12 ', absent: true }, snap2(page)).ok, false);
  const none = evaluateCheck({ type: 'statusIssue', match: 'x' }, snap2(null));
  assert.equal(none.ok, false);
  assert.match(none.detail, /there is no status issue yet/);
  assert.match(evaluateCheck({ type: 'statusIssue', match: '\\n- #13 ' }, snap2(page)).detail, /status issue #7 does not match .*, which it must/);
});

test('the version a sandbox repository is pinned at is read from the new pin file, or from the old one before the repository has been updated', async () => {
  const gh = (files) => ({ readFile: async (repo, file) => { if (!(file in files)) throw new Error(`HTTP 404 ${file}`); return files[file]; } });
  assert.equal(await readPinText(gh({ '.github/issue-concierge.yml': 'version: v2.1.0\n', '.github/concierge.yml': 'version: v2.0.1\n' }), 'o/r'), 'version: v2.1.0\n');
  assert.equal(await readPinText(gh({ '.github/concierge.yml': 'version: v2.0.1\n' }), 'o/r'), 'version: v2.0.1\n');
  await assert.rejects(readPinText(gh({}), 'o/r'), /HTTP 404 \.github\/concierge\.yml/);
});
