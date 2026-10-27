// What a scenario may assert about an issue. A check is JSON, a snapshot is what the runner read from GitHub, and
// `evaluateCheck` answers { ok, detail }. Checks look at facts that the design promises (labels, the comment each gate
// leaves, how an issue ended, whether a run failed), never at the model's wording.
//
// A snapshot: { repo, issue: { state, state_reason, labels: [name], assignees: [login] },
//   comments: [{ author, authorType, body }], pullRequests: [number], runs: [{ name, conclusion, status }],
//   botIssues: [{ number, title }], statusIssue: { number, body } or null, runner: login }
const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);
const BOT = 'github-actions[bot]';

/** The comments one workflow of this repository left: gh-aw appends `gh-aw-workflow-call-id: owner/repo/workflow`. */
function workflowComments(snapshot, workflow) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const marker = new RegExp(`gh-aw-workflow-call-id:\\s*${escape(snapshot.repo)}/${escape(workflow)}(?![\\w-])`);
  return snapshot.comments.filter((c) => c.author === BOT && marker.test(c.body));
}

const list = (items) => (items.length ? items.join(', ') : 'none');

const TYPES = {
  // include / exclude: label names that must / must not be there. only: the exact set. oneWithPrefix: exactly one label
  // starts with each prefix, for example "complexity/".
  labels(check, s) {
    const have = s.issue.labels;
    const problems = [];
    for (const label of check.include ?? []) if (!have.includes(label)) problems.push(`missing ${label}`);
    for (const label of check.exclude ?? []) if (have.includes(label)) problems.push(`unexpected ${label}`);
    if (check.only) {
      const extra = have.filter((l) => !check.only.includes(l));
      const missing = check.only.filter((l) => !have.includes(l));
      if (extra.length) problems.push(`unexpected ${extra.join(', ')}`);
      if (missing.length) problems.push(`missing ${missing.join(', ')}`);
    }
    for (const prefix of check.oneWithPrefix ?? []) {
      const found = have.filter((l) => l.startsWith(prefix));
      if (found.length !== 1) problems.push(`expected one ${prefix}* label, found ${found.length} (${list(found)})`);
    }
    return { ok: problems.length === 0, detail: problems.length ? `${problems.join('; ')}; labels are ${list(have)}` : `labels are ${list(have)}` };
  },

  // workflow: count the comments of that workflow (the issue worker, the plan worker...). from "bot" (default), "runner"
  // or "any" when no workflow is named. match: a regular expression the body must match. count, min or max.
  comments(check, s) {
    let found = check.workflow ? workflowComments(s, check.workflow) : s.comments.filter((c) => (check.from ?? 'bot') === 'any' || (check.from === 'runner' ? c.author === s.runner : c.author === BOT));
    if (check.match) found = found.filter((c) => new RegExp(check.match, 'i').test(c.body));
    const what = `${check.workflow ? `${check.workflow} comments` : 'comments'}${check.match ? ` matching /${check.match}/` : ''}`;
    const n = found.length;
    const ok = (check.count === undefined || n === check.count) && (check.min === undefined || n >= check.min) && (check.max === undefined || n <= check.max);
    const want = check.count !== undefined ? `exactly ${check.count}` : [check.min !== undefined && `at least ${check.min}`, check.max !== undefined && `at most ${check.max}`].filter(Boolean).join(' and ');
    return { ok, detail: `${n} ${what}${ok ? '' : `, wanted ${want}`}` };
  },

  // state: "open" or "closed"; reason: how it was closed ("completed", "not_planned").
  state(check, s) {
    const { state, state_reason: reason } = s.issue;
    const ok = state === check.state && (check.reason === undefined || reason === check.reason);
    return { ok, detail: `issue is ${state}${reason ? ` (${reason})` : ''}${ok ? '' : `, wanted ${check.state}${check.reason ? ` (${check.reason})` : ''}`}` };
  },

  // No pull request refers to the issue and nobody, the coding agent included, is assigned: nothing started coding.
  noPullRequest(_check, s) {
    const problems = [];
    if (s.pullRequests.length) problems.push(`pull requests ${s.pullRequests.map((n) => `#${n}`).join(', ')}`);
    if (s.issue.assignees.length) problems.push(`assigned to ${s.issue.assignees.join(', ')}`);
    return { ok: problems.length === 0, detail: problems.length ? problems.join('; ') : 'no pull request, nobody assigned' };
  },

  // How many workflow runs belong to the issue (min, max). Without it "no run failed" would pass on zero runs, which is
  // what happens when the runs cannot be matched to the issue at all.
  runs(check, s) {
    const n = s.runs.length;
    const ok = (check.min === undefined || n >= check.min) && (check.max === undefined || n <= check.max);
    return { ok, detail: `${n} runs for this issue${ok ? '' : `, wanted ${[check.min !== undefined && `at least ${check.min}`, check.max !== undefined && `at most ${check.max}`].filter(Boolean).join(' and ')}`}` };
  },

  // No workflow run for this issue failed. A cancelled run is normal (a newer label event replaces a pending one).
  noFailedRuns(_check, s) {
    const failed = s.runs.filter((r) => r.status === 'completed' && FAILED_CONCLUSIONS.has(r.conclusion));
    return { ok: failed.length === 0, detail: failed.length ? `failed: ${failed.map((r) => `${r.name} (${r.conclusion})`).join(', ')}` : `${s.runs.length} runs, none failed` };
  },

  // The gates open an issue when a run fails; none was opened in the repositories of the pair.
  noFailureIssues(_check, s) {
    return { ok: s.botIssues.length === 0, detail: s.botIssues.length ? `opened by the bot: ${s.botIssues.map((i) => `${i.repo ?? s.repo}#${i.number} ${i.title}`).join('; ')}` : 'no issue opened by the bot' };
  },

  // match: a regular expression the status issue, the page the Concierge keeps pinned, must match; with absent: true it
  // must not. The page is read from the repository of the scenario's issue, and exists after the first run of the status workflow.
  statusIssue(check, s) {
    const page = s.statusIssue?.body;
    if (!page) return { ok: false, detail: 'there is no status issue yet' };
    const found = new RegExp(check.match, 'im').test(page);
    const ok = check.absent ? !found : found;
    return { ok, detail: `status issue #${s.statusIssue.number} ${found ? 'matches' : 'does not match'} /${check.match}/${ok ? '' : check.absent ? ', which it must not' : ', which it must'}` };
  },

  noBotComments(_check, s) {
    const n = s.comments.filter((c) => c.author === BOT).length;
    return { ok: n === 0, detail: `${n} comments by the bot` };
  },
};

export const CHECK_TYPES = Object.keys(TYPES);
/** A check that, once false, cannot become true again by waiting: the wait stops at once. */
export const FAIL_FAST = new Set(['noFailedRuns', 'noFailureIssues']);

export function evaluateCheck(check, snapshot) {
  const fn = TYPES[check.type];
  if (!fn) throw new Error(`unknown check type "${check.type}" (${CHECK_TYPES.join(', ')})`);
  const { ok, detail } = fn(check, snapshot);
  return { name: check.name ?? check.type, type: check.type, warn: Boolean(check.warn), ok, detail };
}

export const evaluateChecks = (checks, snapshot) => checks.map((check) => evaluateCheck(check, snapshot));

/** One paragraph for a failure report: where the issue stands, so that a timeout can be read without opening GitHub. */
export function describeSnapshot(s) {
  const gates = [...new Set(s.comments.filter((c) => c.author === BOT).map((c) => c.body.match(/gh-aw-workflow-call-id:\s*\S*\/([a-z]+(?:-[a-z]+)*)/i)?.[1] ?? 'other'))];
  const runs = s.runs.map((r) => `${r.name}: ${r.status === 'completed' ? r.conclusion : r.status}`);
  return [
    `state ${s.issue.state}${s.issue.state_reason ? ` (${s.issue.state_reason})` : ''}; labels ${list(s.issue.labels)}`,
    `bot comments from ${list(gates)}`,
    `runs ${runs.length ? runs.join('; ') : 'none yet'}`,
  ].join('. ');
}
