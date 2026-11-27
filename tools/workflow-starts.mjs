// Which workflow starts for an event: test support for tools/workflow-starts.test.mjs, in the manner of tools/workflow-condition.mjs.
//
// A workflow "starts" for an event when the event is one its `on:` lists (event, action, label name of a gh-aw `names:`, schedule string,
// branch and changed paths) and a job of it passes its own `if:`. The `if:` expressions are evaluated by tools/workflow-condition.mjs
// (the one evaluator of the repository); this file adds what that file does not do: reading the `on:` block of a workflow and building
// the context of an event from a fixture of tools/fixtures/workflow-starts.json. Not part of a release.
import fs from 'node:fs';
import { holds, frontmatterIf, read } from './workflow-condition.mjs';

/** The repository id every fixture runs in: a pull request from this repository has it as the id of its head repository. */
export const REPOSITORY_ID = 7;

/** The names of the events GitHub knows. A key under `on:` that is not one of them is an option of gh-aw (`roles`, `permissions`, `steps`). */
const EVENTS = new Set([
  'branch_protection_rule', 'check_run', 'check_suite', 'create', 'delete', 'deployment', 'deployment_status', 'discussion', 'discussion_comment', 'fork',
  'gollum', 'issue_comment', 'issues', 'label', 'merge_group', 'milestone', 'page_build', 'project', 'project_card', 'project_column', 'public', 'pull_request',
  'pull_request_review', 'pull_request_review_comment', 'pull_request_target', 'push', 'registry_package', 'release', 'repository_dispatch', 'schedule',
  'status', 'watch', 'workflow_call', 'workflow_dispatch', 'workflow_run',
]);
/** What GitHub does when an event lists no `types`. Only these two are needed; any other event without `types` throws until it is added. */
const DEFAULT_TYPES = { pull_request: ['opened', 'synchronize', 'reopened'], pull_request_target: ['opened', 'synchronize', 'reopened'] };
/** The keys under an event this reader understands. Any other key throws, so that a filter it cannot apply is never ignored. */
const KEYS = new Set(['types', 'names', 'branches', 'paths', 'inputs']);

const unquote = (s) => s.replace(/^(['"])(.*)\1$/, '$2');
const flow = (s) => s.replace(/^\[|\]$/g, '').split(',').map((x) => unquote(x.trim())).filter(Boolean);

/** Every file of workflows/, sorted. */
export const workflowFiles = () => fs.readdirSync(new URL('../workflows/', import.meta.url)).filter((f) => /\.(md|yml)$/.test(f)).sort();
/** `janitor` for `janitor.yml`. */
export const stem = (file) => file.replace(/\.(md|yml)$/, '');
/** A gh-aw definition has the frontmatter and the prompt; a plain workflow is a YAML file. */
export const isAgent = (file) => file.endsWith('.md');

/**
 * The triggers of a workflow (a plain `.yml` or the frontmatter of a gh-aw `.md`), as `{ event: { types, names, branches, paths, cron } }`.
 * Reads the subset of YAML the workflows use; anything else throws instead of being guessed.
 */
export function triggersOf(text) {
  const source = text.startsWith('---\n') ? text.match(/^---\n([\s\S]*?)\n---\n/)[1] : text;
  const lines = source.split('\n');
  const at = lines.findIndex((l) => /^on:/.test(l));
  if (at < 0) throw new Error('no on:');
  if (lines[at].trim() !== 'on:') throw new Error(`cannot read a one-line on: (${lines[at].trim()})`);
  const block = [];
  for (let i = at + 1; i < lines.length && (!/^\S/.test(lines[i]) || lines[i].startsWith('#')); i += 1) block.push(lines[i]);

  const raw = {};
  let current = null;
  for (const line of block) {
    if (/^\s*(#|$)/.test(line)) continue;
    if (line.search(/\S/) === 2) {
      const m = line.match(/^ {2}([A-Za-z_-]+):\s*(.*)$/);
      if (!m) throw new Error(`cannot read the trigger: ${line.trim()}`);
      current = EVENTS.has(m[1]) ? m[1] : null;
      if (current) {
        if (m[2] !== '') throw new Error(`cannot read ${current}: ${m[2]}`);
        raw[current] = [];
      }
    } else if (current) {
      raw[current].push(line);
    }
  }

  const triggers = {};
  for (const [event, lines2] of Object.entries(raw)) {
    const out = {};
    let key = null;
    for (const line of lines2) {
      if (/^\s*(#|$)/.test(line)) continue;
      const indent = line.search(/\S/);
      const t = line.trim();
      if (indent === 4) {
        if (event === 'schedule') {
          const m = t.match(/^- cron:\s*(.+)$/);
          if (!m) throw new Error(`cannot read schedule: ${t}`);
          (out.cron ??= []).push(unquote(m[1]));
          continue;
        }
        const m = t.match(/^([a-z-]+):\s*(.*)$/);
        if (!m || !KEYS.has(m[1])) throw new Error(`cannot read ${event}: ${t}`);
        key = m[1];
        if (m[2] === '') out[key] = [];
        else if (m[2].startsWith('[')) { out[key] = flow(m[2]); key = null; } else { out[key] = [unquote(m[2])]; key = null; }
      } else if (indent > 4) {
        if (key === 'inputs') continue;
        const m = t.match(/^- (.+)$/);
        if (!key || !m) throw new Error(`cannot read ${event}: ${t}`);
        out[key].push(unquote(m[1]));
      } else {
        throw new Error(`cannot read ${event}: ${t}`);
      }
    }
    delete out.inputs;
    triggers[event] = out;
  }
  return triggers;
}

/** GitHub's path pattern: `*` does not cross a `/`, `**` does, and the whole path has to match. */
export function globMatches(pattern, file) {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(`^${source}$`).test(file);
}

/** The triggers of a workflow, one string each, the way the table of fixtures is checked for coverage: `issues.labeled`, `schedule.17 * * * *`, `push.main`, `workflow_dispatch`. A gh-aw `names:` adds the label: `issues.labeled[issue-worker-ready]`. */
export function triggerKeys(triggers) {
  const keys = [];
  for (const [event, t] of Object.entries(triggers)) {
    if (event === 'workflow_dispatch') keys.push('workflow_dispatch');
    else if (event === 'schedule') for (const cron of t.cron ?? []) keys.push(`schedule.${cron}`);
    else if (event === 'push') for (const branch of t.branches ?? ['*']) keys.push(`push.${branch}`);
    else {
      const types = t.types ?? DEFAULT_TYPES[event];
      if (!types) throw new Error(`${event} lists no types, and the default is not known to this reader`);
      for (const type of types) {
        if (t.names && ['labeled', 'unlabeled'].includes(type)) for (const name of t.names) keys.push(`${event}.${type}[${name}]`);
        else keys.push(`${event}.${type}`);
      }
    }
  }
  return keys.sort();
}

/** The trigger a fixture is, in the same form as `triggerKeys`; a label is added for the keys that carry one. */
export function fixtureKeys(fixture) {
  const { event, action } = fixture;
  if (event === 'workflow_dispatch') return ['workflow_dispatch'];
  if (event === 'schedule') return [`schedule.${fixture.schedule}`];
  if (event === 'push') return [`push.${fixture.branch}`];
  const keys = [`${event}.${action}`];
  if (fixture.label && ['labeled', 'unlabeled'].includes(action)) keys.push(`${event}.${action}[${fixture.label}]`);
  return keys;
}

/** True when the `on:` of a workflow lists this event. A dispatch is addressed to one workflow: the caller checks `handler`. */
export function onMatches(triggers, fixture) {
  const t = triggers[fixture.event];
  if (!t) return false;
  if (fixture.event === 'workflow_dispatch') return true;
  if (fixture.event === 'schedule') return (t.cron ?? []).includes(fixture.schedule);
  if (fixture.event === 'push') {
    if (t.branches && !t.branches.includes(fixture.branch)) return false;
    return !t.paths || (fixture.changed ?? []).some((file) => t.paths.some((p) => globMatches(p, file)));
  }
  const types = t.types ?? DEFAULT_TYPES[fixture.event];
  if (!types) throw new Error(`${fixture.event} lists no types, and the default is not known to this reader`);
  if (!types.includes(fixture.action)) return false;
  // gh-aw compiles `names:` into a condition on the label that started the run, so it filters the label events of that action only.
  if (t.names && ['labeled', 'unlabeled'].includes(fixture.action) && !t.names.map((n) => n.toLowerCase()).includes(String(fixture.label).toLowerCase())) return false;
  if (t.paths) return (fixture.changed ?? []).some((file) => t.paths.some((p) => globMatches(p, file)));
  return true;
}

/** The jobs of a plain workflow, in file order: `{ id, needs, condition }`. `condition` is null for a job without an `if:`. */
export function jobsOf(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === 'jobs:');
  if (start < 0) throw new Error('no jobs:');
  const jobs = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i]) && !lines[i].startsWith('#')) break;
    const m = lines[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end]) && !(/^\S/.test(lines[end]) && !lines[end].startsWith('#'))) end += 1;
    jobs.push({ id: m[1], block: lines.slice(i + 1, end) });
  }
  return jobs.map(({ id, block }) => {
    const ifs = block.map((l, k) => [l, k]).filter(([l]) => /^ {4}if:/.test(l));
    if (ifs.length > 1) throw new Error(`job ${id} has more than one if:`);
    const needs = block.map((l) => l.match(/^ {4}needs:\s*(.+)$/)).find(Boolean);
    let condition = null;
    if (ifs.length === 1) {
      const [line, k] = ifs[0];
      const first = line.replace(/^\s*if:\s*/, '').trim();
      if (/^[>|][-+]?$/.test(first)) {
        const parts = [];
        for (let j = k + 1; j < block.length; j += 1) {
          if (block[j].trim() !== '' && block[j].search(/\S/) <= 4) break;
          if (block[j].trim() !== '' && !block[j].trim().startsWith('#')) parts.push(block[j].trim());
        }
        condition = parts.join(' ');
      } else condition = first;
    }
    return { id, needs: needs ? flow(needs[1]) : [], condition };
  });
}

/** True for a job whose `if:` reads the output of the job it needs: a script prints it, so no fixture can set it. */
export const readsOutput = (job) => job.condition !== null && /\bneeds\.[A-Za-z0-9_-]+\.outputs\./.test(job.condition);

/**
 * The name of a job in the table: the file stem for the first job of a workflow (`janitor` is the job `clean`), `stem/job` for every other.
 * A workflow of one job is therefore known by its stem alone.
 */
export const jobName = (file, jobs, job) => (jobs[0].id === job.id ? stem(file) : `${stem(file)}/${job.id}`);

/**
 * Read a fixture of the table into the GitHub context a condition is evaluated against. The table holds only what a condition reads, and
 * `defaults` (the first key of the table) gives every field a fixture leaves out. A `labeled` event has the label in the item's labels,
 * an `unlabeled` event has not (GitHub's payloads do): a fixture lists the other labels.
 */
export function contextOf(fixture, defaults) {
  const event = {};
  if (fixture.action) event.action = fixture.action;
  if (fixture.label) event.label = { name: fixture.label };
  if (fixture.assignee) event.assignee = { login: fixture.assignee };
  if (fixture.event === 'schedule') event.schedule = fixture.schedule;
  if (fixture.event === 'workflow_dispatch') event.inputs = fixture.inputs ?? {};
  const labelsOf = (labels) => {
    const names = [...(labels ?? [])];
    if (fixture.action === 'labeled' && fixture.label) names.push(fixture.label);
    return names.map((name) => ({ name }));
  };
  if (fixture.event === 'issues' || fixture.event === 'issue_comment') {
    const i = { ...defaults.issue, ...fixture.issue };
    event.issue = {
      state: i.state,
      user: { type: i.author },
      labels: labelsOf(i.labels),
      assignees: i.assignees.map((type) => ({ type })),
      body: i.body,
      pull_request: i.pr ? { url: 'https://api.github.com/repos/o/r/pulls/1' } : null,
    };
  }
  if (fixture.event === 'issue_comment') {
    const c = { ...defaults.comment, ...fixture.comment };
    event.comment = { user: { type: c.author, login: c.login }, body: c.body };
  }
  if (fixture.event === 'pull_request' || fixture.event === 'pull_request_target') {
    const p = { ...defaults.pull_request, ...fixture.pull_request };
    event.pull_request = { labels: labelsOf(p.labels), merged: p.merged, head: { repo: { id: p.fork ? REPOSITORY_ID + 1 : REPOSITORY_ID } } };
  }
  return { vars: { ...fixture.vars }, github: { event_name: fixture.event, repository_id: REPOSITORY_ID, event }, needs: {} };
}

const CONDITION_ALWAYS_RUNS = /\b(?:cancelled|always)\(\)/;

/**
 * The jobs of the plain workflows that start for a fixture, by name (see `jobName`), sorted. A job starts when its workflow's `on:` lists the
 * event, the jobs it needs started (unless its `if:` says otherwise) and its `if:` holds. A job whose `if:` reads the output of another job
 * is left out: `readsOutput`.
 */
export function plainStarts(fixture, defaults) {
  const started = [];
  for (const file of workflowFiles().filter((f) => !isAgent(f))) {
    const text = read(`workflows/${file}`);
    if (!onMatches(triggersOf(text), fixture)) continue;
    if (fixture.event === 'workflow_dispatch' && fixture.handler !== stem(file)) continue;
    const jobs = jobsOf(text);
    const result = {};
    for (const job of jobs) {
      if (readsOutput(job)) continue;
      const context = contextOf(fixture, defaults);
      for (const need of job.needs) context.needs[need] = { result: result[need] ? 'success' : 'skipped', outputs: {} };
      const blocked = job.needs.some((need) => !result[need]) && !CONDITION_ALWAYS_RUNS.test(job.condition ?? '');
      result[job.id] = !blocked && (job.condition === null || holds(job.condition, context));
      if (result[job.id]) started.push(jobName(file, jobs, job));
    }
  }
  return started.sort();
}

/**
 * The gh-aw agents that start for a fixture, by stem, sorted: the `on:` of the definition lists the event (and the label of its `names:`) and
 * its own `if:` holds. What the pre-activation job reads live (a step outcome, the role of the actor, the rate limit) cannot be set by a
 * fixture and counts as "not stopped".
 */
export function agentStarts(fixture, defaults) {
  const started = [];
  for (const file of workflowFiles().filter(isAgent)) {
    const text = read(`workflows/${file}`);
    if (!onMatches(triggersOf(text), fixture)) continue;
    if (fixture.event === 'workflow_dispatch' && fixture.handler !== stem(file)) continue;
    const context = contextOf(fixture, defaults);
    context.needs = { pre_activation: { outputs: {} } };
    if (holds(frontmatterIf(text), context)) started.push(stem(file));
  }
  return started.sort();
}
