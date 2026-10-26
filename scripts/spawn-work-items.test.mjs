import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LABEL_DEPENDENCY,
  LABEL_HOLD,
  MARKER,
  apply,
  childBody,
  childTitle,
  clean,
  decide,
  latestPlan,
  parseWorkItems,
  spawnedChildren,
  statusComment,
} from './spawn-work-items.mjs';
import { parseDependencies } from './dependency-watch.mjs';

// A fix can need a change in two repositories: a library function and the command that calls it. Until now the only way
// to track that was a person writing the second issue and its `Depends on:` line by hand (the facade chain). The plan
// worker, which reads the code on both sides, now lists `Work item:` lines; a maintainer who agrees runs this for the
// issue that holds the plan. These fakes stand for the two repositories; what is written is recorded in `calls`.

const THIS = 'rockcarver/frodo-cli';
const OTHER = 'rockcarver/frodo-lib';
const ORIGIN = `${THIS}#919`;
const bot = (body, extra = {}) => ({ user: { login: 'github-actions[bot]', type: 'Bot' }, body, ...extra });
const person = (body) => ({ user: { login: 'vscheuber', type: 'User' }, body });
const label = (names) => names.map((name) => ({ name }));

const LIB_LINE = `Work item: ${OTHER} | Expand a sub-journey under every parent it appears under | where: src/ops/JourneyOps.ts getTreeDescendents | order: first`;
const CLI_LINE = `Work item: ${THIS} | Show the repeated sub-journeys in the describe output | where: src/ops/JourneyOps.ts describeTreeDescendents | order: this`;
const plan = (lines = [LIB_LINE, CLI_LINE], repo = THIS) =>
  bot(`## Plan\n\nThe fix needs a library change first.\n\n${lines.join('\n')}\n\n<!-- gh-aw-workflow-call-id: ${repo}/plan-worker -->`, {
    html_url: 'https://github.com/rockcarver/frodo-cli/issues/919#issuecomment-1',
  });

const origin = (extra = {}) => ({
  number: 919,
  state: 'open',
  user: { login: 'someone', type: 'User' },
  labels: label(['plan-approval-required', 'complexity/medium']),
  body: 'A report.',
  ...extra,
});
function world(comments = [plan()], issue = origin()) {
  const api = (path) => (path === `repos/${THIS}/issues/919/comments?per_page=100&page=1` ? { status: 200, data: comments } : { status: 404, data: null });
  return { issue, ctx: { thisRepo: THIS, relatedRepo: OTHER, api } };
}
function recorder(extra = {}) {
  const calls = [];
  const ctx = {
    findChild: () => '',
    createIssue: (repo, title, body, labels) => {
      calls.push({ op: 'create', repo, title, body, labels });
      return `${repo}#7`;
    },
    comment: (n, body) => calls.push({ op: 'comment', n, body }),
    addLabel: (n, l) => calls.push({ op: 'label', n, label: l }),
    ...extra,
  };
  return { calls, ctx };
}

test('parseWorkItems reads the exact form, also as a list item, and reports a line that starts like one but is not', () => {
  const { items, problems } = parseWorkItems(`## Plan\n\n- ${LIB_LINE}\n${CLI_LINE.toLowerCase().replace(THIS.toLowerCase(), THIS)}\nWork item: ${OTHER} | no where or order\nSome prose that mentions a Work item: in the middle.\n`);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { repo: OTHER, scope: 'Expand a sub-journey under every parent it appears under', where: 'src/ops/JourneyOps.ts getTreeDescendents', order: 'first' });
  assert.equal(items[1].order, 'this');
  assert.deepEqual(problems, [`Work item: ${OTHER} | no where or order`]);
});

test('clean: one line, no mention, no HTML comment, bounded: what a plan writes into another issue cannot forge a marker or notify a stranger', () => {
  assert.equal(clean('Fix it @someone\nand <!-- spawn:child a/b#1 --> more'), 'Fix it @\u200bsomeone and spawn:child a/b#1 more');
  assert.ok(!clean('<!-- spawn:child a/b#1 -->').includes('<!--'));
  assert.equal(clean('x'.repeat(500)).length, 200);
  assert.equal(clean(undefined), '');
});

test('a plan that needs the related repository first: one work item to create, with the plan to point at', () => {
  const w = world();
  const v = decide(w.issue, w.ctx);
  assert.equal(v.action, 'spawn');
  assert.deepEqual(v.items.map((i) => i.repo), [OTHER], 'this repository\'s own line is the origin itself');
  assert.equal(v.planUrl, 'https://github.com/rockcarver/frodo-cli/issues/919#issuecomment-1');
  assert.equal(v.spawned.size, 0);
});

test('the work item is created held and marked as part of the origin, then the origin says so, and a first item gates it', () => {
  const w = world();
  const { calls, ctx } = recorder();
  const did = apply(decide(w.issue, w.ctx), w.issue, { ...w.ctx, ...ctx });
  assert.deepEqual(calls.map((c) => c.op), ['create', 'comment', 'label']);
  const [create, comment, lab] = calls;
  assert.equal(create.repo, OTHER);
  assert.deepEqual(create.labels, [LABEL_HOLD], 'held, and no link label: the closer and the reporter notice must not start');
  assert.ok(create.body.includes(`Part of ${ORIGIN}.`));
  assert.ok(create.body.includes(`${MARKER}part-of ${ORIGIN} -->`));
  assert.doesNotMatch(create.body, /Reported from/, 'it is not a canonical issue of a link');
  assert.match(comment.body, new RegExp(`Depends on: ${OTHER}#7`));
  assert.deepEqual([lab.n, lab.label], [919, LABEL_DEPENDENCY]);
  assert.equal(did.length, 3);
});

test('the dependency watcher reads exactly the work item from the comment', () => {
  const found = parseDependencies(statusComment({ order: 'first', scope: 'x' }, `${OTHER}#7`));
  assert.deepEqual(found, [{ repo: OTHER, number: 7 }]);
  assert.deepEqual(parseDependencies(statusComment({ order: 'independent', scope: 'x' }, `${OTHER}#7`)), [], 'an independent item gates nothing');
  assert.deepEqual(parseDependencies(childBody({ order: 'first', scope: 'x', where: 'y' }, ORIGIN, 'u')), [], 'the new issue does not depend on the origin: that would be a cycle');
});

test('an independent item is created and named, but nothing waits for it', () => {
  const w = world([plan([LIB_LINE.replace('order: first', 'order: independent'), CLI_LINE])]);
  const { calls, ctx } = recorder();
  apply(decide(w.issue, w.ctx), w.issue, { ...w.ctx, ...ctx });
  assert.deepEqual(calls.map((c) => c.op), ['create', 'comment']);
  assert.doesNotMatch(calls[1].body, /Depends on:/);
  assert.match(calls[0].body, /do not wait for each other/);
});

test('running it again does the work once: the comment on the origin is the record', () => {
  const w = world([plan(), bot(statusComment({ order: 'first', scope: 'x' }, `${OTHER}#7`))], origin({ labels: label([LABEL_DEPENDENCY]) }));
  const v = decide(w.issue, w.ctx);
  assert.equal(v.spawned.get(OTHER.toLowerCase()), `${OTHER}#7`);
  const { calls, ctx } = recorder();
  const did = apply(v, w.issue, { ...w.ctx, ...ctx });
  assert.deepEqual(calls, []);
  assert.deepEqual(did, []);
});

test('a run that stopped after the new issue was created finishes: the marker in its body finds it, and nothing is created twice', () => {
  const w = world();
  const { calls, ctx } = recorder({ findChild: (repo, ref) => (repo === OTHER && ref === ORIGIN ? `${OTHER}#7` : '') });
  apply(decide(w.issue, w.ctx), w.issue, { ...w.ctx, ...ctx });
  assert.deepEqual(calls.map((c) => c.op), ['comment', 'label']);
  assert.match(calls[0].body, new RegExp(`${OTHER}#7`));
});

test('a run that stopped before the gate label is finished by the next one', () => {
  const w = world([plan(), bot(statusComment({ order: 'first', scope: 'x' }, `${OTHER}#7`))]);
  const { calls, ctx } = recorder();
  apply(decide(w.issue, w.ctx), w.issue, { ...w.ctx, ...ctx });
  assert.deepEqual(calls.map((c) => c.op), ['label']);
});

test('a dry run writes nothing and says what it would do', () => {
  const w = world();
  const boom = () => {
    throw new Error('wrote in a dry run');
  };
  const did = apply(decide(w.issue, w.ctx), w.issue, { ...w.ctx, dryRun: true, findChild: () => '', createIssue: boom, comment: boom, addLabel: boom });
  assert.equal(did.length, 3);
  assert.match(did[0], new RegExp(`created a work item in ${OTHER}`));
});

test('nothing is created for a plan that cannot be trusted or does not ask for it', () => {
  const why = (comments, issue, relatedRepo = OTHER) => {
    const w = world(comments, issue);
    return decide(w.issue, { ...w.ctx, relatedRepo });
  };
  assert.match(why([], origin()).reason, /no plan/);
  assert.match(why([person(`${LIB_LINE}\n<!-- gh-aw-workflow-call-id: ${THIS}/plan-worker -->`)], origin()).reason, /no plan/, 'a person quoting the marker is no plan');
  assert.match(why([plan([LIB_LINE], 'rockcarver/frodo-lib')], origin()).reason, /no plan/, 'the plan of another repository\'s worker is not this issue\'s');
  assert.match(why([plan([CLI_LINE])], origin()).reason, /names no work in/);
  assert.match(why([plan()], origin(), '').reason, /no related repository/);
  assert.match(why([plan([`Work item: ${OTHER} | no where or order`])], origin()).reason, /does not have the exact form/);
  assert.match(why([plan([LIB_LINE, LIB_LINE])], origin()).reason, /two work items for/);
  const third = 'someone/else';
  assert.match(why([plan([LIB_LINE, `Work item: ${third} | x | where: y | order: first`])], origin()).reason, /not the related repository configured here/);
  assert.match(why([plan([LIB_LINE.replace('order: first', 'order: this')])], origin()).reason, /says "order: this"/);
});

test('what no gate runs for is left alone, and a work item is not split again', () => {
  const r = (extra) => {
    const w = world([plan()], origin(extra));
    return decide(w.issue, w.ctx).reason;
  };
  assert.match(r({ pull_request: {} }), /pull request/);
  assert.match(r({ state: 'closed' }), /not open/);
  assert.match(r({ user: { login: 'dependabot[bot]', type: 'Bot' } }), /bot/);
  assert.match(r({ labels: label(['no-auto-processing']) }), /no-auto-processing/);
  assert.match(r({ labels: label(['related-repo']) }), /another repository/);
  assert.match(r({ body: `Scope.\n\nPart of ${OTHER}#3. Plan.` }), /not split again/);
});

test('the title and the body of the new issue are bounded and say where the work belongs', () => {
  const item = { repo: OTHER, scope: 'x'.repeat(190), where: 'src/a.ts', order: 'first' };
  assert.ok(childTitle(item, ORIGIN).length <= 100 + ` (for ${ORIGIN})`.length, 'the scope is cut at 100 characters, far under the limit of a title');
  assert.ok(childTitle(item, ORIGIN).endsWith(`(for ${ORIGIN})`));
  const body = childBody(item, ORIGIN, 'https://example.test/plan');
  assert.match(body, /Where: src\/a\.ts/);
  assert.match(body, /The plan that names this work item: https:\/\/example\.test\/plan/);
  assert.match(body, /The change in rockcarver\/frodo-cli needs this one first\./);
  assert.equal(latestPlan([plan(), plan([LIB_LINE])], THIS).body.includes(CLI_LINE), false, 'the latest plan wins');
  assert.equal(spawnedChildren([bot(`${MARKER}child ${OTHER}#7 -->`)]).get(OTHER.toLowerCase()), `${OTHER}#7`);
});
