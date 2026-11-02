import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { START_FAILURE } from '../scripts/agent-start-watch.mjs';
import { LABEL_AGENT_FAILED } from '../scripts/janitor.mjs';
import { buildManifest } from './build-release-manifest.mjs';
import { holds, jobIf } from './workflow-condition.mjs';

// The coding agent can fail to start after GitHub accepted the assignment, and says so once in a comment (frodo-lib#783 on
// 2026-11-02, #754 on 2026-10-23); nothing else in the Concierge noticed. This workflow turns that comment into a label
// (docs/multi-phase-design.md, "When the coding agent does not start", decision 0041). It runs on a comment that anyone can
// write, with a token that labels, so this pins who may start it, that the text never reaches a shell, and that everything it
// needs is delivered with it.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const workflow = read('workflows/agent-start-watch.yml');
const code = workflow.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const aw = read('aw.yml');
const requirements = JSON.parse(read('requirements.json'));
const WORDS = 'unable to start working on this issue';

test('it is named in the sidebar order after the PR gate\'s helpers, and can be started by hand for one issue', () => {
  assert.match(code, /^name: "Issue Concierge 3d ▸ Agent Start Watch"$/m);
  assert.match(code, /^  workflow_dispatch:\n    inputs:\n      issue_number:\n        description: '[^']+'\n        required: true\n        type: string/m);
});

test('it runs on a comment and by hand, on no other event: not on a schedule, a label or a pull request', () => {
  const on = code.split('\npermissions:')[0];
  assert.match(on, /issue_comment:\n    types: \[created\]/);
  assert.deepEqual([...on.matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1]), ['issue_comment', 'workflow_dispatch']);
  assert.doesNotMatch(on, /schedule|pull_request|workflow_run|push:/, 'GitHub starts a schedule when it can, and what has to show promptly cannot wait for it');
});

test('its permissions are the two it needs, and the only secret is the signal token, which labels so that the status issue and the options comment start', () => {
  assert.match(code, /^permissions:\n  contents: read\n  issues: write\n\nconcurrency:/m);
  assert.deepEqual([...code.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]), ['SIGNAL_TOKEN']);
  assert.match(code, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /SIGNAL_TOKEN: \$\{\{ secrets\.SIGNAL_TOKEN \}\}/);
});

test('one run per issue at a time, and a run that is labelling is not cancelled', () => {
  assert.match(code, /concurrency:\n  group: agent-start-watch-\$\{\{ github\.event\.issue\.number \|\| inputs\.issue_number \}\}\n  cancel-in-progress: false/);
});

test('the text of a comment never reaches a shell: no run line has an expression, and the script reads the event file itself', () => {
  assert.doesNotMatch(code, /github\.event\.(comment\.body|issue\.title|issue\.body|comment\.user\.login)\s*\}\}/, 'the body is only compared in the condition');
  assert.deepEqual([...code.matchAll(/^\s+run: (.+)$/gm)].map((m) => m[1]), ['node .github/scripts/agent-start-watch.mjs']);
  for (const [, line] of code.matchAll(/^\s+run: (.+)$/gm)) assert.doesNotMatch(line, /\$\{\{/, line);
  assert.doesNotMatch(code, /GITHUB_EVENT_PATH|toJSON\(github\.event/, 'GitHub provides the file');
  assert.match(read('scripts/agent-start-watch.mjs'), /env\.GITHUB_EVENT_PATH/);
  assert.match(code, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/);
  assert.doesNotMatch(code, /ref:|refs\/pull|github\.event\.pull_request\.head/);
});

// ---------------------------------------------------------------- who may start it

const condition = jobIf(workflow, 'watch');
const ctx = (event, { paused = false } = {}) => ({ vars: paused ? { ISSUE_CONCIERGE_PAUSED: 'true' } : {}, github: { event_name: event.name, event: event.payload ?? {} } });
const comment = (user, body = `The agent encountered an error and was ${WORDS}: The service is temporarily unavailable.`) => ({ name: 'issue_comment', payload: { action: 'created', issue: { labels: [{ name: 'enhancement' }], pull_request: null }, comment: { user, body } } });
const AGENT = { login: 'Copilot', type: 'Bot' };

test('the condition starts a run for the coding agent\'s report on an issue, and for nothing else', () => {
  assert.equal(holds(condition, ctx(comment(AGENT))), true);
  for (const login of ['copilot-swe-agent', 'copilot-swe-agent[bot]', 'COPILOT']) assert.equal(holds(condition, ctx(comment({ login, type: 'Bot' }))), true, login);
  assert.equal(holds(condition, ctx(comment(AGENT, `Was ${WORDS.toUpperCase()}`))), true, 'in any case');
  assert.equal(holds(condition, ctx(comment({ login: 'a-person', type: 'User' }))), false, 'anyone can type the words');
  assert.equal(holds(condition, ctx(comment({ login: 'Copilot', type: 'User' }))), false, 'a person named Copilot is not the agent');
  assert.equal(holds(condition, ctx(comment({ login: 'github-actions[bot]', type: 'Bot' }))), false);
  assert.equal(holds(condition, ctx(comment(AGENT, 'I started on the plan.'))), false);
  assert.equal(holds(condition, ctx(comment(AGENT, 'was unable to start working on this pull request'))), false, 'a comment about a pull request is another matter');
});

test('the condition starts nothing for a pull request or an opted-out issue, and nothing while the Concierge is paused, except a run by hand', () => {
  const on = (issue) => ({ ...comment(AGENT), payload: { ...comment(AGENT).payload, issue } });
  assert.equal(holds(condition, ctx(on({ labels: [], pull_request: {} }))), false);
  assert.equal(holds(condition, ctx(on({ labels: [{ name: 'no-auto-processing' }], pull_request: null }))), false);
  assert.equal(holds(condition, ctx(comment(AGENT), { paused: true })), false);
  for (const vars of [{ CONCIERGE_PAUSED: 'true' }, { ISSUE_CONCIERGE_PAUSED: 'TRUE' }]) assert.equal(holds(condition, { vars, github: { event_name: 'issue_comment', event: comment(AGENT).payload } }), false, JSON.stringify(vars));
  assert.equal(holds(condition, ctx({ name: 'workflow_dispatch', payload: { inputs: { issue_number: '7' } } }, { paused: true })), true, 'a maintainer\'s own run works while paused');
});

test('the words of the condition are the words the script reads', () => {
  assert.match(condition, new RegExp(`contains\\(github\\.event\\.comment\\.body, '${WORDS}'\\)`));
  assert.ok(START_FAILURE.test(`was ${WORDS}:`));
  assert.match(START_FAILURE.source, /unable to start working on this issue/);
});

// ---------------------------------------------------------------- what it needs

test('it is delivered with every script it imports, and its label is a required label that GitHub accepts', () => {
  for (const file of ['workflows/agent-start-watch.yml', 'scripts/agent-start-watch.mjs']) assert.match(aw, new RegExp(`^  - ${file.replace('.', '\\.')}$`, 'm'), `${file} is in aw.yml`);
  const m = buildManifest({ root: ROOT, version: '0.0.0-test' }).files;
  assert.deepEqual(m.filter((f) => /agent-start-watch\.(yml|mjs)$/.test(f.path)).map((f) => [f.kind, f.dest]).sort(), [['script', '.github/scripts/agent-start-watch.mjs'], ['workflow', '.github/workflows/agent-start-watch.yml']]);
  for (const [, dep] of read('scripts/agent-start-watch.mjs').matchAll(/^import .* from '\.\/([\w-]+\.mjs)';$/gm)) {
    assert.match(aw, new RegExp(`^  - scripts/${dep.replace('.', '\\.')}$`, 'm'), `agent-start-watch.mjs imports ${dep}`);
  }
  const label = requirements.labels.find((l) => l.name === LABEL_AGENT_FAILED);
  assert.ok(label, 'requirements.json lists it, so the updater creates it where it is missing');
  assert.match(label.color, /^[0-9a-f]{6}$/);
  assert.ok(label.description.length > 0 && label.description.length <= 100, 'GitHub caps a label description at 100 characters');
});

test('the docs, the record and the checklist say the same', () => {
  const design = read('docs/multi-phase-design.md');
  assert.match(design, /\| `Issue Concierge 3d ▸ Agent Start Watch` \| the coding agent comments that it could not start work on an issue \(and by hand for one issue\); a plain workflow, no model \|/);
  assert.match(design, /^### When the coding agent does not start$/m);
  assert.match(design, /\| `agent-start-failed` \| the agent start watch, when the coding agent says it could not start \|/);
  const label = requirements.labels.find((l) => l.name === LABEL_AGENT_FAILED);
  assert.ok(read('docs/deployment.md').includes(`| \`${LABEL_AGENT_FAILED}\` | \`${label.color}\` | ${label.description} |`));
  assert.match(read('docs/deployment.md'), /^### Agent start watch$/m);
  assert.match(read('docs/deployment.md'), /- \[ \] Agent start watch installed \(`agent-start-watch\.yml` and `agent-start-watch\.mjs`; needs `SIGNAL_TOKEN`; the updater does it\)/);
  assert.match(read('README.md'), /\| `agent-start-failed` \| Gate \|/);
  const record = read('docs/decisions/0041-a-coding-agent-that-did-not-start-is-reported-and-only-a-maintainer-starts-it-again.md');
  assert.match(record, /^status: accepted$/m);
  assert.match(record, /Concierge never starts the agent again by itself/);
  assert.match(read('docs/decisions/README.md'), /\| 0041 \| \[A coding agent that did not start is reported, and only a maintainer starts it again\]\(0041-[^)]+\.md\) \| accepted \|/);
});

test('nothing starts the agent again by itself: the label has four readers and none of them hands the issue on, except the maintainer\'s /retry', () => {
  // the watch that sets it, the status issue, the options comment of the commands and the janitor; the one place that hands the issue on is /retry (scripts/commands.mjs)
  const handsOn = fs.readdirSync(path.join(ROOT, 'workflows')).filter((f) => /\.(yml|md)$/.test(f) && read(`workflows/${f}`).includes('agent-start-failed'));
  assert.deepEqual(handsOn.sort(), ['agent-start-watch.yml', 'commands.yml', 'janitor.yml', 'status.yml']);
  assert.doesNotMatch(code, /plan-triage-handoff/, 'the watch workflow names no hand-off');
  assert.doesNotMatch(read('scripts/agent-start-watch.mjs'), /plan-triage-handoff|LABEL_PLAN_HANDOFF|unassign|closePull/, 'the watch labels and does nothing else');
});
