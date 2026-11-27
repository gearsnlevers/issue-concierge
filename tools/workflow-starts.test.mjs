import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { read, holds, frontmatterIf } from './workflow-condition.mjs';
import {
  workflowFiles, stem, isAgent, triggersOf, triggerKeys, fixtureKeys, onMatches, globMatches, jobsOf, readsOutput, jobName, contextOf, plainStarts, agentStarts,
} from './workflow-starts.mjs';
import { PAUSE_VARIABLES } from '../scripts/issue-concierge-state.mjs';

// What this pins. For every event in tools/fixtures/workflow-starts.json (an issue opened, a label removed, a comment, a schedule, a run by
// hand, ...) the table says which jobs of the plain workflows start and which gh-aw agents start. The sets are written out by hand in the
// table and also computed from the real files of workflows/ here, with the evaluator of tools/workflow-condition.mjs (the `if:` of every job
// and of every definition) and a reader for `on:` (event, action, the label of a gh-aw `names:`, schedule string, branch and changed paths).
// The test says the two are the same, so a change to an `on:` or an `if:` that changes what starts for an event fails here, and a table
// that was only copied from the code cannot hide it, because a person reads it.
//
// What it is for. It is the pin for the step that merges the plain workflows into one entry workflow whose jobs keep each `if:` as it is:
// that entry has to give the same sets for the same events (without the updater and the deployment check, which stay outside it), and
// the same table then pins the step that makes the agents callable. Nothing in this file changes a workflow, a script or a prompt.
//
// How to read the table. A fixture is an event: its `event` and `action`, the fields of the payload that any condition reads, and the
// repository variables (`vars`) that are set. What it leaves out comes from `defaults`: an open issue by a person with no labels, no
// assignee and an empty body; a comment by a person; a pull request of this repository that is not merged. A `labeled` event has its
// label in the item's labels and an `unlabeled` event has not, as in GitHub's payloads, so `issue.labels` lists the other labels.
// `starts` names the jobs of the plain workflows that start: the file stem for the first job of a workflow (`janitor` is its job `clean`)
// and `stem/job` for another (`janitor/assigned`). `agents` names the gh-aw definitions that start. A run by hand is addressed to one
// workflow (`handler`, today the file stem; in the entry the value of its `handler` input) and starts that workflow only.
//
// How to add a fixture. Add an object to a group of the table with a `name`, a `note` that says which border it pins, the event, and
// `starts` and `agents` as you expect them from reading the conditions, not as you copy them from a failure. Run this file: it tells you
// the fixtures whose committed sets differ from the real workflows, and the triggers, jobs and agents no fixture covers. A new trigger,
// a new job or a new agent fails the coverage tests until a fixture starts it.
//
// What a fixture cannot set, and what is therefore not pinned: the output a job reads from the job it needs (the branches that
// `commands/delete-branches` waits for; see UNEVALUABLE), what the pre-activation job of an agent reads live (the outcome of its steps,
// the role of the actor, the rate limit of the issue worker: they count as "not stopped"), secrets, the concurrency groups, and what a
// script does after its job started. A dispatch input is read by no condition, which one test pins.

const table = JSON.parse(read('tools/fixtures/workflow-starts.json'));
const { defaults } = table;
const groups = table.groups;
const fixtures = groups.flatMap((g) => g.fixtures.map((f) => ({ ...f, group: g.title })));
const ASSIGNEE_GROUP = 'the assignee rule (record 0043)';
/** Jobs whose `if:` reads the output of the job they need: no fixture can set it, so they are not in any set. */
const UNEVALUABLE = ['commands/delete-branches'];

const files = workflowFiles();
const plain = files.filter((f) => !isAgent(f));
const agents = files.filter(isAgent);
const jobsByFile = Object.fromEntries(plain.map((f) => [f, jobsOf(read(`workflows/${f}`))]));
const allJobNames = plain.flatMap((f) => jobsByFile[f].map((j) => ({ file: f, job: j, name: jobName(f, jobsByFile[f], j) })));
const evaluableNames = allJobNames.filter(({ job }) => !readsOutput(job)).map((j) => j.name);

const sorted = (list) => [...list].sort();
const show = (list) => `[${list.join(', ')}]`;

// ------------------------------------------------------------------ the table

test('the table is well formed: unique names, a note for every fixture, only fields the reader knows, sorted sets of names that exist', () => {
  const FIELDS = new Set(['name', 'note', 'event', 'action', 'label', 'assignee', 'schedule', 'branch', 'changed', 'handler', 'inputs', 'issue', 'comment', 'pull_request', 'vars', 'starts', 'agents', 'group']);
  const SUB = { issue: ['state', 'author', 'labels', 'assignees', 'pr', 'body'], comment: ['author', 'login', 'body'], pull_request: ['labels', 'merged', 'fork'] };
  const EVENTS = ['issues', 'issue_comment', 'pull_request', 'pull_request_target', 'release', 'push', 'schedule', 'workflow_dispatch'];
  const handlers = new Set(allJobNames.map((j) => j.name));
  const problems = [];
  const names = new Set();
  for (const f of fixtures) {
    const bad = (what) => problems.push(`${f.name}: ${what}`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.name)) bad('the name is not words joined by hyphens');
    if (names.has(f.name)) bad('the name is used twice');
    names.add(f.name);
    if (typeof f.note !== 'string' || f.note.length < 30) bad('a note that names the border is missing');
    for (const key of Object.keys(f)) if (!FIELDS.has(key)) bad(`unknown field ${key}`);
    for (const [key, allowed] of Object.entries(SUB)) for (const sub of Object.keys(f[key] ?? {})) if (!allowed.includes(sub)) bad(`unknown field ${key}.${sub}`);
    for (const type of f.issue?.assignees ?? []) if (!['User', 'Bot', 'Organization'].includes(type)) bad(`assignee type ${type}`);
    for (const who of [f.issue?.author, f.comment?.author]) if (who && !['User', 'Bot'].includes(who)) bad(`author type ${who}`);
    if (!EVENTS.includes(f.event)) bad(`the event ${f.event} is not one the table reads`);
    if (['issues', 'issue_comment', 'pull_request', 'pull_request_target', 'release'].includes(f.event) && !f.action) bad('no action');
    if (['labeled', 'unlabeled'].includes(f.action) && !f.label) bad('a labeled or unlabeled event names its label');
    if (f.label && !['labeled', 'unlabeled'].includes(f.action)) bad('only a labeled or unlabeled event has a label');
    if (['assigned', 'unassigned'].includes(f.action) && !f.assignee) bad('an assigned or unassigned event names its assignee');
    if (f.event === 'schedule' && !f.schedule) bad('no schedule string');
    if (f.event === 'push' && (!f.branch || !Array.isArray(f.changed))) bad('a push has a branch and the changed files');
    if (f.event === 'pull_request' && !Array.isArray(f.changed)) bad('a pull_request has the changed files');
    if (f.event === 'workflow_dispatch' && !files.map(stem).includes(f.handler)) bad(`the handler ${f.handler} is not a workflow`);
    if (f.event !== 'workflow_dispatch' && f.handler) bad('only a run by hand has a handler');
    for (const [key, set] of [['starts', f.starts], ['agents', f.agents]]) {
      if (!Array.isArray(set)) { bad(`${key} is not a list`); continue; }
      if (JSON.stringify(set) !== JSON.stringify(sorted(new Set(set)))) bad(`${key} is not sorted and unique`);
      for (const name of set) if (!(key === 'starts' ? handlers : new Set(agents.map(stem))).has(name)) bad(`${key} names ${name}, which is not ${key === 'starts' ? 'a job' : 'an agent'}`);
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(fixtures.length >= 80, 'the table pins about eighty events or more');
});

test('the assignee rule is a group of its own: every event that names an assignee is in it, and nothing else is', () => {
  assert.ok(groups.some((g) => g.title === ASSIGNEE_GROUP));
  const namesAssignee = (f) => ['assigned', 'unassigned'].includes(f.action) || (f.issue?.assignees ?? []).length > 0;
  assert.deepEqual(fixtures.filter((f) => namesAssignee(f) !== (f.group === ASSIGNEE_GROUP)).map((f) => f.name), []);
});

test('the table sets each pause variable and the opt-out label in some fixture, so that none of the three is a default', () => {
  for (const name of PAUSE_VARIABLES) assert.ok(fixtures.some((f) => f.vars && name in f.vars), `no fixture sets ${name}`);
  assert.ok(fixtures.some((f) => f.vars && Object.keys(f.vars).length > 1), 'no fixture sets both');
  assert.ok(fixtures.some((f) => [...(f.issue?.labels ?? []), ...(f.pull_request?.labels ?? [])].includes('no-auto-processing')), 'no fixture carries the opt-out label');
});

// ------------------------------------------------------------------ the pin

test('for every event, the jobs and the agents that start are the ones the table says', () => {
  const different = [];
  for (const f of fixtures) {
    const starts = plainStarts(f, defaults);
    const started = agentStarts(f, defaults);
    if (JSON.stringify(starts) !== JSON.stringify(f.starts)) different.push(`${f.name}: starts ${show(f.starts)} in the table, ${show(starts)} in the workflows`);
    if (JSON.stringify(started) !== JSON.stringify(f.agents)) different.push(`${f.name}: agents ${show(f.agents)} in the table, ${show(started)} in the workflows`);
  }
  assert.equal(different.length, 0, `${different.length} fixture(s) differ:\n${different.join('\n')}`);
});

test('every job of a plain workflow and every agent starts for at least one event of the table', () => {
  const started = new Set(fixtures.flatMap((f) => f.starts));
  assert.deepEqual(evaluableNames.filter((name) => !started.has(name)), [], 'jobs that no fixture starts');
  const startedAgents = new Set(fixtures.flatMap((f) => f.agents));
  assert.deepEqual(agents.map(stem).filter((name) => !startedAgents.has(name)), [], 'agents that no fixture starts');
});

test('every trigger a workflow declares (event and action, the label of a names filter, schedule string, branch, a run by hand) starts that workflow in some fixture', () => {
  const missing = [];
  for (const file of files) {
    const name = stem(file);
    for (const key of triggerKeys(triggersOf(read(`workflows/${file}`)))) {
      const covered = fixtures.some((f) => {
        const here = key === 'workflow_dispatch' ? f.event === 'workflow_dispatch' && f.handler === name : fixtureKeys(f).includes(key);
        const set = isAgent(file) ? f.agents : f.starts;
        return here && set.some((n) => n === name || n.startsWith(`${name}/`));
      });
      if (!covered) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], 'a trigger that no fixture starts a workflow for: add a fixture (see the top of this file)');
});

test('the workflows declare exactly these events: another one, such as workflow_run, is a trigger the table has to learn first', () => {
  // No workflow listens to the end of another workflow or to a repository dispatch: a label written with the workflow token starts nothing, and the chain runs through labels.
  const declared = new Set(files.flatMap((f) => Object.keys(triggersOf(read(`workflows/${f}`)))));
  assert.deepEqual([...declared].sort(), ['issue_comment', 'issues', 'pull_request', 'pull_request_target', 'push', 'release', 'schedule', 'workflow_dispatch']);
});

test('no condition reads an input of a run by hand, so the same run with or without its inputs, and while paused, starts the same', () => {
  for (const { file, job } of allJobNames) assert.doesNotMatch(job.condition ?? '', /\binputs\./, `${file}, job ${job.id}`);
  for (const file of agents) assert.doesNotMatch(frontmatterIf(read(`workflows/${file}`)), /\binputs\./, file);
  for (const f of fixtures.filter((x) => x.event === 'workflow_dispatch')) {
    for (const vars of [{}, ...PAUSE_VARIABLES.map((name) => ({ [name]: 'true' })), Object.fromEntries(PAUSE_VARIABLES.map((name) => [name, 'true']))]) {
      for (const inputs of [{}, { issue_number: '99', pr_number: '99', dry_run: 'true' }]) {
        const changed = { ...f, vars, inputs };
        assert.deepEqual(plainStarts(changed, defaults), f.starts, `${f.name} with ${JSON.stringify({ vars, inputs })}`);
        assert.deepEqual(agentStarts(changed, defaults), f.agents, `${f.name} with ${JSON.stringify({ vars, inputs })}`);
      }
    }
  }
});

test('the conditions read exactly these fields of the context, and the fixtures can set every one: a condition that reads another needs the reader and the table first', () => {
  const READS = [
    'github.event.action', 'github.event.assignee.login', 'github.event.comment.body', 'github.event.comment.user.login', 'github.event.comment.user.type', 'github.event.issue.assignees.*.type',
    'github.event.issue.body', 'github.event.issue.labels.*.name', 'github.event.issue.pull_request', 'github.event.issue.state', 'github.event.issue.user.type', 'github.event.label.name',
    'github.event.pull_request.head.repo.id', 'github.event.pull_request.labels.*.name', 'github.event.pull_request.merged', 'github.event_name', 'github.repository_id',
    'needs.clean.result', 'needs.commands.outputs.branches', 'needs.pre_activation.outputs.accepted_result', 'needs.pre_activation.outputs.existing_fix_result',
    'vars.CONCIERGE_PAUSED', 'vars.ISSUE_CONCIERGE_PAUSED',
  ];
  const conditions = [...allJobNames.map(({ job }) => job.condition).filter(Boolean), ...agents.map((f) => frontmatterIf(read(`workflows/${f}`)))];
  const reads = [...new Set(conditions.flatMap((c) => [...c.matchAll(/\b(?:github|vars|needs|inputs|secrets|env)(?:\.[A-Za-z_*][\w-]*)+/g)].map((m) => m[0])))].sort();
  assert.deepEqual(reads, READS);
  // the ones a fixture cannot set are the two outputs of steps that read GitHub live (see UNEVALUABLE and the top of this file); `needs.clean.result` is worked out from the job it needs
  assert.deepEqual(reads.filter((r) => r.startsWith('needs.')).filter((r) => r.includes('.outputs.')), ['needs.commands.outputs.branches', 'needs.pre_activation.outputs.accepted_result', 'needs.pre_activation.outputs.existing_fix_result']);
});

test('the one job whose condition no fixture can set is named, and is the one it is today', () => {
  assert.deepEqual(allJobNames.filter(({ job }) => readsOutput(job)).map((j) => j.name), UNEVALUABLE, 'a job that reads the output of another job needs a decision: pin it here, or make it evaluable');
  const job = jobsByFile['commands.yml'].find((j) => j.id === 'delete-branches');
  assert.deepEqual(job.needs, ['commands']);
  assert.equal(job.condition, "${{ needs.commands.outputs.branches != '' }}", 'it starts after the commands job when that job names branches to delete');
  assert.deepEqual(fixtures.filter((f) => f.starts.includes('commands/delete-branches')).map((f) => f.name), [], 'no fixture can say it starts');
});

test('the first job of a plain workflow is known by the file stem, the others by stem/job', () => {
  assert.deepEqual(allJobNames.map((j) => j.name), [
    'agent-start-watch', 'check-deployment', 'commands', 'commands/delete-branches', 'dependency-watch', 'issue-concierge-updater', 'janitor', 'janitor/held-runs', 'janitor/assigned',
    'plan-approval-resume', 'pr-ready-signal', 'related-repo-closer', 'reporter-notify', 'route-back', 'spawn-work-items', 'stalled-issue-sweep', 'status', 'waiting-for-release',
  ]);
});

// ------------------------------------------------------------------ the readers

test('the reader of `on:` reads the shapes the workflows use, and throws for a shape it cannot apply', () => {
  const plainYaml = [
    'name: x', 'on:', '  # a comment', '  issues:', '    types: [opened, labeled]', '  schedule:', "    - cron: '1 * * * *'", '    - cron: "2 * * * *"', '  push:', '    branches: [main]',
    '    paths:', "      - 'a/*.md'", '      - b.json', '  pull_request:', '    types:', '      - opened', '  workflow_dispatch:', '    inputs:', '      n:', '        required: true', 'permissions: {}', '',
  ].join('\n');
  assert.deepEqual(triggersOf(plainYaml), {
    issues: { types: ['opened', 'labeled'] }, schedule: { cron: ['1 * * * *', '2 * * * *'] }, push: { branches: ['main'], paths: ['a/*.md', 'b.json'] }, pull_request: { types: ['opened'] }, workflow_dispatch: {},
  });
  const definition = ['---', 'if: ${{ true }}', 'on:', '  roles: all', '  permissions:', '    issues: write', '  issues:', '    types: [labeled]', '    names: [x-ready]', '  steps:', '    - name: a step', '      run: echo on', 'engine: copilot', '---', '# prompt', ''].join('\n');
  assert.deepEqual(triggersOf(definition), { issues: { types: ['labeled'], names: ['x-ready'] } }, 'the options of gh-aw are not events');
  assert.deepEqual(triggersOf('on:\n  workflow_run:\n    types: [completed]\n'), { workflow_run: { types: ['completed'] } }, 'an event the workflows do not use today is still read');
  assert.throws(() => triggersOf('on: push\n'), /one-line on:/);
  assert.throws(() => triggersOf('on:\n  issues:\n    types: [opened]\n    labels: [x]\n'), /cannot read issues/);
  assert.throws(() => triggersOf('on:\n  issues: [opened]\n'), /cannot read issues/);
  assert.throws(() => triggersOf('on:\n  schedule:\n    - at: 5\n'), /cannot read schedule/);
  assert.throws(() => triggersOf('name: x\n'), /no on:/);
});

test('the trigger keys name an event and an action, the label of a names filter, a schedule string, a branch; a pull request without types has GitHub\'s three', () => {
  const t = triggersOf('on:\n  issues:\n    types: [labeled, closed]\n    names: [a]\n  pull_request:\n    paths: [x]\n  schedule:\n    - cron: "5 * * * *"\n  push:\n    branches: [main]\n  workflow_dispatch:\n');
  assert.deepEqual(triggerKeys(t), ['issues.closed', 'issues.labeled[a]', 'pull_request.opened', 'pull_request.reopened', 'pull_request.synchronize', 'push.main', 'schedule.5 * * * *', 'workflow_dispatch']);
  assert.throws(() => triggerKeys({ issues: {} }), /lists no types/);
  assert.deepEqual(fixtureKeys({ event: 'issues', action: 'labeled', label: 'a' }), ['issues.labeled', 'issues.labeled[a]']);
  assert.deepEqual(fixtureKeys({ event: 'issues', action: 'closed' }), ['issues.closed']);
});

test('an event matches the `on:` of a workflow by its action, its label, its schedule string, its branch and its changed paths', () => {
  const t = triggersOf('on:\n  issues:\n    types: [labeled]\n    names: [Ready]\n  pull_request:\n    paths: ["docs/**", "*.md"]\n  schedule:\n    - cron: "5 * * * *"\n  push:\n    branches: [main]\n    paths: [package.json]\n');
  assert.equal(onMatches(t, { event: 'issues', action: 'labeled', label: 'ready' }), true, 'a label name is compared without regard to case');
  assert.equal(onMatches(t, { event: 'issues', action: 'labeled', label: 'other' }), false);
  assert.equal(onMatches(t, { event: 'issues', action: 'closed' }), false);
  assert.equal(onMatches(t, { event: 'issue_comment', action: 'created' }), false);
  assert.equal(onMatches(t, { event: 'pull_request', action: 'opened', changed: ['docs/a/b.txt'] }), true);
  assert.equal(onMatches(t, { event: 'pull_request', action: 'opened', changed: ['a/b.md'] }), false, '* does not cross a slash');
  assert.equal(onMatches(t, { event: 'pull_request', action: 'labeled', changed: ['x.md'] }), false, 'labeled is not one of the default types');
  assert.equal(onMatches(t, { event: 'schedule', schedule: '5 * * * *' }), true);
  assert.equal(onMatches(t, { event: 'schedule', schedule: '6 * * * *' }), false);
  assert.equal(onMatches(t, { event: 'push', branch: 'main', changed: ['package.json'] }), true);
  assert.equal(onMatches(t, { event: 'push', branch: 'dev', changed: ['package.json'] }), false);
  assert.equal(onMatches(t, { event: 'push', branch: 'main', changed: ['src/package.json'] }), false);
  assert.throws(() => onMatches({ release: {} }, { event: 'release', action: 'published' }), /lists no types/, 'an event without types that GitHub fills in itself is not guessed');
});

test('a path pattern is GitHub\'s: * stays inside a folder, ** crosses folders, the whole path has to match', () => {
  assert.equal(globMatches('.github/workflows/*.md', '.github/workflows/a.md'), true);
  assert.equal(globMatches('.github/workflows/*.md', '.github/workflows/sub/a.md'), false);
  assert.equal(globMatches('.github/issue-concierge/**', '.github/issue-concierge/a/b.yml'), true);
  assert.equal(globMatches('.github/issue-concierge/**', '.github/issue-concierge'), false);
  assert.equal(globMatches('package.json', 'package.json'), true);
  assert.equal(globMatches('package.json', 'a/package.json'), false);
  assert.equal(globMatches('package.json', 'package-json'), false, 'the dot is a dot');
  assert.equal(globMatches('a?.md', 'ab.md'), true);
});

test('the jobs of a workflow are read with their needs and their condition, folded or on one line, and a job without an if: has none', () => {
  const yaml = [
    'on:', '  workflow_dispatch:', 'jobs:', '  # a comment at the margin of the jobs', '  a:', '    if: >-', '      x == 1', '      && y == 2', '    runs-on: u', '    steps:', '      - if: step == 3', '        run: z',
    '  b:', '    needs: a', '    if: ${{ needs.a.outputs.o != \'\' }}', '    runs-on: u', '  c:', '    needs: [a, b]', '    runs-on: u', '',
  ].join('\n');
  assert.deepEqual(jobsOf(yaml), [
    { id: 'a', needs: [], condition: 'x == 1 && y == 2' },
    { id: 'b', needs: ['a'], condition: "${{ needs.a.outputs.o != '' }}" },
    { id: 'c', needs: ['a', 'b'], condition: null },
  ]);
  assert.deepEqual(jobsOf(yaml).map(readsOutput), [false, true, false]);
  assert.throws(() => jobsOf('on:\n  push:\n'), /no jobs/);
  assert.throws(() => jobsOf('jobs:\n  a:\n    if: x\n    if: y\n'), /more than one if:/);
});

test('a job that needs a skipped job is skipped, unless its condition says it runs anyway; the jobs of the janitor show both', () => {
  const clean = { event: 'pull_request_target', action: 'labeled', label: 'complexity/low' };
  assert.deepEqual(plainStarts(clean, defaults), [], 'the label job is skipped for a label outside its list, and the held-run job needs it');
  assert.deepEqual(plainStarts({ ...clean, label: 'pr-worker-ready' }, defaults), ['janitor', 'janitor/held-runs']);
  assert.deepEqual(plainStarts({ event: 'issues', action: 'assigned', assignee: 'a', issue: { assignees: ['User'] } }, defaults), ['janitor', 'janitor/assigned'], 'the assigned job does not need the label job');
});

test('a fixture becomes the context its conditions read: the event label is in the labels of a labeled event and not of an unlabeled one', () => {
  const labeled = contextOf({ event: 'issues', action: 'labeled', label: 'x', issue: { labels: ['y'], assignees: ['User'], pr: true }, vars: { A: 'true' } }, defaults);
  assert.deepEqual(labeled.github.event.issue.labels, [{ name: 'y' }, { name: 'x' }]);
  assert.deepEqual(labeled.github.event.issue.assignees, [{ type: 'User' }]);
  assert.notEqual(labeled.github.event.issue.pull_request, null);
  assert.deepEqual(labeled.vars, { A: 'true' });
  assert.equal(labeled.github.event.label.name, 'x');
  assert.deepEqual(contextOf({ event: 'issues', action: 'unlabeled', label: 'x' }, defaults).github.event.issue.labels, []);
  const pr = contextOf({ event: 'pull_request_target', action: 'closed', pull_request: { merged: true, fork: true } }, defaults);
  assert.equal(pr.github.event.pull_request.merged, true);
  assert.notEqual(pr.github.event.pull_request.head.repo.id, pr.github.repository_id);
  assert.equal(holds('github.event.comment.user.type != \'Bot\'', contextOf({ event: 'issues', action: 'opened' }, defaults)), true, 'an event without a comment reads as null');
  assert.deepEqual(contextOf({ event: 'workflow_dispatch', handler: 'x', inputs: { n: '1' } }, defaults).github.event, { inputs: { n: '1' } });
  assert.equal(contextOf({ event: 'schedule', schedule: '5 * * * *' }, defaults).github.event.schedule, '5 * * * *');
});
