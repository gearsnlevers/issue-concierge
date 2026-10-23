import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decide, decideSweep, run, LABEL } from './pr-ready-signal.mjs';

const pr = (extra = {}) => ({ number: 7, state: 'open', merged: false, user: { login: 'Copilot' }, labels: [], ...extra });
const ev = (event, at, label = null) => ({ event, at: `2026-10-22T${at}Z`, label });
const started = (at) => ev('copilot_work_started', at);
const finished = (at) => ev('copilot_work_finished', at);
const readyLabeled = (at) => ev('labeled', at, LABEL);

// ------------------------------------------------------------ the sweep rule

test('a finished session is signalled once it has finished', () => {
  const v = decideSweep({ pr: pr(), events: [started('13:21:10'), finished('14:06:14')] });
  assert.equal(v.add, true);
  assert.match(v.reason, /finished at 2026-10-22T14:06:14Z/);
});

test('nothing is signalled before the agent has finished a session, or while it works again', () => {
  assert.deepEqual(decideSweep({ pr: pr(), events: [] }), { add: false, reason: 'the agent has not finished a session yet' });
  assert.deepEqual(decideSweep({ pr: pr(), events: [started('13:21:10')] }), { add: false, reason: 'the agent has not finished a session yet' });
  assert.deepEqual(decideSweep({ pr: pr(), events: [started('13:21:10'), finished('14:06:14'), started('16:02:17')] }), { add: false, reason: 'the agent is working again' });
});

test('a finish that was already signalled is not signalled again, even after the janitor removed the label', () => {
  const events = [started('13:21:10'), finished('14:06:14'), readyLabeled('14:15:00')];
  assert.deepEqual(decideSweep({ pr: pr(), events }), { add: false, reason: 'this finish was already signalled' });
});

test('a feedback round that finishes again is signalled again', () => {
  const events = [started('13:21:10'), finished('14:06:14'), readyLabeled('14:15:00'), started('16:02:17'), finished('16:18:36')];
  assert.equal(decideSweep({ pr: pr(), events }).add, true);
});

test('a label applied before the finish (an early signal) does not hide the real finish', () => {
  // the agent asked for review, or someone labelled, at 13:50 and went on working until 14:06
  const events = [started('13:21:10'), readyLabeled('13:50:51'), finished('14:06:14')];
  assert.equal(decideSweep({ pr: pr(), events }).add, true);
});

test('the label being present, or the pull request not being the agent\'s or not open, means nothing to do', () => {
  const done = [started('13:21:10'), finished('14:06:14')];
  assert.equal(decideSweep({ pr: pr({ labels: [{ name: LABEL }] }), events: done }).reason, 'already signalled');
  assert.equal(decideSweep({ pr: pr({ user: { login: 'vscheuber' } }), events: done }).add, false);
  assert.equal(decideSweep({ pr: pr({ state: 'closed' }), events: done }).add, false);
  assert.equal(decideSweep({ pr: pr({ merged: true, state: 'closed' }), events: done }).add, false);
  assert.equal(decideSweep({ pr: null, events: done }).add, false);
});

test('timestamps compare in time order whatever order the events arrive in', () => {
  const events = [finished('14:06:14'), readyLabeled('14:15:00'), started('13:21:10'), finished('16:18:36'), started('16:02:17')];
  assert.equal(decideSweep({ pr: pr(), events }).add, true);
});

// ------------------------------------------------------- the direct triggers

test('a maintainer\'s ready for review, or a manual run, signals an open coding agent pull request once', () => {
  assert.deepEqual(decide({ pr: pr(), trigger: 'ready_for_review' }), { add: true, reason: 'ready_for_review' });
  assert.deepEqual(decide({ pr: pr(), trigger: 'manual' }), { add: true, reason: 'manual' });
  assert.equal(decide({ pr: pr({ labels: [{ name: LABEL }] }), trigger: 'manual' }).reason, 'already signalled');
  assert.equal(decide({ pr: pr({ user: { login: 'dependabot[bot]' } }), trigger: 'manual' }).add, false);
  assert.equal(decide({ pr: pr({ state: 'closed' }), trigger: 'manual' }).add, false);
  assert.equal(decide({ pr: null, trigger: 'manual' }).add, false);
});

// --------------------------------------------------------------------- run

function fake({ pulls = [], timelines = {}, single } = {}) {
  const calls = { added: [], logs: [], timelineFor: [] };
  return {
    calls,
    ctx: {
      getPull: async (n) => (single === undefined ? pulls.find((p) => p.number === n) || null : single),
      listOpenPulls: async () => pulls,
      timeline: async (n) => (calls.timelineFor.push(n), timelines[n] || []),
      addLabel: async (n) => calls.added.push(n),
      log: (l) => calls.logs.push(l),
    },
  };
}

test('a sweep labels only the pull requests whose agent has finished and not yet been signalled', async () => {
  const f = fake({
    pulls: [pr({ number: 1 }), pr({ number: 2 }), pr({ number: 3 }), pr({ number: 4, user: { login: 'vscheuber' } }), pr({ number: 5, labels: [{ name: LABEL }] })],
    timelines: {
      1: [started('13:21:10'), finished('14:06:14')],            // finished, not signalled
      2: [started('13:21:10')],                                  // still working
      3: [started('13:21:10'), finished('14:06:14'), readyLabeled('14:20:00')], // already signalled
    },
  });
  const results = await run({ trigger: 'sweep' }, f.ctx);
  assert.deepEqual(f.calls.added, [1]);
  assert.deepEqual(f.calls.timelineFor, [1, 2, 3]); // not the human's pull request, not the labelled one
  assert.equal(results.filter((r) => r.add).length, 1);
  assert.match(f.calls.logs.join('\n'), /#1: added pr-worker-ready \(the agent finished at/);
  assert.match(f.calls.logs.join('\n'), /#2: skipped .*working|#2: skipped .*not finished/);
});

test('a sweep with nothing to look at says so and changes nothing', async () => {
  const f = fake();
  assert.deepEqual(await run({ trigger: 'sweep' }, f.ctx), []);
  assert.match(f.calls.logs[0], /No open coding agent pull requests/);
  assert.deepEqual(f.calls.added, []);
});

test('a sweep in a dry run reports and adds nothing', async () => {
  const f = fake({ pulls: [pr({ number: 1 })], timelines: { 1: [started('13:21:10'), finished('14:06:14')] } });
  await run({ trigger: 'sweep', dryRun: true }, f.ctx);
  assert.deepEqual(f.calls.added, []);
  assert.match(f.calls.logs[0], /would add/);
});

test('a numbered run signals that pull request directly, without reading the timeline', async () => {
  const f = fake({ pulls: [pr({ number: 12 })] });
  const results = await run({ number: 12, trigger: 'ready_for_review' }, f.ctx);
  assert.deepEqual(f.calls.added, [12]);
  assert.deepEqual(f.calls.timelineFor, []);
  assert.equal(results[0].add, true);
});

test('a numbered run on a missing or ineligible pull request adds nothing', async () => {
  assert.equal((await run({ number: 9, trigger: 'manual' }, fake().ctx))[0].add, false);
  const f = fake({ pulls: [pr({ number: 3, user: { login: 'vscheuber' } })] });
  assert.equal((await run({ number: 3, trigger: 'manual' }, f.ctx))[0].add, false);
  assert.deepEqual(f.calls.added, []);
});

// ----------------------------------------------------------- the workflow

const code = () => fs.readFileSync(new URL('../workflows/pr-ready-signal.yml', import.meta.url), 'utf8').replace(/^#.*$/gm, '');

test('the workflow sweeps every 15 minutes and keeps the human and manual triggers', () => {
  const y = code();
  assert.match(y, /schedule:\s*\n\s*- cron: "\*\/15 \* \* \* \*"/);
  assert.match(y, /pull_request_target:\s*\n\s*types: \[ready_for_review\]/);
  assert.match(y, /workflow_dispatch:/);
  assert.match(y, /pr_number:[\s\S]*?required: false/); // empty means sweep
});

test('the dead and approval-gated triggers are gone', () => {
  const y = code();
  assert.equal(/workflow_run:/.test(y), false);
  assert.equal(/review_requested/.test(y), false);
});

test('the label goes on with the signal token, which is how PR triage starts', () => {
  const y = code();
  assert.match(y, /SIGNAL_TOKEN: \$\{\{ secrets\.SIGNAL_TOKEN \}\}/);
  assert.match(y, /node \.github\/scripts\/pr-ready-signal\.mjs/);
});
