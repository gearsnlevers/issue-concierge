import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// A hold put on by hand (docs/multi-phase-design.md, "Human interaction" and "Who may start when").
// Origin: frodo-cli#885 carried `plan-approval-required`, added by the maintainer to read the plan first.
// Plan triage classified it (complexity/low, risk/medium) and emitted `plan-triage-handoff` anyway, because
// its prompt withheld the hand-off only for its own high classification; the PR worker's `if:` checked only
// `dependency-required`, so the run started (it was cancelled before an assignment); and the stale hand-off
// label would have made `plan-approval-resume` answer "already handed off" once the hold was removed.
//
// The guarantee is deterministic and sits at the one gate that causes code: the PR worker's `if:` and its
// `existing_fix` step (which also removes the void hand-off label). The prompt is the first layer, the
// resume script makes removing the hold work for any classified issue (scripts/plan-approval-resume.test.mjs).

const REPO = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, REPO), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const split = (md) => {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'frontmatter not found');
  return { frontmatter: m[1], body: m[2] };
};
const ifOf = (fm) => {
  const m = fm.match(/^if: ([\s\S]*?)(?=^\S)/m);
  assert.ok(m, 'workflow-level if: not found');
  return flat(m[1]);
};
const rawSection = (body, heading) => {
  const m = body.match(new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
  assert.ok(m, `section "${heading}" not found`);
  return m[1];
};

const prWorker = split(read('workflows/pr-worker.md'));
const triage = split(read('workflows/plan-triage.md'));

// ---- PR worker: the payload condition -----------------------------------------------------------------

test('pr-worker: the hold and the dependency label are both in the activation if:, with the older guards', () => {
  const cond = ifOf(prWorker.frontmatter);
  assert.match(cond, /!contains\(github\.event\.issue\.labels\.\*\.name, 'plan-approval-required'\)/);
  assert.match(cond, /!contains\(github\.event\.issue\.labels\.\*\.name, 'dependency-required'\)/);
  assert.match(cond, /github\.event\.issue\.state == 'open'/);
  assert.match(cond, /github\.event\.issue\.user\.type != 'Bot'/);
  assert.match(cond, /needs\.pre_activation\.outputs\.existing_fix_result != 'failure'/);
});

test('pr-worker: the step is still the guard for the hand-off label only, and may now remove it', () => {
  const fm = prWorker.frontmatter;
  assert.match(fm, /id: existing_fix\n\s+if: github\.event\.label\.name == 'plan-triage-handoff' && github\.event\.issue\.state == 'open' && !contains\(github\.event\.issue\.labels\.\*\.name, 'no-auto-processing'\)\n\s+continue-on-error: true\n/);
  // the pre-activation job needs write access to remove the void label and post the one comment
  assert.match(fm, /^ {2}permissions:\n {4}issues: write\n {4}pull-requests: read\n/m);
});

test('pr-worker stays static: it still reads no issue content', () => {
  assert.doesNotMatch(prWorker.frontmatter, /min-integrity/);
  assert.match(prWorker.body, /not held for a person's approval \(`plan-approval-required`\)/);
  assert.match(prWorker.body, /Do not read the issue, its comments or its labels/);
});

// ---- PR worker: the live check, run against stubbed GitHub objects -------------------------------------

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

async function run({ number = 885, state = 'OPEN', labels = [], prs = [], graphqlError, removeError, noLabelsField = false } = {}) {
  const seen = { failed: [], warnings: [], comments: [], removed: [] };
  const core = { setFailed: (m) => seen.failed.push(m), warning: (m) => seen.warnings.push(m) };
  const github = {
    graphql: async (query) => {
      if (graphqlError) throw graphqlError;
      const issue = { state, closedByPullRequestsReferences: { nodes: prs } };
      // GitHub answers only what the query asks for: the labels come back only when it requests them.
      if (!noLabelsField && /labels\(first: \d+\) \{ nodes \{ name \} \}/.test(query)) {
        issue.labels = { nodes: labels.map((name) => ({ name })) };
      }
      return { repository: { issue } };
    },
    rest: {
      issues: {
        createComment: async (c) => {
          seen.comments.push(c);
        },
        removeLabel: async (c) => {
          if (removeError) throw removeError;
          seen.removed.push(c);
        },
      },
    },
  };
  try {
    await guard(github, { repo: { owner: 'octo', repo: 'app' }, payload: { issue: { number } } }, core);
  } catch (error) {
    seen.thrown = error;
  }
  return seen;
}

test('guard: a hold added by hand blocks the hand-off, silently, and the void hand-off label is removed', async () => {
  const seen = await run({ labels: ['bug', 'complexity/low', 'risk/medium', 'plan-approval-required'] });
  assert.equal(seen.failed.length, 1);
  assert.match(seen.failed[0], /#885 carries `plan-approval-required`: a person must remove it before the issue is handed on\./);
  assert.deepEqual(seen.removed, [{ owner: 'octo', repo: 'app', issue_number: 885, name: 'plan-triage-handoff' }]);
  assert.deepEqual(seen.comments, [], 'a hold is a person\'s decision: no comment');
});

test('guard: a dependency label blocks the same way, and both are named when both are there', async () => {
  const one = await run({ labels: ['dependency-required'] });
  assert.match(one.failed[0], /carries `dependency-required`:/);
  assert.deepEqual(one.removed.map((c) => c.name), ['plan-triage-handoff']);
  const both = await run({ labels: ['plan-approval-required', 'dependency-required'] });
  assert.match(both.failed[0], /carries `plan-approval-required` and `dependency-required`:/);
});

test('guard: the hold wins over an open pull request (no comment about the pull request)', async () => {
  const seen = await run({ labels: ['plan-approval-required'], prs: [{ number: 896, state: 'OPEN' }] });
  assert.equal(seen.failed.length, 1);
  assert.match(seen.failed[0], /plan-approval-required/);
  assert.deepEqual(seen.comments, []);
});

test('guard: other labels do not block, and nothing is removed', async () => {
  const seen = await run({ labels: ['bug', 'backlog', 'needs-info', 'scope-review', 'related-repo', 'dependency-satisfied', 'complexity/low'] });
  assert.deepEqual([seen.failed, seen.removed, seen.comments, seen.warnings], [[], [], [], []]);
  assert.equal(seen.thrown, undefined);
});

test('guard: a closed issue is reported as closed and nothing is touched, hold or not', async () => {
  const seen = await run({ state: 'CLOSED', labels: ['plan-approval-required'] });
  assert.match(seen.failed[0], /#885 is closed: nothing to hand on/);
  assert.deepEqual([seen.removed, seen.comments], [[], []]);
});

test('guard: an open pull request voids the hand-off label as well, then comments', async () => {
  const seen = await run({ prs: [{ number: 896, state: 'OPEN' }] });
  assert.deepEqual(seen.removed.map((c) => c.name), ['plan-triage-handoff']);
  assert.equal(seen.comments.length, 1);
  assert.match(seen.failed[0], /#896 already closes #885/);
});

test('guard: the label is already gone (404): the block stands without a warning', async () => {
  const removeError = Object.assign(new Error('Label does not exist'), { status: 404 });
  const seen = await run({ labels: ['plan-approval-required'], removeError });
  assert.equal(seen.failed.length, 1);
  assert.deepEqual(seen.warnings, []);
});

test('guard: any other failure to remove the label warns, and the block still stands', async () => {
  const removeError = Object.assign(new Error('forbidden'), { status: 403 });
  const seen = await run({ labels: ['plan-approval-required'], removeError });
  assert.equal(seen.failed.length, 1);
  assert.equal(seen.warnings.length, 1);
  assert.match(seen.warnings[0], /Could not remove plan-triage-handoff from #885: forbidden/);
  assert.equal(seen.thrown, undefined);
});

test('guard: when GitHub cannot be asked it warns and passes: nothing is removed, nothing is blocked', async () => {
  const seen = await run({ graphqlError: new Error('rate limited') });
  assert.deepEqual([seen.failed, seen.removed], [[], []]);
  assert.equal(seen.warnings.length, 1);
});

test('guard: a response without a labels field is read as no labels', async () => {
  const seen = await run({ noLabelsField: true });
  assert.deepEqual([seen.failed, seen.removed, seen.warnings], [[], [], []]);
  assert.equal(seen.thrown, undefined, 'a missing field must not make the step throw');
});

// ---- Plan triage ----------------------------------------------------------------------------------------

test('plan triage: a hold that is already there is classified but never hands off, re-adds nothing and says nothing', () => {
  const s = flat(rawSection(triage.body, 'A hold that is already there'));
  assert.match(s, /^If the issue already carries `plan-approval-required` when you run \(a maintainer added it by hand to see the plan first, or an earlier run added it\), classify as usual and apply the complexity and risk labels,/);
  assert.match(s, /but do \*\*not\*\* emit `plan-triage-handoff`, do \*\*not\*\* add `plan-approval-required` again, and post no comment, whatever the classification, even low complexity and low risk\./);
  assert.match(s, /removing it is the approval, and `plan-approval-resume` hands the issue on\./);
});

test('plan triage: the approval gate points at the exception and the label allow-list still holds everything it needs', () => {
  assert.match(flat(rawSection(triage.body, 'Approval gate')), /Otherwise, and unless the issue already carries `plan-approval-required` \(see "A hold that is already there"\), the plan reports a conflict with a decision record \(see "A conflict with a decision record"\) or the plan reports a wrong layer \(see "A wrong layer"\) or a breaking change \(see "A breaking change"\), emit `plan-triage-handoff`\./);
  for (const label of ['complexity/low', 'risk/high', 'plan-approval-required', 'plan-triage-handoff']) {
    assert.match(triage.frontmatter, new RegExp(`^      - ${label.replace('/', '\\/')}$`, 'm'));
  }
});

// ---- Compile smoke and docs ----------------------------------------------------------------------------

test('compile smoke: the hold and the dependency label must survive into the compiled PR worker activation', () => {
  const smoke = read('tools/ci-compile-smoke.sh');
  assert.match(smoke, /for label in plan-approval-required dependency-required; do/);
  assert.match(smoke, /pr-worker does not stop at \$label in its compiled activation condition/);
});

test('docs: the manual hold, the blocking labels and the labels left alone on purpose are explained', () => {
  const design = flat(read('docs/multi-phase-design.md'));
  assert.match(design, /\*\*A hold put on by hand\.\*\* A maintainer can add `plan-approval-required` to any issue, whatever its complexity and risk, to read the plan before the coding agent starts\./);
  assert.match(design, /the PR worker assigns nobody while the label is there, even if plan triage emitted `plan-triage-handoff` anyway/);
  assert.match(design, /re-add `plan-worker-ready` to run plan triage/);
  assert.match(design, /\*\*A blocking label stops the hand-off\.\*\* The PR worker is the only gate that causes code/);
  assert.match(design, /A blocked hand-off is void: when the step blocks for a blocking label, or because an open pull request already closes the issue, it removes the `plan-triage-handoff` label/);
  assert.match(design, /are deliberately not checked again at the PR worker/);
  assert.match(design, /`issue-triage-handoff` by hand, which is the documented override/);
  assert.match(design, /The prompt is the first layer; the PR worker's `if:` and its `existing_fix` step are the guarantee/);
  const deployment = flat(read('docs/deployment.md'));
  assert.match(deployment, /Add `plan-approval-required` by hand to an open, low-risk issue that has a plan comment/);
  assert.match(deployment, /confirm the PR worker run ends without an assignment and the label is gone again/);
});
