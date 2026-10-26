import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT,
  LABEL_GATE,
  MAX_GATE_LABEL_EVENTS,
  MIN_AGE_MINUTES,
  decide,
  ghList,
  isLaterGateComment,
  isWorkerAnalysis,
  prefilter,
  progressEvidence,
  resume,
} from './stalled-issue-sweep.mjs';
import { TRIAGE_OUTCOMES } from './janitor.mjs';

// frodo-lib#803, the canonical issue of frodo-cli#919 (2026-10-24): the issue worker's first run ended on the
// turn limit, its second posted the analysis and asked for `issue-worker-ready` with confidence MEDIUM, which was
// held back as a suggestion. The issue carried only the hold and `original-in-related-repo`, and sat outside the
// pipeline until a maintainer added the label by hand. The sweep does that by code.

const REPO = 'rockcarver/frodo-lib';
const NOW = Date.parse('2026-10-26T12:00:00Z');
const minutesAgo = (m) => new Date(NOW - m * 60 * 1000).toISOString();
const issue = (labels, extra = {}) => ({
  number: 803,
  state: 'open',
  user: { login: 'vscheuber', type: 'User' },
  labels: labels.map((name) => ({ name })),
  assignees: [],
  ...extra,
});
const analysis = (minutes, repo = REPO) => ({
  user: { login: BOT },
  created_at: minutesAgo(minutes),
  body: `Thanks for the detailed report.\n\n<!-- gh-aw-workflow-call-id: ${repo}/issue-worker -->`,
});
const gateEvent = (minutes) => ({ event: 'labeled', label: { name: LABEL_GATE }, created_at: minutesAgo(minutes) });
const facts = (extra = {}) => ({ comments: [analysis(120)], events: [], openPulls: [], ...extra });
const opts = { thisRepo: REPO, now: NOW };

test('the #803 case: analysed, held, classified by nobody, gate label never took effect: gives it again', () => {
  const v = decide(issue(['plan-approval-required', 'original-in-related-repo']), facts({ events: [gateEvent(119)] }), opts);
  assert.equal(v.reenter, true);
  assert.equal(v.hadLabel, false);
  assert.match(v.reason, /never took effect/);
});

test('the hold alone is not progress: a routed issue starts held, before any gate has run on it', () => {
  assert.equal(progressEvidence(new Set(['plan-approval-required'])), null);
  assert.equal(progressEvidence(new Set(['original-in-related-repo', 'bug', 'priority/p2'])), null, 'a quality label is not an outcome of triage');
});

test('an issue whose gate label is still there but never concluded gets it again, removed first', () => {
  const v = decide(issue([LABEL_GATE]), facts(), opts);
  assert.deepEqual([v.reenter, v.hadLabel], [true, true]);
});

test('every outcome of issue triage, a later gate label, a classification or the coding agent is progress: left alone', () => {
  for (const label of [...TRIAGE_OUTCOMES, 'plan-worker-ready', 'plan-triage-handoff', 'complexity/low', 'complexity/high', 'risk/medium']) {
    const v = decide(issue([label]), facts(), opts);
    assert.equal(v.reenter, false, label);
    assert.match(v.reason, /already past issue triage/, label);
  }
  assert.equal(decide(issue([], { assignees: [{ login: 'Copilot' }] }), facts(), opts).reenter, false);
  assert.equal(decide(issue([], { assignees: [{ login: 'vscheuber' }] }), facts(), opts).reenter, true, 'a person assigned is not a hand-off');
});

test('never looks at what no gate runs for: pull requests, closed issues, bot issues, originals, opted-out issues', () => {
  assert.match(prefilter(issue([], { pull_request: {} })).reason, /pull request/);
  assert.match(prefilter(issue([], { state: 'closed' })).reason, /closed/);
  assert.match(prefilter(issue([], { user: { login: 'dependabot[bot]', type: 'Bot' } })).reason, /bot/);
  assert.match(prefilter(issue(['related-repo'])).reason, /another repository/);
  assert.match(prefilter(issue(['no-auto-processing', 'plan-approval-required'])).reason, /no-auto-processing/);
  assert.equal(prefilter(issue(['plan-approval-required'])), null);
});

test('needs an analysis of the issue worker of this repository to point issue triage at', () => {
  assert.match(decide(issue([]), facts({ comments: [] }), opts).reason, /has not posted an analysis/);
  const human = { user: { login: 'vscheuber' }, created_at: minutesAgo(120), body: `<!-- gh-aw-workflow-call-id: ${REPO}/issue-worker -->` };
  assert.equal(decide(issue([]), facts({ comments: [human] }), opts).reenter, false, 'a person quoting the marker is no analysis');
  assert.equal(decide(issue([]), facts({ comments: [analysis(120, 'rockcarver/frodo-cli')] }), opts).reenter, false, 'the other repository\'s worker wrote the first comment of a canonical issue');
  assert.equal(isWorkerAnalysis(analysis(5), REPO), true);
});

test('a comment of a later gate is progress: on a held issue the janitor takes the gate labels away within seconds (#803 while its plan was classified)', () => {
  const gateComment = (name, repo = REPO, login = BOT) => ({ user: { login }, created_at: minutesAgo(40), body: `## Plan\n\n<!-- gh-aw-workflow-call-id: ${repo}/${name} -->` });
  for (const name of ['issue-triage', 'plan-worker', 'plan-triage', 'pr-worker', 'pr-triage']) {
    const v = decide(issue(['plan-approval-required']), facts({ comments: [analysis(120), gateComment(name)] }), opts);
    assert.equal(v.reenter, false, name);
    assert.match(v.reason, /a later gate has commented/, name);
  }
  assert.equal(isLaterGateComment(gateComment('plan-worker'), REPO), true);
  assert.equal(isLaterGateComment(gateComment('plan-worker', 'rockcarver/frodo-cli'), REPO), false, 'the other repository\'s gates are not this issue\'s');
  assert.equal(isLaterGateComment(gateComment('plan-worker', REPO, 'vscheuber'), REPO), false, 'a person quoting a marker is no gate');
  assert.equal(isLaterGateComment(gateComment('issue-worker'), REPO), false, 'the issue worker is the gate being healed');
  assert.equal(decide(issue(['plan-approval-required']), facts({ comments: [analysis(120), gateComment('plan-worker', 'rockcarver/frodo-cli')] }), opts).reenter, true);
});

test('an open pull request that closes the issue means nothing is to be planned', () => {
  const v = decide(issue([]), facts({ openPulls: [{ number: 12, state: 'OPEN' }] }), opts);
  assert.equal(v.reenter, false);
  assert.match(v.reason, /open pull request/);
});

test('waits for a run of issue triage that can still be on its way: the analysis and the gate label both count', () => {
  assert.equal(decide(issue([]), facts({ comments: [analysis(MIN_AGE_MINUTES - 5)] }), opts).reenter, false);
  assert.equal(decide(issue([]), facts({ comments: [analysis(MIN_AGE_MINUTES + 5)] }), opts).reenter, true);
  assert.equal(decide(issue([]), facts({ comments: [analysis(300)], events: [gateEvent(MIN_AGE_MINUTES - 5)] }), opts).reenter, false, 'a recent gate label');
  // A named issue is asked for by a person who has seen it.
  assert.equal(decide(issue([]), facts({ comments: [analysis(5)] }), { ...opts, minAgeMinutes: 0 }).reenter, true);
});

test('gives up after two re-entries: a person must look, the sweep does not loop', () => {
  const since = (n) => Array.from({ length: n }, (_, i) => gateEvent(110 - i * 10));
  assert.equal(decide(issue([]), facts({ events: since(MAX_GATE_LABEL_EVENTS - 1) }), opts).reenter, true);
  const v = decide(issue([]), facts({ events: since(MAX_GATE_LABEL_EVENTS) }), opts);
  assert.equal(v.reenter, false);
  assert.match(v.reason, /a person must look/);
});

test('gate labels from before the last analysis do not count towards the limit', () => {
  const comments = [analysis(600), analysis(120)];
  const events = [gateEvent(599), gateEvent(500), gateEvent(400), gateEvent(119)];
  assert.equal(decide(issue([]), facts({ comments, events }), opts).reenter, true);
});

test('the gate label the worker adds just before its comment counts as part of the same analysis', () => {
  const events = [gateEvent(121), gateEvent(119), gateEvent(100)];
  assert.equal(decide(issue([]), facts({ events }), opts).reenter, false, 'three events: the one a minute before the comment counts');
});

test('resume removes the label first when it is there, adds it, and does nothing else', () => {
  const calls = [];
  const ctx = { ...opts, removeLabel: (l) => calls.push(['remove', l]), addLabel: (l) => calls.push(['add', l]) };
  resume(issue([LABEL_GATE]), facts(), ctx);
  assert.deepEqual(calls, [['remove', LABEL_GATE], ['add', LABEL_GATE]]);
  calls.length = 0;
  resume(issue(['plan-approval-required']), facts(), ctx);
  assert.deepEqual(calls, [['add', LABEL_GATE]], 'the hold is never touched, and there is no comment function at all');
});

test('resume changes nothing for an issue it leaves alone, and nothing in a dry run', () => {
  const calls = [];
  const ctx = { ...opts, removeLabel: (l) => calls.push(l), addLabel: (l) => calls.push(l) };
  resume(issue(['backlog']), facts(), ctx);
  resume(issue([]), facts(), { ...ctx, dryRun: true });
  assert.deepEqual(calls, []);
});

test('ghList reads every page and gives up on a page it cannot read', () => {
  const page = (n, size) => ({ status: 200, data: Array.from({ length: size }, (_, i) => n * 1000 + i) });
  const pages = { 1: page(1, 3), 2: page(2, 3), 3: page(3, 1) };
  const seen = [];
  const get = (path) => { seen.push(path); return pages[Number(path.match(/&page=(\d+)/)[1])]; };
  assert.equal(ghList('repos/o/r/issues?state=open', 't', { get, perPage: 3 }).length, 7);
  assert.match(seen[0], /issues\?state=open&per_page=3&page=1$/);
  assert.equal(ghList('repos/o/r/issues/1/events', 't', { get: () => ({ status: 403, data: null }) }), null);
});
