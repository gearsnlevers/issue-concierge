import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// What went wrong on frodo-cli#923 (run 40117831485, 2026-10-24): a maintainer closed the issue by hand as
// already fixed on main (closed as completed, no closing pull request) and `Concierge 4c Waiting for Release`
// started. The run (model `small`, max-turns 6) made 12 GitHub calls: it read the same issue four times and
// the same pull request (#703, the fix that had landed weeks earlier) four times, searched repositories for
// nothing, searched pull requests by commit, read a commit and the releases, then the engine answered
// HTTP 429, the retries counted against the cap, "Maximum LLM invocations exceeded", and with no safe output
// gh-aw filed a failure issue (frodo-cli#927). Nothing was harmed, but nothing was waiting for a release,
// and the gate spent its budget on it.
//
// Two layers (docs/multi-phase-design.md, "Which closes count"):
// 1. Deterministic, no model: a pre-activation step reads the live `closed` event and fails on purpose when
//    nobody closed the issue with a pull request or a commit, or it was closed as not planned or as a
//    duplicate; the workflow `if:` reads that outcome. A lookup that cannot be made never blocks the agent.
// 2. The prompt: a call budget equal to `max-turns`, each lookup made once, `noop` instead of more research.
// The step's script is executed here with a fake GitHub client, so the decision matrix is pinned as behaviour.

const REPO = new URL('..', import.meta.url);
const SOURCE = fs.readFileSync(new URL('workflows/waiting-for-release.md', REPO), 'utf8');
const parts = (md) => {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'frontmatter not found');
  return { frontmatter: m[1], body: m[2] };
};
const { frontmatter: FM, body } = parts(SOURCE);
/** What the agent sees: the body with HTML comments removed, as gh-aw renders it. */
const PROMPT = body.replace(/<!--[\s\S]*?-->/g, '');
const flat = (s) => s.replace(/\s+/g, ' ');
const number = (re, text = FM) => {
  const m = text.match(re);
  assert.ok(m, `${re} not found`);
  return Number(m[1]);
};

/** The `script: |` block of the pre-activation step, dedented. */
const scriptOf = (fm) => {
  const lines = fm.split('\n');
  const start = lines.findIndex((l) => /^\s+script: \|$/.test(l));
  assert.ok(start >= 0, 'the pre-activation script was not found');
  const indent = lines[start].match(/^\s*/)[0].length + 2;
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() === '') { out.push(''); continue; }
    if (l.match(/^\s*/)[0].length < indent) break;
    out.push(l.slice(indent));
  }
  return out.join('\n');
};
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = async ({ nodes, throws, user = 'someone' }) => {
  const log = { failed: [], warned: [], info: [] };
  const github = {
    graphql: async () => {
      if (throws) throw new Error(throws);
      return { repository: { issue: { timelineItems: { nodes } } } };
    },
  };
  const core = {
    setFailed: (m) => log.failed.push(m),
    warning: (m) => log.warned.push(m),
    info: (m) => log.info.push(m),
  };
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { issue: { number: 7, user: { login: user } } } };
  await new AsyncFunction('github', 'context', 'core', scriptOf(FM))(github, context, core);
  return log;
};
const closed = (stateReason, closer) => [{ stateReason, closer }];

test('the gate has 8 turns, 8 credits and 5 minutes: room for retries after an HTTP 429, still cheap', () => {
  // Measured: a normal run is about 4 model calls and 0.6 to 0.7 AIC (frodo-cli#887: 0.714); 8 turns keep the
  // 1 AIC per turn allowance the 6-turn / 6-credit setting had, and 5 minutes match the Issue Worker (the failed
  // run used about 2.5 of its 3 minutes before the cap stopped it).
  assert.equal(number(/^max-turns: (\d+)$/m), 8);
  assert.equal(number(/^max-ai-credits: (\d+)$/m), 8);
  assert.equal(number(/^timeout-minutes: (\d+)$/m), 5);
  assert.match(FM, /^  model: small$/m, 'the gate stays on the small model');
});

test('the prompt states a call budget equal to max-turns and says what to do when it runs short', () => {
  const turns = number(/^max-turns: (\d+)$/m);
  assert.equal(number(/You have (\d+) model calls in all/, PROMPT), turns);
  assert.match(PROMPT, /a retry after an error counts as one/);
  const m = PROMPT.match(/If you have used (\d+) of your (\d+) calls and have not found a merged pull request/);
  assert.ok(m, 'the fallback sentence is missing');
  assert.equal(Number(m[2]), turns, 'the fallback names the same budget');
  assert.equal(Number(m[1]), turns - 2, 'the fallback leaves two calls for the retries');
  assert.match(flat(PROMPT), /call `noop` and stop\. Never keep researching\./);
});

test('every lookup is made once and nothing is searched for nothing', () => {
  const p = flat(PROMPT);
  assert.match(p, /Do not call `search_repositories`/);
  assert.match(p, /never read the same issue or pull request twice/);
  assert.match(p, /Read the issue once \(`issue_read`/);
  assert.match(p, /one `search_pull_requests` query/);
  assert.match(p, /Read that pull request once \(`pull_request_read`/);
  assert.match(p, /Do not read its files, reviews, comments or diff/);
  assert.match(p, /Read the releases once \(`list_releases`, 5 at most\)/);
  assert.match(p, /already released: call `noop` and stop/);
});

test('the comment and the label for the normal case are unchanged', () => {
  assert.match(PROMPT, /Add the label `waiting-for-release`\./);
  assert.match(PROMPT, /"Fixed in \{pr\}\. Waiting for a release that includes this\."/);
  assert.match(PROMPT, /Do not mention labels or internal terms in the comment\./);
  assert.match(FM, /^    allowed:\n      - waiting-for-release$/m);
  assert.match(FM, /add-comment:\n    max: 1/);
});

test('an issue closed by hand costs no model call: the workflow if: reads the pre-activation outcome', () => {
  const ifm = FM.match(/^if: ([\s\S]*?)(?=^\S)/m);
  assert.ok(ifm, 'workflow-level if: not found');
  const cond = flat(ifm[1]);
  assert.match(cond, /github\.event\.issue\.user\.type != 'Bot'/);
  assert.match(cond, /needs\.pre_activation\.outputs\.closed_by_merge_result != 'failure'/);
  assert.match(FM, /^      id: closed_by_merge$/m);
  assert.match(FM, /^      continue-on-error: true$/m, 'the step fails on purpose without failing the job');
  assert.doesNotMatch(FM, /issue\.state == 'open'/, 'this gate acts on closed issues on purpose');
});

test('the pre-activation job reads only: no write permission and no secret', () => {
  const on = FM.match(/^on:\n([\s\S]*?)^engine:/m);
  assert.ok(on, 'on: block not found');
  assert.match(on[1], /permissions:\n    issues: read\n    pull-requests: read/);
  assert.doesNotMatch(on[1], /: write\b/);
  assert.doesNotMatch(on[1], /secrets\./);
});

test('behaviour: merged pull request and commit closers go on to the agent', async () => {
  for (const closer of [
    { __typename: 'PullRequest', number: 703, merged: true },
    { __typename: 'Commit', oid: 'abc123' },
  ]) {
    const log = await run({ nodes: closed('COMPLETED', closer) });
    assert.deepEqual(log.failed, [], `${closer.__typename} must not stop the gate`);
  }
});

test('behaviour: closed by hand, as not planned, as a duplicate, or by an unmerged pull request stops the gate', async () => {
  const stops = [
    ['by hand (frodo-cli#923)', closed('COMPLETED', null)],
    ['not planned', closed('NOT_PLANNED', { __typename: 'PullRequest', number: 1, merged: true })],
    ['duplicate', closed('DUPLICATE', { __typename: 'PullRequest', number: 1, merged: true })],
    ['not planned and by hand', closed('NOT_PLANNED', null)],
    ['unmerged pull request', closed('COMPLETED', { __typename: 'PullRequest', number: 2, merged: false })],
  ];
  for (const [what, nodes] of stops) {
    const log = await run({ nodes });
    assert.equal(log.failed.length, 1, `${what} must fail the step so the if: skips the agent`);
  }
});

test('behaviour: doubt never blocks the agent (a failed lookup, or no closing event yet)', async () => {
  const failedLookup = await run({ throws: 'HTTP 502' });
  assert.deepEqual(failedLookup.failed, []);
  assert.equal(failedLookup.warned.length, 1);
  const noEvent = await run({ nodes: [] });
  assert.deepEqual(noEvent.failed, []);
  assert.equal(noEvent.warned.length, 1);
});

test('the prompt also tells the agent to skip hand closes, as a second layer when the lookup was not possible', () => {
  const p = flat(PROMPT);
  assert.match(p, /A step before you already skipped the issues that nobody closed with a pull request or a commit/);
  assert.match(p, /or by hand with no pull request\), do nothing: call `noop`/);
});
