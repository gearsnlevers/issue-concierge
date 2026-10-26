import test from 'node:test';
import assert from 'node:assert/strict';
import { holds, frontmatterIf, jobIf, stepIf, read } from './workflow-condition.mjs';
import { LABEL_OPT_OUT } from '../scripts/opt-out.mjs';
import fs from 'node:fs';

// An item that carries `no-auto-processing` is never touched by the Concierge. Why it exists: a maintainer's own
// comment on frodo-cli#518, an issue from before the Concierge, started the issue worker, then triage, then a plan
// with a hold label and three bot comments (2026-10-25), though the maintainer wanted to handle it by hand. The rule is
// https://github.com/vscheuber/repo-concierge/blob/main/docs/decisions/0028-an-item-labelled-no-auto-processing-is-never-touched.md
// (the decision: the label is a hard stop for every workflow and script, removing it hands the issue over, a manual
// dispatch of the issue worker still works) and docs/multi-phase-design.md, "Opting an item out".
//
// A guarantee belongs in the `if:` of the workflow, where no run starts and nothing is spent, so these tests EVALUATE
// each condition for an event with and without the label (tools/workflow-condition.mjs) instead of matching its text.
// Every case has its control: the same event without the label starts the workflow, so a condition that is merely
// false for another reason cannot pass. The scripts are pinned in scripts/*.test.mjs, the release closer's code step here.

const issueEvent = ({ event_name = 'issues', action, labels = [], state = 'open', author = 'User', label, pull_request = null, commenter } = {}) => ({
  github: {
    event_name,
    repository_id: 7,
    event: {
      action,
      issue: { state, user: { type: author }, labels: labels.map((name) => ({ name })), pull_request },
      label: label ? { name: label } : undefined,
      comment: commenter ? { user: { type: commenter } } : undefined,
    },
  },
  needs: { pre_activation: { outputs: { existing_fix_result: 'success', closed_by_merge_result: 'success' } } },
});
const prEvent = ({ event_name = 'pull_request_target', action, labels = [], label, merged = false } = {}) => ({
  github: {
    event_name,
    repository_id: 7,
    event: { action, pull_request: { labels: labels.map((name) => ({ name })), head: { repo: { id: 7 } }, merged }, label: label ? { name: label } : undefined },
  },
});
const scheduled = { github: { event_name: 'schedule', event: {} } };
const dispatched = { github: { event_name: 'workflow_dispatch', event: { inputs: { issue_number: '5', pr_number: '5' } } } };

const withLabel = (base) => (base.github.event.issue ? { ...base, github: { ...base.github, event: { ...base.github.event, issue: { ...base.github.event.issue, labels: [...base.github.event.issue.labels, { name: LABEL_OPT_OUT }] } } } } : { ...base, github: { ...base.github, event: { ...base.github.event, pull_request: { ...base.github.event.pull_request, labels: [...base.github.event.pull_request.labels, { name: LABEL_OPT_OUT }] } } } });

/** The event starts the workflow without the label and does not with it. */
function guarded(condition, base, what) {
  assert.equal(holds(condition, base), true, `${what}: the control (no label) must start the workflow`);
  assert.equal(holds(condition, withLabel(base)), false, `${what}: with ${LABEL_OPT_OUT} nothing may start`);
}

const md = (name) => read(`workflows/${name}.md`);
const yml = (name) => read(`workflows/${name}.yml`);

test('the label is the same string in the script module, requirements.json, the docs and the record', () => {
  assert.equal(LABEL_OPT_OUT, 'no-auto-processing');
  const label = JSON.parse(read('requirements.json')).labels.find((l) => l.name === LABEL_OPT_OUT);
  assert.ok(label, 'requirements.json lists the label');
  assert.ok(label.description.length <= 100, 'GitHub caps a label description at 100 characters');
  assert.match(read('docs/deployment.md'), new RegExp(`\\| \`${LABEL_OPT_OUT}\` \\| \`${label.color}\` \\| ${label.description.replace(/[.*+?^${}()|[\]\\;]/g, '\\$&')} \\|`));
  assert.ok(fs.existsSync(new URL('../docs/decisions/0028-an-item-labelled-no-auto-processing-is-never-touched.md', import.meta.url)));
  assert.match(read('aw.yml'), /^ {2}- scripts\/opt-out\.mjs$/m, 'the module is installed with the scripts that import it');
});

// ------------------------------------------------------------------ the issue worker

test('issue worker: no event on a labelled issue starts it (new, edited, reopened, a comment)', () => {
  const cond = frontmatterIf(md('issue-worker'));
  guarded(cond, issueEvent({ action: 'opened' }), 'opened');
  guarded(cond, issueEvent({ action: 'edited' }), 'edited');
  guarded(cond, issueEvent({ action: 'reopened' }), 'reopened');
  guarded(cond, issueEvent({ event_name: 'issue_comment', action: 'created', commenter: 'User' }), 'a comment, as on frodo-cli#518');
});

test('issue worker: removing the label starts it, and removing any other label does not', () => {
  const cond = frontmatterIf(md('issue-worker'));
  // the payload of an `unlabeled` event already lacks the removed label
  assert.equal(holds(cond, issueEvent({ action: 'unlabeled', label: LABEL_OPT_OUT })), true, 'the hand-over');
  assert.equal(holds(cond, issueEvent({ action: 'unlabeled', label: 'needs-info' })), false, 'another label');
  assert.equal(holds(cond, issueEvent({ action: 'unlabeled', label: 'plan-approval-required' })), false, 'the hold label');
  assert.equal(holds(cond, issueEvent({ action: 'unlabeled', label: LABEL_OPT_OUT, labels: [LABEL_OPT_OUT] })), false, 'a label that is still there');
  assert.equal(holds(cond, issueEvent({ action: 'unlabeled', label: LABEL_OPT_OUT, state: 'closed' })), false, 'a closed issue stays closed to the gates');
  assert.equal(holds(cond, issueEvent({ action: 'unlabeled', label: LABEL_OPT_OUT, author: 'Bot' })), false, 'a bot-written issue');
  assert.equal(holds(cond, issueEvent({ action: 'unlabeled', label: LABEL_OPT_OUT, pull_request: {} })), false, 'a pull request');
  const on = md('issue-worker').match(/^on:\n([\s\S]*?)^\S/m)[1];
  assert.match(on, /^ {2}issues:\n {4}types: \[opened, reopened, edited, unlabeled\]$/m);
  assert.doesNotMatch(on, /names:/, 'the label filter is the `if:`, so that no other label removal reaches the worker');
});

test('issue worker: the conditions it had still hold (closed, bot, pull request), and a manual dispatch is always allowed', () => {
  const cond = frontmatterIf(md('issue-worker'));
  assert.equal(holds(cond, issueEvent({ action: 'opened', state: 'closed' })), false);
  assert.equal(holds(cond, issueEvent({ action: 'opened', author: 'Bot' })), false);
  assert.equal(holds(cond, issueEvent({ action: 'opened', pull_request: {} })), false);
  assert.equal(holds(cond, issueEvent({ event_name: 'issue_comment', action: 'created', commenter: 'Bot' })), false);
  assert.equal(holds(cond, dispatched), true, 'a dispatch is the explicit act of a person, and carries no issue payload');
});

// ------------------------------------------------------------------ the label-driven gates

test('issue triage, plan worker and plan triage: a labelled issue starts none of them', () => {
  for (const [name, label] of [['issue-triage', 'issue-worker-ready'], ['plan-worker', 'issue-triage-handoff'], ['plan-triage', 'plan-worker-ready']]) {
    const cond = frontmatterIf(md(name));
    guarded(cond, issueEvent({ action: 'labeled', label }), name);
    assert.equal(holds(cond, issueEvent({ action: 'labeled', label, state: 'closed' })), false, `${name}: closed still starts nothing`);
    assert.equal(holds(cond, issueEvent({ action: 'labeled', label, author: 'Bot' })), false, `${name}: a bot issue still starts nothing`);
  }
});

test('PR worker: the `if:` and the live existing_fix step both leave a labelled issue alone', () => {
  const worker = md('pr-worker');
  const base = issueEvent({ action: 'labeled', label: 'plan-triage-handoff' });
  guarded(frontmatterIf(worker), base, 'the activation');
  guarded(stepIf(worker, 'existing_fix'), base, 'the pre-activation step (it would otherwise void the label and comment)');
  // what it already blocked
  assert.equal(holds(frontmatterIf(worker), issueEvent({ action: 'labeled', label: 'plan-triage-handoff', labels: ['plan-approval-required'] })), false);
  assert.equal(holds(frontmatterIf(worker), issueEvent({ action: 'labeled', label: 'plan-triage-handoff', labels: ['dependency-required'] })), false);
});

test('PR triage: a labelled pull request starts nothing, one without the label starts only for pr-worker-ready', () => {
  const cond = frontmatterIf(md('pr-triage'));
  guarded(cond, prEvent({ action: 'labeled', label: 'pr-worker-ready' }), 'pr-triage');
  assert.equal(holds(cond, prEvent({ action: 'labeled', label: 'complexity/low' })), false);
});

test('Waiting for Release: a labelled issue that a pull request closed starts no job (it is a plain workflow now)', () => {
  const cond = jobIf(yml('waiting-for-release'), 'resolution');
  guarded(cond, issueEvent({ action: 'closed', state: 'closed' }), 'a close');
  assert.equal(holds(cond, issueEvent({ action: 'closed', state: 'closed', author: 'Bot' })), false, 'what it already skipped: a bot-written issue');
  assert.equal(holds(cond, dispatched), true, 'a manual run is the explicit act of a person');
  assert.equal(fs.existsSync(new URL('../workflows/waiting-for-release.md', import.meta.url)), false, 'no model gate is left to guard');
});

// ------------------------------------------------------------------ plain workflows

test('janitor: events for a labelled issue or pull request start no job; the sweep and a dispatch still do', () => {
  const cond = jobIf(yml('janitor'), 'clean');
  guarded(cond, issueEvent({ action: 'closed', state: 'closed' }), 'an issue closes');
  guarded(cond, issueEvent({ action: 'assigned' }), 'an issue is assigned');
  guarded(cond, issueEvent({ action: 'labeled', label: 'plan-worker-ready' }), 'a gate label on an issue');
  guarded(cond, prEvent({ action: 'labeled', label: 'pr-worker-ready' }), 'a gate label on a pull request');
  guarded(cond, prEvent({ action: 'closed' }), 'a pull request closes');
  assert.equal(holds(cond, issueEvent({ action: 'labeled', label: 'bug' })), false, 'a label that cannot change the answer starts nothing, as before');
  assert.equal(holds(cond, issueEvent({ action: 'labeled', label: LABEL_OPT_OUT, labels: [LABEL_OPT_OUT] })), false, 'applying the opt-out label itself');
  assert.equal(holds(cond, scheduled), true, 'the hourly sweep (scripts/janitor.mjs skips the labelled items)');
  assert.equal(holds(cond, dispatched), true);
});

test('reporter notify: a labelled linked issue is not notified about', () => {
  const cond = jobIf(yml('reporter-notify'), 'notify');
  const base = issueEvent({ action: 'opened' });
  base.github.event.issue.body = 'Reported from owner/repo#1';
  guarded(cond, base, 'opened');
  const labeled = issueEvent({ action: 'labeled', label: 'needs-info' });
  labeled.github.event.issue.body = 'Reported from owner/repo#1';
  guarded(cond, labeled, 'needs-info');
  assert.equal(holds(cond, dispatched), true);
});

test('plan approval resume: removing the hold from a labelled issue hands nothing on', () => {
  const cond = jobIf(yml('plan-approval-resume'), 'resume');
  guarded(cond, issueEvent({ action: 'unlabeled', label: 'plan-approval-required' }), 'plan-approval-required removed');
  assert.equal(holds(cond, issueEvent({ action: 'unlabeled', label: 'needs-info' })), false, 'another label, as before');
  assert.equal(holds(cond, dispatched), true);
});

test('related-repo closer: a labelled canonical issue closes nothing', () => {
  const cond = jobIf(yml('related-repo-closer'), 'close-original');
  guarded(cond, issueEvent({ action: 'closed', state: 'closed', labels: ['original-in-related-repo'] }), 'the canonical issue closes');
  assert.equal(holds(cond, issueEvent({ action: 'closed', state: 'closed' })), false, 'without the link label, as before');
  assert.equal(holds(cond, dispatched), true);
});

test('dependency watcher: the label event of a labelled issue starts nothing; a close, the schedule and a dispatch still evaluate the others', () => {
  const cond = jobIf(yml('dependency-watch'), 'watch');
  guarded(cond, issueEvent({ action: 'labeled', label: 'dependency-required' }), 'dependency-required added');
  assert.equal(holds(cond, issueEvent({ action: 'labeled', label: 'bug' })), false);
  // a closed issue only starts the run that re-checks the issues that wait; the script skips the labelled ones
  assert.equal(holds(cond, withLabel(issueEvent({ action: 'closed', state: 'closed' }))), true, 'a closing issue is how its dependents are released');
  assert.equal(holds(cond, scheduled), true);
});

test('PR ready signal: a labelled pull request is not signalled; the sweep and a dispatch still run', () => {
  const cond = jobIf(yml('pr-ready-signal'), 'signal');
  guarded(cond, prEvent({ action: 'ready_for_review' }), 'ready for review');
  assert.equal(holds(cond, scheduled), true);
  assert.equal(holds(cond, dispatched), true);
});

// ------------------------------------------------------------------ nothing is left out

test('every workflow that acts on an issue or pull request checks the label', () => {
  // the two that do not act on an item: the deployment check and the updater
  const exempt = new Set(['check-deployment.yml', 'concierge-updater.yml']);
  const files = fs.readdirSync(new URL('../workflows/', import.meta.url)).filter((f) => /\.(md|yml)$/.test(f));
  assert.ok(files.length >= 16, 'expected every workflow');
  for (const f of files) {
    if (exempt.has(f)) continue;
    assert.ok(read(`workflows/${f}`).includes(`'${LABEL_OPT_OUT}'`) || read(`workflows/${f}`).includes(`"${LABEL_OPT_OUT}"`), `${f} must check ${LABEL_OPT_OUT}: a new workflow cannot opt out of the rule`);
  }
});

test('only the issue worker and the plan approval resume start on a label being removed', () => {
  const files = fs.readdirSync(new URL('../workflows/', import.meta.url)).filter((f) => /\.(md|yml)$/.test(f));
  const listeners = files.filter((f) => /^\s+types:.*\bunlabeled\b/m.test(read(`workflows/${f}`))).sort();
  assert.deepEqual(listeners, ['issue-worker.md', 'plan-approval-resume.yml']);
});

// ------------------------------------------------------------------ the release closer's code step

/** Run the `included_fixes` step of the release closer against fakes; returns what it wrote. */
async function runIncludedFixes(issues) {
  const text = md('release-closer');
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim() === 'id: included_fixes');
  const start = lines.findIndex((l, i) => i > at && l.trim() === 'script: |');
  const indent = lines[start + 1].search(/\S/);
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim() !== '' && lines[i].search(/\S/) < indent) break;
    body.push(lines[i].slice(indent));
  }
  const writes = [];
  const github = {
    paginate: async (fn, params) => fn(params),
    rest: {
      issues: {
        listForRepo: async () => issues,
        listComments: async () => [{ user: { login: 'github-actions[bot]' }, body: 'Fixed in #11. Waiting for a release that includes this.' }],
        addLabels: async (p) => writes.push(['addLabels', p.issue_number, p.labels.join()]),
        removeLabel: async (p) => writes.push(['removeLabel', p.issue_number, p.name]),
        createComment: async (p) => writes.push(['createComment', p.issue_number, p.body]),
      },
      pulls: { get: async () => ({ data: { merged: true, merge_commit_sha: 'abc123' } }) },
      repos: { compareCommitsWithBasehead: async () => ({ data: { status: 'ahead' } }) },
    },
  };
  const core = { warning: (m) => writes.push(['warning', m]), info: () => {} };
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { release: { tag_name: 'v9.9.9' } } };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction('github', 'context', 'core', body.join('\n'))(github, context, core);
  return writes;
}
const waiting = (number, ...more) => ({ number, labels: [{ name: 'waiting-for-release' }, ...more.map((name) => ({ name }))] });

test('release closer: a labelled issue gets no label change and no "Included in" comment; its neighbour does', async () => {
  const writes = await runIncludedFixes([waiting(1), waiting(2, LABEL_OPT_OUT)]);
  assert.deepEqual(writes.filter((w) => w[1] === 1).map((w) => w[0]), ['addLabels', 'removeLabel', 'createComment'], 'the control: an ordinary issue is moved');
  assert.match(writes.find((w) => w[0] === 'createComment' && w[1] === 1)[2], /^Included in v9\.9\.9\.$/);
  assert.deepEqual(writes.filter((w) => w[1] === 2), [], 'nothing at all is written to the labelled issue');
  assert.deepEqual(writes.filter((w) => w[0] === 'warning'), [], 'and it is not even looked at as a failure');
});

test('release closer: the agent prompt repeats the rule, in both lists it reads', () => {
  const body = md('release-closer').split(/^---\n/m).slice(2).join('---\n');
  assert.match(body, /Skip every issue that also carries `no-auto-processing`/);
  assert.match(body, /do not mention it/i);
});

test('issue worker: the prompt tells the agent how to read the unlabeled event, and never to mention the label', () => {
  const body = md('issue-worker').split(/^---\n/m).slice(2).join('---\n');
  assert.match(body, /label being removed[\s\S]*treat it like a newly opened issue[\s\S]*never mention the label/);
});
