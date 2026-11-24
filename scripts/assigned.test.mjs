import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LABEL_OPT_OUT } from './opt-out.mjs';
import { decide, handledByPerson, isBotAssignee, isPerson, main, run } from './assigned.mjs';

// A maintainer who assigns an issue to a person has said that person handles it (decision 0043). The Concierge then gives the issue
// `no-auto-processing`, with the workflow token so that no event follows. The hazard that shapes every case below: when the PR worker
// assigns the coding agent with a personal token, GitHub assigns the OWNER of that token as well, in the same second (measured on two
// issues of a deployment, 2026-11), and `/retry` unassigns only the agent. A person among the assignees is therefore not
// enough: no bot may be among them, and the issue must not have an outcome of the plan gate (plan triage's hand-off or its
// classification), which is on the issue when the Concierge assigns the agent.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PERSON = { login: 'maint', type: 'User' };
const COLLEAGUE = { login: 'colleague', type: 'User' };
const AGENT = { login: 'Copilot', type: 'Bot' };

const issue = ({ labels = [], assignees = [PERSON], state = 'open', ...extra } = {}) => ({
  number: 7,
  state,
  labels: labels.map((name) => ({ name })),
  assignees,
  user: { login: 'reporter', type: 'User' },
  ...extra,
});

// ------------------------------------------------------------------ who counts

test('a person is an account of type User, and nothing else is', () => {
  assert.equal(isPerson(PERSON), true);
  for (const a of [AGENT, { login: 'github-actions[bot]', type: 'Bot' }, { login: 'org', type: 'Organization' }, { login: 'mannequin', type: 'Mannequin' }, { login: 'no-type' }, null, undefined]) assert.equal(isPerson(a), false, JSON.stringify(a));
});

test('a bot is an account of type Bot, or the coding agent by its name when the type is missing', () => {
  assert.equal(isBotAssignee(AGENT), true);
  assert.equal(isBotAssignee({ login: 'dependabot[bot]', type: 'Bot' }), true);
  for (const login of ['Copilot', 'copilot-swe-agent', 'copilot-swe-agent[bot]']) assert.equal(isBotAssignee({ login }), true, `${login} without a type`);
  assert.equal(isBotAssignee(PERSON), false);
  assert.equal(isBotAssignee({ login: 'copilot-fan', type: 'User' }), false, 'a person whose name starts with copilot is a person');
  assert.equal(isBotAssignee({ login: 'a-person' }), false, 'no type and no agent name: not a bot, and not a person either');
});

test('handled by a person: a person among the assignees and no bot among them', () => {
  assert.equal(handledByPerson([PERSON]), true);
  assert.equal(handledByPerson([PERSON, COLLEAGUE]), true);
  assert.equal(handledByPerson([]), false);
  assert.equal(handledByPerson(undefined), false);
  assert.equal(handledByPerson([AGENT]), false, 'only the agent');
  assert.equal(handledByPerson([PERSON, AGENT]), false, 'the co-assignee case: the person GitHub adds with the agent');
  assert.equal(handledByPerson([AGENT, PERSON]), false, 'whichever order the two are listed in');
  assert.equal(handledByPerson([PERSON, { login: 'dependabot[bot]', type: 'Bot' }]), false, 'a bot that is not the agent');
});

// ------------------------------------------------------------------ the table of cases

test('a person assigned, no bot, no outcome of the plan gate, issue open: the label is added', () => {
  assert.deepEqual(decide(issue()).label, true);
  assert.equal(decide(issue({ assignees: [PERSON, COLLEAGUE] })).label, true);
  assert.equal(decide(issue({ labels: ['bug', 'enhancement'] })).label, true, 'other labels do not matter');
  assert.equal(decide(issue({ labels: ['issue-worker-ready', 'issue-triage-handoff', 'plan-worker-ready'] })).label, true, 'a gate that has not reached the plan has no outcome yet');
  assert.equal(decide(issue({ labels: ['plan-approval-required'] })).label, true, 'a hold is not an outcome: a routed issue starts held');
  assert.equal(decide(issue({ user: { login: 'github-actions[bot]', type: 'Bot' } })).label, true, 'who wrote the issue does not matter, the assignee does');
});

test('a person and the coding agent assigned (the co-assignee case): nothing, whatever the order of the two events', () => {
  // The two `assigned` events of one hand-off (the agent, then the token's owner a second later) each read the issue as it is, and it
  // has the same assignees whichever event started the run.
  for (const assignees of [[AGENT, PERSON], [PERSON, AGENT]]) {
    for (const labels of [[], ['plan-triage-handoff', 'complexity/low', 'risk/low'], ['complexity/low', 'risk/low']]) {
      const v = decide(issue({ assignees, labels }));
      assert.equal(v.label, false, `${assignees.map((a) => a.login)} with ${labels}`);
      assert.match(v.reason, /bot/);
    }
  }
});

test('only the agent assigned: nothing', () => {
  assert.equal(decide(issue({ assignees: [AGENT] })).label, false);
  assert.match(decide(issue({ assignees: [AGENT] })).reason, /bot/);
  assert.equal(decide(issue({ assignees: [] })).label, false);
  assert.match(decide(issue({ assignees: [] })).reason, /no person/);
  assert.equal(decide({ number: 1, state: 'open', labels: [] }).label, false, 'no assignees field at all');
});

test('an outcome of the plan gate stops it: the hand-off, a complexity label or a risk label', () => {
  for (const label of ['plan-triage-handoff', 'complexity/low', 'complexity/high', 'risk/medium', 'risk/high']) {
    const v = decide(issue({ labels: ['bug', label] }));
    assert.equal(v.label, false, label);
    assert.ok(v.reason.includes(label), `the reason names ${label}: ${v.reason}`);
  }
  assert.equal(decide(issue({ labels: ['complexity/low', 'risk/low', 'plan-triage-handoff'] })).label, false, 'all of them');
});

test('an issue that carries the label already gets no second write', () => {
  const v = decide(issue({ labels: [LABEL_OPT_OUT] }));
  assert.equal(v.label, false);
  assert.match(v.reason, new RegExp(LABEL_OPT_OUT));
});

test('a closed issue, and a pull request: nothing', () => {
  assert.equal(decide(issue({ state: 'closed' })).label, false);
  assert.match(decide(issue({ state: 'closed' })).reason, /closed/);
  assert.equal(decide(issue({ pull_request: { url: 'https://api.github.com/repos/o/r/pulls/7' } })).label, false);
  assert.match(decide(issue({ pull_request: {} })).reason, /pull request/);
  assert.equal(decide(null).label, false, 'an issue that cannot be found');
});

test('a bot other than the agent among the assignees: nothing', () => {
  assert.equal(decide(issue({ assignees: [PERSON, { login: 'dependabot[bot]', type: 'Bot' }] })).label, false);
  assert.equal(decide(issue({ assignees: [{ login: 'dependabot[bot]', type: 'Bot' }] })).label, false);
});

test('an assignee of another kind is not a person: nothing', () => {
  assert.equal(decide(issue({ assignees: [{ login: 'someone' }] })).label, false);
  assert.equal(decide(issue({ assignees: [{ login: 'org', type: 'Organization' }] })).label, false);
});

// ------------------------------------------------------------------ one run

/** A fake of the two calls and the log. `issueOf` is what the live read gives. */
function fake(issueOf, { failRead, failWrite } = {}) {
  const calls = { writes: [], reads: [], log: [] };
  return {
    calls,
    ctx: {
      get: async (n) => {
        calls.reads.push(n);
        if (failRead) throw new Error(failRead);
        return typeof issueOf === 'function' ? issueOf(n) : issueOf;
      },
      addLabel: async (n, label) => {
        if (failWrite) throw new Error(failWrite);
        calls.writes.push([n, label]);
      },
      log: (line) => calls.log.push(line),
    },
  };
}

test('run: reads the issue live, writes the label once, and says so', async () => {
  const f = fake(issue());
  const v = await run({ number: 7 }, f.ctx);
  assert.equal(v.label, true);
  assert.deepEqual(f.calls.reads, [7]);
  assert.deepEqual(f.calls.writes, [[7, LABEL_OPT_OUT]]);
  assert.equal(f.calls.log.length, 1);
  assert.match(f.calls.log[0], new RegExp(`^#7: labelled ${LABEL_OPT_OUT} \\(`));
});

test('run: the co-assignee case writes nothing, and the log says why', async () => {
  const f = fake(issue({ assignees: [PERSON, AGENT], labels: ['plan-triage-handoff'] }));
  await run({ number: 7 }, f.ctx);
  assert.deepEqual(f.calls.writes, []);
  assert.match(f.calls.log[0], /^#7: skipped \(/);
});

test('run: the decision is read from the live issue, not from the event: an agent that arrived after the event stops the write', async () => {
  // The event said "a person was assigned". By the time the job runs the agent is assigned too.
  const f = fake(issue({ assignees: [PERSON, AGENT] }));
  await run({ number: 7 }, f.ctx);
  assert.deepEqual(f.calls.writes, []);
});

test('run: a dry run decides and writes nothing', async () => {
  const f = fake(issue());
  const v = await run({ number: 7, dryRun: true }, f.ctx);
  assert.equal(v.label, true);
  assert.deepEqual(f.calls.writes, []);
  assert.match(f.calls.log[0], /would label/);
});

test('run: an issue that is gone is skipped, not an error', async () => {
  const f = fake(null);
  const v = await run({ number: 7 }, f.ctx);
  assert.equal(v.label, false);
  assert.deepEqual(f.calls.writes, []);
});

test('run: a failed read writes nothing on a guess, and a failed write is reported with the issue and the label', async () => {
  const unreadable = fake(issue(), { failRead: 'HTTP 502' });
  await assert.rejects(run({ number: 7 }, unreadable.ctx), /#7: could not read the issue: HTTP 502; nothing was written/);
  assert.deepEqual(unreadable.calls.writes, []);
  const unwritable = fake(issue(), { failWrite: 'HTTP 403' });
  await assert.rejects(run({ number: 7 }, unwritable.ctx), new RegExp(`#7: could not add ${LABEL_OPT_OUT}.*HTTP 403`));
});

// ------------------------------------------------------------------ main

test('main: exits 0 after a write and after a skip, 1 for a failure, and says what failed', async () => {
  const out = [];
  const log = (l) => out.push(l);
  const env = { GITHUB_REPOSITORY: 'o/r', ISSUE_NUMBER: '7', GH_TOKEN: 't' };
  assert.equal(await main([], env, fake(issue()).ctx, log), 0);
  assert.equal(await main([], env, fake(issue({ assignees: [PERSON, AGENT] })).ctx, log), 0);
  out.length = 0;
  assert.equal(await main([], env, fake(issue(), { failRead: 'HTTP 502' }).ctx, log), 1);
  assert.match(out.join('\n'), /^::error::#7: could not read the issue: HTTP 502/);
  out.length = 0;
  assert.equal(await main([], env, fake(issue(), { failWrite: 'HTTP 403' }).ctx, log), 1);
  assert.match(out.join('\n'), /^::error::#7: could not add no-auto-processing: HTTP 403/);
});

test('main: needs the repository and an issue number, and writes nothing without them', async () => {
  const out = [];
  const f = fake(issue());
  for (const env of [{}, { GITHUB_REPOSITORY: 'o/r' }, { GITHUB_REPOSITORY: 'o/r', ISSUE_NUMBER: 'x' }, { GITHUB_REPOSITORY: 'o/r', ISSUE_NUMBER: '0' }, { ISSUE_NUMBER: '7' }]) {
    assert.equal(await main([], env, f.ctx, (l) => out.push(l)), 1, JSON.stringify(env));
  }
  assert.deepEqual(f.calls.reads, []);
  assert.deepEqual(f.calls.writes, []);
  assert.ok(out.every((l) => l.startsWith('::error::')));
});

test('main: --dry-run and DRY_RUN write nothing', async () => {
  const env = { GITHUB_REPOSITORY: 'o/r', ISSUE_NUMBER: '7' };
  for (const [argv, e] of [[['--dry-run'], env], [[], { ...env, DRY_RUN: 'true' }]]) {
    const f = fake(issue());
    assert.equal(await main(argv, e, f.ctx, () => {}), 0);
    assert.deepEqual(f.calls.writes, []);
  }
});

// ------------------------------------------------------------------ the module

test('the script writes only the opt-out label, with the token it is given, and reads the issue it is told about', () => {
  const source = fs.readFileSync(path.join(HERE, 'assigned.mjs'), 'utf8');
  assert.doesNotMatch(source, /SIGNAL_TOKEN/, 'the workflow token, so that no event follows');
  assert.deepEqual([...source.matchAll(/--method', '(\w+)'/g)].map((m) => m[1]), ['POST'], 'the one write is the label');
  assert.match(source, /import \{[^}]*\bLABEL_OPT_OUT\b[^}]*\} from '\.\/opt-out\.mjs'/, 'the label is the one the other scripts share');
  assert.match(source, /import \{[^}]*\bplanGateOutcome\b[^}]*\} from '\.\/janitor\.mjs'/, 'the plan-gate evidence is the janitor\'s, not a copy');
});
