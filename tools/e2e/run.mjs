#!/usr/bin/env node
// End-to-end tests of the Issue Concierge. Each scenario (tools/e2e/scenarios/*.json) files a mock enhancement in a
// sandbox repository, lets the real gates run on it, and asserts what the design promises: the labels and comments the
// gates leave, how the issue ends, that no run failed. Every scenario stops at a hold or at an early outcome, so no code
// is ever written and no pull request merged. See docs/e2e.md.
//
// Usage: node tools/e2e/run.mjs [--profile public|private|all] [--scenario id|number,id|number] [--yes] [--retries 1]
//          [--poll-seconds 45] [--out results.json] [--list] [--cleanup-stale HOURS]
// A scenario is known by its id and by its number, the prefix of its file name (10-command-accepts-a-held-request.json is
// scenario 10); docs/e2e.md lists them by number, and --scenario takes either.
// The pairs (profiles) run side by side; the scenarios of one pair run one after another.
// Without --yes it prints what it would do and files nothing. GH_TOKEN names the identity that files the issues:
// it must be a person with write access to the sandbox repositories, because the gates ignore issues by bots.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_PIN_PATH, PIN_PATH } from '../../scripts/issue-concierge-paths.mjs';
import { createGitHub } from './github.mjs';
import { CHECK_TYPES, FAIL_FAST, describeSnapshot, evaluateChecks } from './checks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STEP_KINDS = ['wait', 'expect', 'comment', 'label', 'unlabel', 'close', 'dispatch', 'settle'];
export const OPT_OUT = 'no-auto-processing';
const MARKER = (tag) => `<!-- e2e-run: ${tag} -->`;
const MINUTE = 60 * 1000;
const SETTLE_EXTRA_MINUTES = 10;
const QUIESCE_MINUTES = 5;
const CLOCK_SKEW_MS = 2000;

// ------------------------------------------------------------------ data

/** The pin file of a sandbox repository: in the new place, or else in the old one while the repository has not been updated yet. */
export async function readPinText(gh, repo) {
  try {
    return await gh.readFile(repo, PIN_PATH);
  } catch {
    return gh.readFile(repo, LEGACY_PIN_PATH);
  }
}

export function loadConfig(file = path.join(HERE, 'config.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The number of a scenario: the digits at the start of its file name (01-happy-path-to-the-hold.json is scenario 1). */
export const numberOf = (file) => {
  const m = /^(\d+)-/.exec(file);
  if (!m) throw new Error(`${file}: a scenario file name starts with its number and a hyphen, like 01-happy-path-to-the-hold.json`);
  return Number(m[1]);
};

export function loadScenarios(dir = path.join(HERE, 'scenarios')) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), file: f, number: numberOf(f) }));
}

/** Replaces {{name}} with a value; a name that has no value is a mistake in the scenario, not an empty string. */
export function expand(text, vars) {
  return text.replace(/\{\{([\w.-]+)\}\}/g, (match, key) => {
    if (!(key in vars)) throw new Error(`unknown placeholder ${match}`);
    return vars[key];
  });
}
const expandDeep = (value, vars) =>
  typeof value === 'string' ? expand(value, vars) : Array.isArray(value) ? value.map((v) => expandDeep(v, vars)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandDeep(v, vars)])) : value;

/** What is wrong with a scenario file, as a list of sentences; empty when it can run. */
export function validateScenario(s, config) {
  const problems = [];
  const bad = (m) => problems.push(`${s.file ?? s.id}: ${m}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s.id ?? '')) bad('id must be lower case words joined by hyphens');
  if (!s.title) bad('needs a title');
  if (!Array.isArray(s.covers) || s.covers.length === 0) bad('covers must name what the scenario protects');
  if (!Array.isArray(s.profiles) || s.profiles.length === 0 || s.profiles.some((p) => !(p in config.profiles))) bad(`profiles must be among ${Object.keys(config.profiles).join(', ')}`);
  if (!['lib', 'app'].includes(s.repo)) bad('repo must be lib or app');
  const filed = [s.issue, ...(s.files ?? [])];
  for (const issue of filed) {
    if (!issue || !issue.title || !issue.body || !Array.isArray(issue.labels)) bad('an issue needs a title, a body and labels');
    else if (issue.repo !== undefined && !['lib', 'app'].includes(issue.repo)) bad('an issue repo must be lib or app');
  }
  const ids = (s.files ?? []).map((f) => f.id);
  if (ids.some((id) => !/^[a-z][a-z0-9]*$/.test(id ?? '') || id === 'issue') || new Set(ids).size !== ids.length) bad('file ids must be unique lower case words other than "issue"');
  if (!Array.isArray(s.steps) || s.steps.length === 0) bad('needs steps');
  const checkProblems = (checks, where) => {
    if (!Array.isArray(checks) || checks.length === 0) return bad(`${where} needs checks`);
    for (const c of checks) if (!CHECK_TYPES.includes(c.type)) bad(`${where}: unknown check type "${c.type}"`);
  };
  for (const [i, step] of (s.steps ?? []).entries()) {
    const where = `step ${i + 1}`;
    const kinds = Object.keys(step).filter((k) => STEP_KINDS.includes(k));
    if (kinds.length !== 1) {
      bad(`${where} must have exactly one of ${STEP_KINDS.join(', ')}`);
      continue;
    }
    const kind = kinds[0];
    const body = step[kind];
    if (step.issue !== undefined && step.issue !== 'issue' && !ids.includes(step.issue)) bad(`${where} names the issue "${step.issue}", which no file creates`);
    if (kind === 'wait') {
      if (!(body.timeoutMinutes > 0)) bad(`${where}: wait needs timeoutMinutes`);
      checkProblems(body.checks, where);
    } else if (kind === 'expect') checkProblems(body.checks, where);
    else if (kind === 'settle') {
      if (!(body.minutes > 0)) bad(`${where}: settle needs minutes`);
    } else if (kind === 'comment') {
      if (typeof body !== 'string' || !body) bad(`${where}: comment needs text`);
    } else if (kind === 'label' || kind === 'unlabel') {
      if (!Array.isArray(body) || body.length === 0) bad(`${where}: ${kind} needs a list of labels`);
    } else if (kind === 'close') {
      if (!['completed', 'not_planned'].includes(body)) bad(`${where}: close needs completed or not_planned`);
    } else if (kind === 'dispatch') {
      if (!body.workflow) bad(`${where}: dispatch needs a workflow`);
      if (body.repo !== undefined && !['lib', 'app'].includes(body.repo)) bad(`${where}: dispatch repo must be lib or app`);
    }
  }
  try {
    const vars = { lib: 'o/lib', app: 'o/app', 'issue.number': '1', ...Object.fromEntries(ids.map((id) => [`${id}.number`, '2'])) };
    expandDeep({ issue: s.issue, files: s.files, steps: s.steps }, vars);
  } catch (error) {
    bad(error.message);
  }
  return problems;
}

// ------------------------------------------------------------------ one scenario

const isoSeconds = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

async function runAttempt(scenario, profileName, ctx, attempt) {
  const { gh, config } = ctx;
  const profile = config.profiles[profileName];
  const repos = { lib: `${ctx.owner}/${profile.lib}`, app: `${ctx.owner}/${profile.app}` };
  const startedAt = ctx.now();
  const tag = `e2e ${ctx.runId}-${scenario.id}${attempt > 1 ? `-r${attempt}` : ''}`;
  const windowStart = isoSeconds(startedAt - CLOCK_SKEW_MS);
  const vars = { lib: repos.lib, app: repos.app };
  const created = {};
  const results = [];
  const log = (message) => ctx.log(`${scenario.id} (${profileName}${attempt > 1 ? `, attempt ${attempt}` : ''}): ${message}`);
  let status = 'pass';
  let error;

  const target = (id = 'issue') => {
    if (!created[id]) throw new Error(`no issue "${id}" has been filed yet`);
    return created[id];
  };

  async function file(id, spec) {
    const repo = repos[spec.repo ?? scenario.repo];
    const body = `${expand(spec.body, vars)}\n\n${MARKER(tag)}`;
    const issue = await gh.createIssue(repo, { title: `[${tag}] ${expand(spec.title, vars)}`, body, labels: spec.labels });
    created[id] = { repo, number: issue.number, url: issue.html_url ?? `https://github.com/${repo}/issues/${issue.number}`, other: repos[(spec.repo ?? scenario.repo) === 'lib' ? 'app' : 'lib'] };
    vars[`${id}.number`] = String(issue.number);
    log(`filed ${created[id].url}`);
  }

  async function snapshot(id = 'issue') {
    const t = target(id);
    const [issue, comments, timeline, runs, botHere, botThere, statusIssue] = await Promise.all([
      gh.getIssue(t.repo, t.number),
      gh.listComments(t.repo, t.number),
      gh.timeline(t.repo, t.number),
      gh.listRuns(t.repo, ctx.suiteSince),
      gh.listBotIssues(t.repo, ctx.suiteSince),
      gh.listBotIssues(t.other, ctx.suiteSince),
      gh.findStatusIssue(t.repo),
    ]);
    // Nothing ties a gate's run to an issue: a gh-aw run is titled with the workflow, not with the issue, and a failure issue
    // names only the run that failed. So a run, or a failure issue, belongs to the scenario when it started after the
    // scenario did, and the scenarios of a pair run one at a time (see runSuite).
    const mine = runs.filter((r) => r.created_at >= windowStart);
    const failureIssues = [...botHere.map((i) => ({ ...i, repo: t.repo })), ...botThere.map((i) => ({ ...i, repo: t.other }))].filter((i) => i.created_at >= windowStart);
    return {
      repo: t.repo,
      runner: ctx.runner,
      issue: { state: issue.state, state_reason: issue.state_reason ?? null, labels: issue.labels.map((l) => (typeof l === 'string' ? l : l.name)), assignees: (issue.assignees ?? []).map((a) => a.login) },
      comments: comments.map((c) => ({ author: c.user?.login ?? '', authorType: c.user?.type ?? '', body: c.body ?? '' })),
      pullRequests: [...new Set(timeline.filter((e) => e.event === 'cross-referenced' && e.source?.issue?.pull_request).map((e) => e.source.issue.number))],
      runs: mine.map((r) => ({ id: r.id, name: r.name, status: r.status, conclusion: r.conclusion })),
      botIssues: failureIssues.map((i) => ({ number: i.number, title: i.title, repo: i.repo })),
      statusIssue,
    };
  }

  const record = (phase, checkResults) => results.push(...checkResults.map((r) => ({ phase, ...r })));
  const failing = (checkResults) => checkResults.filter((r) => !r.ok && !r.warn);

  async function waitFor(phase, id, checks, timeoutMinutes) {
    const deadline = ctx.now() + timeoutMinutes * MINUTE;
    for (;;) {
      const snap = await snapshot(id);
      const evaluated = evaluateChecks(checks, snap);
      const stop = evaluated.some((r, i) => !r.ok && !r.warn && FAIL_FAST.has(checks[i].type));
      if (stop || failing(evaluated).length === 0 || ctx.now() >= deadline) {
        const bad = failing(evaluated);
        if (!bad.length) {
          record(phase, evaluated);
          return true;
        }
        // The cause first. After a failed run the checks that wait for an outcome are noise, so only the ones that failed fast are kept.
        results.push({ phase, name: stop ? 'a run failed' : `no answer after ${timeoutMinutes} minutes`, type: 'wait', ok: false, warn: false, detail: describeSnapshot(snap) });
        record(phase, stop ? evaluated.filter((_r, i) => FAIL_FAST.has(checks[i].type)) : evaluated);
        return false;
      }
      await ctx.sleep(ctx.pollMs);
    }
  }

  async function settle(phase, id, minutes) {
    await ctx.sleep(minutes * MINUTE);
    const deadline = ctx.now() + SETTLE_EXTRA_MINUTES * MINUTE;
    for (;;) {
      const snap = await snapshot(id);
      if (snap.runs.every((r) => r.status === 'completed') || ctx.now() >= deadline) {
        if (!snap.runs.every((r) => r.status === 'completed')) results.push({ phase, name: 'settled', type: 'settle', ok: true, warn: true, detail: `runs were still going ${SETTLE_EXTRA_MINUTES} minutes after the quiet period` });
        return;
      }
      await ctx.sleep(ctx.pollMs);
    }
  }

  async function execute(step, index) {
    const phase = `step ${index + 1}`;
    const kind = STEP_KINDS.find((k) => k in step);
    const id = step.issue ?? 'issue';
    const t = () => target(id);
    switch (kind) {
      case 'wait':
        return waitFor(`${phase} wait`, id, expandDeep(step.wait.checks, vars), step.wait.timeoutMinutes);
      case 'expect': {
        const evaluated = evaluateChecks(expandDeep(step.expect.checks, vars), await snapshot(id));
        record(`${phase} expect`, evaluated);
        return failing(evaluated).length === 0;
      }
      case 'settle':
        await settle(`${phase} settle`, id, step.settle.minutes);
        return true;
      case 'comment':
        await gh.comment(t().repo, t().number, expand(step.comment, vars));
        return true;
      case 'label':
        await gh.addLabels(t().repo, t().number, step.label);
        return true;
      case 'unlabel':
        for (const label of step.unlabel) await gh.removeLabel(t().repo, t().number, label);
        return true;
      case 'close':
        await gh.closeIssue(t().repo, t().number, step.close);
        return true;
      case 'dispatch':
        await gh.dispatch(repos[step.dispatch.repo ?? scenario.repo], step.dispatch.workflow, expandDeep(step.dispatch.inputs ?? {}, vars));
        return true;
      default:
        throw new Error(`unknown step ${JSON.stringify(step)}`);
    }
  }

  try {
    for (const f of scenario.files ?? []) await file(f.id, f);
    await file('issue', scenario.issue);
    for (const [index, s] of scenario.steps.entries()) {
      if (!(await execute(s, index))) {
        status = 'fail';
        break;
      }
    }
  } catch (e) {
    status = 'error';
    error = e.message;
    log(`error: ${error}`);
  }

  // Whatever happened, nothing the scenario filed stays open: the opt-out first, so that no gate wakes up on the close.
  const cleanup = [];
  for (const [id, t] of Object.entries(created).reverse()) {
    try {
      await gh.addLabels(t.repo, t.number, [OPT_OUT]);
      await gh.closeIssue(t.repo, t.number, 'not_planned');
    } catch (e) {
      cleanup.push(`${id} ${t.repo}#${t.number}: ${e.message}`);
    }
  }
  // Closing the issues started runs of its own (the janitor, the reporter notice). They end before the next scenario of the
  // pair begins, or a failure of theirs would be blamed on it.
  try {
    const deadline = ctx.now() + QUIESCE_MINUTES * MINUTE;
    for (;;) {
      const runs = (await Promise.all(Object.values(repos).map((repo) => gh.listRuns(repo, ctx.suiteSince)))).flat();
      if (runs.filter((r) => r.created_at >= windowStart).every((r) => r.status === 'completed') || ctx.now() >= deadline) break;
      await ctx.sleep(ctx.pollMs);
    }
  } catch (e) {
    cleanup.push(`waiting for the runs to end: ${e.message}`);
  }
  log(`${status}${status === 'fail' ? `: ${failing(results).map((r) => r.name).join(', ')}` : ''}`);
  return {
    attempt,
    status,
    error,
    checks: results,
    issues: Object.values(created).map((t) => t.url),
    cleanupErrors: cleanup,
    seconds: Math.round((ctx.now() - startedAt) / 1000),
  };
}

/** Runs a scenario, once more when it fails: a model does not answer the same way twice, and a real regression fails both times. */
export async function runScenario(scenario, profileName, ctx) {
  const attempts = [];
  const most = 1 + (scenario.retry === false ? 0 : ctx.retries);
  for (let attempt = 1; attempt <= most; attempt++) {
    const result = await runAttempt(scenario, profileName, ctx, attempt);
    attempts.push(result);
    if (result.status === 'pass') break;
  }
  const last = attempts.at(-1);
  return { id: scenario.id, title: scenario.title, profile: profileName, status: last.status, flaky: last.status === 'pass' && attempts.length > 1, attempts };
}

// ------------------------------------------------------------------ the suite

/** The pairs run side by side; the scenarios of one pair run one after another, because their runs cannot be told apart. */
export async function runSuite({ scenarios, profiles, ctx }) {
  const tasks = scenarios.flatMap((s) => profiles.filter((p) => s.profiles.includes(p)).map((p) => ({ s, p })));
  const results = new Array(tasks.length);
  const lanes = new Map();
  tasks.forEach((task, i) => lanes.set(task.p, [...(lanes.get(task.p) ?? []), i]));
  await Promise.all(
    [...lanes.values()].map(async (indexes) => {
      for (const i of indexes) results[i] = await runScenario(tasks[i].s, tasks[i].p, ctx);
    }),
  );
  return results;
}

export function renderSummary(results, meta) {
  const failed = results.filter((r) => r.status !== 'pass');
  const lines = [
    `## Issue Concierge end-to-end run ${meta.runId}`,
    '',
    `${results.length - failed.length} of ${results.length} scenarios passed${results.some((r) => r.flaky) ? ` (${results.filter((r) => r.flaky).length} only on a second attempt)` : ''}. Sandbox: ${meta.owner}. ${Object.entries(meta.pins ?? {}).map(([p, v]) => `${p} pair pinned at ${v}`).join('; ')}.`,
    '',
    '| Scenario | Profile | Result | Attempts | Time | Issues |',
    '| - | - | - | - | - | - |',
    ...results.map((r) => `| ${r.id} | ${r.profile} | ${r.status}${r.flaky ? ' (flaky)' : ''} | ${r.attempts.length} | ${r.attempts.reduce((n, a) => n + a.seconds, 0)} s | ${r.attempts.flatMap((a) => a.issues).map((u) => `[${u.split('/').slice(-3).join('/').replace('/issues/', '#')}](${u})`).join(', ')} |`),
  ];
  for (const r of failed) {
    lines.push('', `### ${r.id} (${r.profile}): ${r.status}`);
    const last = r.attempts.at(-1);
    if (last.error) lines.push(`- error: ${last.error}`);
    for (const c of last.checks.filter((c) => !c.ok && !c.warn)) lines.push(`- ${c.phase}: **${c.name}**: ${c.detail}`);
  }
  const warnings = results.flatMap((r) => r.attempts.at(-1).checks.filter((c) => !c.ok && c.warn).map((c) => `- ${r.id} (${r.profile}) ${c.phase}: ${c.name}: ${c.detail}`));
  if (warnings.length) lines.push('', '### Warnings (not failures)', ...warnings);
  const leftovers = results.flatMap((r) => r.attempts.flatMap((a) => a.cleanupErrors.map((e) => `- ${r.id} (${r.profile}): ${e}`)));
  if (leftovers.length) lines.push('', '### Cleanup left something open', ...leftovers);
  return `${lines.join('\n')}\n`;
}

/** Closes the issues of earlier runs that were left open (a run that was killed): they carry the run marker in the body. */
export async function cleanupStale({ gh, config, owner, hours, now }) {
  const closed = [];
  const limit = isoSeconds(now() - hours * 60 * MINUTE);
  for (const profile of Object.values(config.profiles)) {
    for (const name of [profile.lib, profile.app]) {
      const repo = `${owner}/${name}`;
      for (const issue of await gh.listOpenIssues(repo)) {
        if (!(issue.body ?? '').includes('<!-- e2e-run:') || issue.created_at >= limit) continue;
        await gh.addLabels(repo, issue.number, [OPT_OUT]);
        await gh.closeIssue(repo, issue.number, 'not_planned');
        closed.push(`${repo}#${issue.number}`);
      }
    }
  }
  return closed;
}

// ------------------------------------------------------------------ command line

function parseArgs(argv) {
  const flags = new Set(['yes', 'list']);
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument "${argv[i]}"`);
    if (flags.has(key)) opts[key] = true;
    else {
      if (argv[i + 1] === undefined) throw new Error(`--${key} needs a value`);
      opts[key] = argv[++i];
    }
  }
  return opts;
}

export async function main(argv = process.argv.slice(2), env = process.env, io = { out: (m) => console.log(m), err: (m) => console.error(m) }) {
  let opts;
  try {
    opts = parseArgs(argv);
    const config = loadConfig();
    const scenarios = loadScenarios();
    const problems = scenarios.flatMap((s) => validateScenario(s, config));
    if (problems.length) {
      problems.forEach((p) => io.err(`::error::${p}`));
      return 2;
    }
    // A scenario is named by its id or by its number ("10" is command-accepts-a-held-request).
    const named = (token) => scenarios.find((s) => s.id === token || (/^\d+$/.test(token) && s.number === Number(token)));
    const tokens = opts.scenario ? opts.scenario.split(',') : scenarios.map((s) => s.id);
    const unknown = tokens.filter((token) => !named(token));
    if (unknown.length) throw new Error(`unknown scenario ${unknown.join(', ')}`);
    const wanted = tokens.map((token) => named(token).id);
    const profiles = !opts.profile || opts.profile === 'all' ? Object.keys(config.profiles) : [opts.profile];
    if (profiles.some((p) => !(p in config.profiles))) throw new Error(`--profile must be all or one of ${Object.keys(config.profiles).join(', ')}`);
    const selected = scenarios.filter((s) => wanted.includes(s.id));
    const owner = env.E2E_OWNER || config.owner;

    if (opts.list) {
      selected.forEach((s) => io.out(`${s.number}\t${s.id}\t${s.profiles.join(',')}\t${s.steps.length} steps\t${s.title}`));
      return 0;
    }
    if (!opts.yes && !opts['cleanup-stale']) {
      io.out(`Plan only (add --yes to run). Sandbox owner ${owner}; retries ${opts.retries ?? 1}.`);
      for (const s of selected) for (const p of profiles.filter((p) => s.profiles.includes(p))) io.out(`- scenario ${s.number}, ${s.id}, on ${owner}/${config.profiles[p][s.repo]} (${p}): ${s.title}`);
      return 0;
    }

    const gh = createGitHub();
    if (opts['cleanup-stale']) {
      const closed = await cleanupStale({ gh, config, owner, hours: Number(opts['cleanup-stale']), now: Date.now });
      io.out(closed.length ? `Closed ${closed.length} left-over issues: ${closed.join(', ')}` : 'No left-over issues.');
      return 0;
    }
    const now = Date.now();
    const runId = new Date(now).toISOString().replace(/[-:T]/g, '').slice(2, 12) + Math.random().toString(36).slice(2, 5);
    const runner = (await gh.user()).login;
    const pins = {};
    for (const p of profiles) {
      const pin = (await readPinText(gh, `${owner}/${config.profiles[p].lib}`)).match(/^version:\s*(\S+)/m);
      pins[p] = pin ? pin[1] : 'unknown';
    }
    const ctx = {
      gh, config, owner, runId, runner, pollMs: Number(opts['poll-seconds'] ?? 45) * 1000, retries: Number(opts.retries ?? 1), now: Date.now,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)), suiteSince: isoSeconds(now - MINUTE), log: (m) => io.err(`[${new Date().toISOString().slice(11, 19)}] ${m}`),
    };
    const results = await runSuite({ scenarios: selected, profiles, ctx });
    const summary = renderSummary(results, { runId, owner, pins });
    io.out(summary);
    if (opts.out) fs.writeFileSync(opts.out, JSON.stringify({ runId, owner, pins, results }, null, 2));
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
    return results.every((r) => r.status === 'pass') ? 0 : 1;
  } catch (error) {
    io.err(error.message);
    return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await main();
}
