import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Who may start when (docs/multi-phase-design.md, "Who may start when"). A closed issue starts no gate,
// and an issue that an open pull request already closes is not handed to the coding agent. Origin:
// frodo-cli#887 was fixed and closed by a merged pull request, and the PR worker still assigned the coding
// agent to the closed issue, which opened a redundant pull request (#897): the hand-off started while the
// fix (#896) was open, the merge closed the issue at 22:24:36, the assignment landed at 22:25:06.
//
// Layer 1, deterministic: the `if:` of each gate and the PR worker's `existing_fix` pre-activation step.
// Layer 2, wording: the Issue Worker stops the chain earlier when it finds the open pull request.

const REPO = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, REPO), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const split = (md) => {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'frontmatter not found');
  return { frontmatter: m[1], body: m[2] };
};
/** The workflow-level `if:` (single line or folded `>-` block), flattened. */
const ifOf = (fm) => {
  const m = fm.match(/^if: ([\s\S]*?)(?=^\S)/m);
  assert.ok(m, 'workflow-level if: not found');
  return flat(m[1]);
};

const WORKFLOWS = fs.readdirSync(new URL('workflows/', REPO)).filter((f) => f.endsWith('.md'));
const wf = (name) => split(read(`workflows/${name}.md`));

// ---- Closed issues start no gate ----------------------------------------------------------------------

for (const name of ['issue-triage', 'plan-worker', 'plan-triage', 'pr-worker']) {
  test(`${name}: a closed issue starts nothing (payload condition in the workflow if:)`, () => {
    assert.match(ifOf(wf(name).frontmatter), /github\.event\.issue\.state == 'open'/);
  });
}

test("issue-worker: a closed issue is not analyzed, except on a maintainer's dispatch", () => {
  const cond = ifOf(wf('issue-worker').frontmatter);
  assert.match(cond, /\(github\.event_name == 'workflow_dispatch' \|\| github\.event\.issue\.state == 'open'\)/);
  // the bot and pull-request guards are still there
  assert.match(cond, /github\.event\.issue\.user\.type != 'Bot'/);
  assert.match(cond, /github\.event\.comment\.user\.type != 'Bot'/);
  assert.match(cond, /github\.event\.issue\.pull_request == null/);
});

for (const name of ['waiting-for-release', 'release-closer']) {
  test(`${name}: acts on closed issues on purpose and must not require an open one`, () => {
    assert.doesNotMatch(wf(name).frontmatter, /issue\.state == 'open'/);
  });
}

test('every workflow is covered by one of the two groups above (a new gate must decide)', () => {
  const decided = new Set([
    'issue-triage', 'plan-worker', 'plan-triage', 'pr-worker', 'issue-worker',
    // the related-repo closer is a plain workflow now (tools/related-repo-closer-workflow.test.mjs)
    'waiting-for-release', 'release-closer',
    // pull-request gate: keyed by a pull request label, not by an issue
    'pr-triage',
  ]);
  for (const f of WORKFLOWS) {
    assert.ok(decided.has(f.replace(/\.md$/, '')), `${f}: decide whether a closed issue may start it (docs "Who may start when")`);
  }
});

// ---- PR worker: the existing_fix pre-activation step ----------------------------------------------------

const prWorker = wf('pr-worker');

test('pr-worker: the hand-off is blocked when the existing_fix step failed, and only then', () => {
  assert.match(ifOf(prWorker.frontmatter), /needs\.pre_activation\.outputs\.existing_fix_result != 'failure'/);
});

test('pr-worker: the guard step runs in pre-activation, never blocks the job itself, and only for its own label', () => {
  const fm = prWorker.frontmatter;
  assert.match(fm, /^ {2}steps:\n/m, 'on.steps');
  assert.match(fm, /id: existing_fix\n/);
  // outcome `failure` is what the `if:` reads; continue-on-error keeps the job green (no red run, no failure report)
  assert.match(fm, /id: existing_fix\n\s+if: github\.event\.label\.name == 'plan-triage-handoff' && github\.event\.issue\.state == 'open'\n\s+continue-on-error: true\n/);
  assert.match(fm, /uses: actions\/github-script@v9/);
  // the pre-activation job needs write access only to post the one comment, read access to see pull requests
  assert.match(fm, /^ {2}permissions:\n {4}issues: write\n {4}pull-requests: read\n/m);
});

test('pr-worker stays static: it reads no issue content and opts into no untrusted-content policy', () => {
  assert.doesNotMatch(prWorker.frontmatter, /min-integrity/);
  assert.doesNotMatch(prWorker.frontmatter, /^tools:/m);
  assert.match(prWorker.body, /Do not read the issue, its comments or its labels/);
});

// ---- The guard script, run against stubbed GitHub objects -----------------------------------------------

const scriptOf = (fm) => {
  const lines = fm.split('\n');
  const at = lines.findIndex((l) => /^ {8}script: \|$/.test(l));
  assert.ok(at >= 0, 'script block of the existing_fix step not found');
  const out = [];
  for (const l of lines.slice(at + 1)) {
    if (l !== '' && !l.startsWith(' '.repeat(10))) break;
    out.push(l.slice(10));
  }
  return out.join('\n');
};
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const guard = new AsyncFunction('github', 'context', 'core', scriptOf(prWorker.frontmatter));

async function runGuard({ number = 887, graphql, createComment } = {}) {
  const seen = { failed: [], warnings: [], comments: [], queries: [], removed: [] };
  const core = { setFailed: (m) => seen.failed.push(m), warning: (m) => seen.warnings.push(m) };
  const github = {
    graphql: async (query, vars) => {
      seen.queries.push({ query, vars });
      return graphql(query, vars);
    },
    rest: {
      issues: {
        createComment: async (c) => {
          seen.comments.push(c);
          if (createComment) return createComment(c);
        },
        removeLabel: async (c) => {
          seen.removed.push(c.name);
        },
      },
    },
  };
  const context = { repo: { owner: 'octo', repo: 'app' }, payload: { issue: { number } } };
  try {
    await guard(github, context, core);
  } catch (error) {
    seen.thrown = error;
  }
  return seen;
}
const answer = (state, prs = [], labels = []) => async () => ({
  repository: {
    issue: { state, labels: { nodes: labels.map((name) => ({ name })) }, closedByPullRequestsReferences: { nodes: prs } },
  },
});

test('guard: an open issue with no closing pull request passes silently', async () => {
  const seen = await runGuard({ graphql: answer('OPEN') });
  assert.deepEqual([seen.failed, seen.comments, seen.warnings], [[], [], []]);
  assert.equal(seen.thrown, undefined);
});

test('guard: asks GitHub for open pull requests only, for this repository and issue', async () => {
  const seen = await runGuard({ number: 42, graphql: answer('OPEN') });
  assert.equal(seen.queries.length, 1);
  assert.match(seen.queries[0].query, /closedByPullRequestsReferences\(first: \d+, includeClosedPrs: false\)/);
  assert.deepEqual(seen.queries[0].vars, { owner: 'octo', repo: 'app', number: 42 });
});

test('guard: an open pull request that closes the issue blocks the hand-off and says why', async () => {
  const seen = await runGuard({ graphql: answer('OPEN', [{ number: 896, state: 'OPEN' }]) });
  assert.equal(seen.failed.length, 1);
  assert.match(seen.failed[0], /#896 already closes #887/);
  assert.equal(seen.comments.length, 1);
  assert.equal(seen.comments[0].issue_number, 887);
  assert.match(seen.comments[0].body, /#896 is already open and will close this issue when it merges/);
  // the blocked hand-off is void: its label goes, so handing the issue on again starts a fresh run
  assert.deepEqual(seen.removed, ['plan-triage-handoff']);
  // the comment is plain language: no internal terms
  assert.doesNotMatch(seen.comments[0].body, /label|gate|handoff|worker/i);
});

test('guard: every open closing pull request is named', async () => {
  const seen = await runGuard({ graphql: answer('OPEN', [{ number: 10, state: 'OPEN' }, { number: 12, state: 'OPEN' }]) });
  assert.match(seen.comments[0].body, /#10, #12/);
});

test('guard: a merged or closed pull request is not an open fix', async () => {
  const seen = await runGuard({ graphql: answer('OPEN', [{ number: 5, state: 'MERGED' }, { number: 6, state: 'CLOSED' }]) });
  assert.deepEqual([seen.failed, seen.comments], [[], []]);
});

test('guard (the race): the issue was closed after the label event was created, the live state wins', async () => {
  // the payload said "open"; the merge closed the issue seconds before the run started
  const seen = await runGuard({ graphql: answer('CLOSED') });
  assert.equal(seen.failed.length, 1);
  assert.match(seen.failed[0], /#887 is closed: nothing to hand on/);
  assert.deepEqual(seen.comments, [], 'a closed issue is left alone: no comment');
});

test('guard: when GitHub cannot be asked it warns and lets the hand-off through (no silent stall)', async () => {
  const seen = await runGuard({
    graphql: async () => {
      throw new Error('rate limited');
    },
  });
  assert.deepEqual([seen.failed, seen.comments], [[], []]);
  assert.equal(seen.warnings.length, 1);
  assert.match(seen.warnings[0], /rate limited/);
});

test('guard: a failing comment still blocks (the evidence stands)', async () => {
  const seen = await runGuard({
    graphql: answer('OPEN', [{ number: 896, state: 'OPEN' }]),
    createComment: async () => {
      throw new Error('forbidden');
    },
  });
  assert.ok(seen.thrown, 'the step fails, so its outcome is failure and the hand-off is blocked');
});

// ---- Issue Worker wording (second layer) ---------------------------------------------------------------

test('issue worker: an open pull request that closes the issue is reported and nothing is handed on', () => {
  const body = flat(wf('issue-worker').body);
  assert.match(body, /### A fix is already in review Search the open pull requests for one that closes this issue/);
  assert.match(body, /Add no gate label \(see Signaling\)/);
  assert.match(body, /- If an open pull request already closes the issue \(see "A fix is already in review"\): add no label at all, not even `issue-worker-ready`\./);
  // the old rule stays: an open pull request is never evidence that something is fixed
  assert.match(body, /An open pull request, or one closed without merging, is never evidence that something is fixed\./);
});

// ---- Docs -----------------------------------------------------------------------------------------------

test('docs explain who may start when, and the guard', () => {
  const design = read('docs/multi-phase-design.md');
  assert.match(design, /^## Who may start when$/m);
  assert.match(design, /existing_fix/);
  assert.match(design, /closed by a merged pull request/);
  assert.match(read('docs/deployment.md'), /already closes the issue/);
});
