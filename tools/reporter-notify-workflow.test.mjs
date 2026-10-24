import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Reporter notify (docs/multi-phase-design.md, "Split-repo routing"): the plain workflow, the
// issue worker's instruction that goes with it, and the documentation that carries the design.

const REPO = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, REPO), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const yml = read('workflows/reporter-notify.yml');
const code = yml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const script = read('scripts/reporter-notify.mjs');
const worker = read('workflows/issue-worker.md');
const design = flat(read('docs/multi-phase-design.md'));
const deployment = flat(read('docs/deployment.md'));

// The link notice (2026-10-24, frodo-lib#803 to #806): the workflow starts when a linked issue is
// created, not only when it asks for information, and only for issues that have a Reported from line.
test('workflow: runs for a linked issue when it is opened or gets one of three labels, or by hand', () => {
  assert.match(code, /^name: "Concierge 1d ▸ Reporter Notify"$/m);
  assert.match(code, /^  issues:\n    types: \[opened, labeled\]$/m);
  assert.match(code, /^  workflow_dispatch:\n    inputs:\n      issue_number:/m);
  const cond = code.match(/^    if: (.+)$/m);
  assert.ok(cond, 'job condition not found');
  assert.match(cond[1], /github\.event_name == 'workflow_dispatch'/);
  assert.match(cond[1], /github\.event\.issue\.state == 'open'/);
  assert.match(cond[1], /github\.event\.issue\.pull_request == null/);
  assert.match(cond[1], /contains\(github\.event\.issue\.body, 'Reported from '\)/, 'only issues that have a link line');
  assert.match(cond[1], /github\.event\.action == 'opened'/);
  for (const label of ['plan-approval-required', 'issue-worker-ready', 'needs-info']) {
    assert.ok(cond[1].includes(`github.event.label.name == '${label}'`), `starts on ${label}`);
  }
  // No other label starts it: a linked issue collects a dozen label events in its first minutes.
  assert.equal((cond[1].match(/github\.event\.label\.name ==/g) || []).length, 3);
});

test('workflow: no LLM, no secret, least permissions, one script', () => {
  assert.match(code, /^permissions:\n  contents: read\n  issues: write$/m);
  assert.doesNotMatch(code, /secrets\./);
  assert.match(code, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(code, /run: node \.github\/scripts\/reporter-notify\.mjs/);
  assert.match(code, /^concurrency:\n  group: reporter-notify-/m);
});

test('script: reads with GET, and its only write is a comment on the issue (the link notice and the request notice share it)', () => {
  const posts = script.match(/'--method', 'POST'/g) || [];
  assert.equal(posts.length, 1);
  assert.match(script, /`repos\/\$\{repo\}\/issues\/\$\{number\}\/comments`, '--method', 'POST'/);
  assert.doesNotMatch(script, /--method', '(PATCH|PUT|DELETE)'/);
});

test('script: the wait for the proof is bounded, short and synchronous: no polling loop', () => {
  assert.match(script, /notifyLinkWithRetry\(issue, ctx, \{ attempts = 4, delayMs = 15000, sleep = sleepSync \} = \{\}\)/);
  assert.match(script, /for \(let attempt = 1; attempt <= attempts; attempt\+\+\)/);
  assert.match(script, /if \(attempt < attempts\) sleep\(delayMs\);/);
  assert.doesNotMatch(script, /while \(true\)|setInterval|setTimeout/);
  // 4 attempts, 15 s apart: at most 45 s of waiting in a 5 minute job.
  assert.match(yml, /timeout-minutes: 5/);
});

test('script: the link notice has its own marker and its exact text', () => {
  assert.match(script, /export const LINK_MARKER = `\$\{MARKER_PREFIX\}link -->`;/);
  assert.ok(script.includes('`Original report: ${c.ref}, reported by @${c.login}. Updates are posted on both threads.\\n\\n${LINK_MARKER}`'));
  // Only the bot's own comment counts as "already told".
  assert.match(script, /cm\.user\.login === BOT && cm\.user\.type === 'Bot' && \(cm\.body \|\| ''\)\.includes\(LINK_MARKER\)/);
});

test('issue worker: requests stand alone and carry no @handle; the system tells the reporter of a linked issue', () => {
  const s = flat(worker);
  assert.match(s, /Write the request so that it stands on its own, in the second person\./);
  assert.match(s, /Do not address anyone with an `@handle`: the system neutralizes a mention of anyone who is not part of this conversation/);
  assert.match(s, /the person who reported it is told separately by the system\. Do not try to do that yourself, and do not name that person\./);
});

test('manifest and docs list the workflow and its script', () => {
  const aw = read('aw.yml');
  assert.match(aw, /^  - workflows\/reporter-notify\.yml$/m);
  assert.match(aw, /^  - scripts\/reporter-notify\.mjs$/m);
  assert.match(read('README.md'), /reporter-notify\.yml/);
  assert.match(read('README.md'), /reporter-notify\.mjs/);
  assert.match(deployment, /\| `workflows\/reporter-notify\.yml` \| `\.github\/workflows\/reporter-notify\.yml` \|/);
  assert.match(deployment, /\| `scripts\/reporter-notify\.mjs` \| `\.github\/scripts\/reporter-notify\.mjs` \|/);
  assert.match(deployment, /It imports `janitor\.mjs`, so install that too\. It needs no secret/);
  assert.match(deployment, /confirm that one comment on the linked issue mentions the reporter and points at the request/);
  assert.match(design, /\| `Concierge 1d ▸ Reporter Notify` \| a linked issue is opened, or `plan-approval-required`, `issue-worker-ready` or `needs-info` is applied to it/);
});

test('design: why a workflow and not the model, and every rule that makes the mention safe', () => {
  assert.match(design, /GitHub cannot subscribe another user to an issue; being mentioned in a comment is what subscribes a user to the thread\./);
  assert.match(design, /gh-aw's output step neutralizes every `@handle` in an agent's comment except the people who take part in the event/);
  assert.match(design, /The login is the author of the original issue as GitHub returns it, never a name found in text/);
  assert.match(design, /Removing that label is how a maintainer unlinks the two issues, and it stops the notifications\./);
  assert.match(design, /has a comment by `github-actions\[bot\]` that names this issue/);
  assert.match(design, /Anyone can write a `Reported from` line; only the harness writes that comment/);
  assert.match(design, /Exactly one linked original passes, and its author is a person \(not a bot, an app or the coding agent\), not a maintainer of the original repository \(`OWNER`, `MEMBER` or `COLLABORATOR`/);
  assert.match(design, /and not the person who opened this issue \(they take part already\)\./);
  assert.match(design, /The comment contains exactly one mention and no internal terms\./);
});

test('design: the link notice, why the reporter may be mentioned twice, and the race with its real timeline', () => {
  assert.match(design, /`reporter-notify` posts two kinds of comment, each at most once, each with its own hidden marker\./);
  assert.match(design, /`Original report: \{owner\}\/\{repo\}#\{number\}, reported by @\{login\}\. Updates are posted on both threads\.` It needs no label\./);
  assert.match(design, /a person who quotes the marker cannot switch it off/);
  assert.match(design, /The most a thread gets is one link notice plus one notice per request\./);
  assert.match(design, /a comment written with the workflow token starts no workflow/);
  assert.match(design, /linked issue was created at 20:45:51\.96, `related-repo` was added at 20:45:53\.16 and the comment named frodo-lib#783 at 20:45:54\.97, about three seconds later/);
  assert.match(design, /at most four checks, 15 seconds apart, and only while that is the single reason for skipping/);
  assert.match(design, /The incident behind the link notice\.\*\* On 2026-10-24 the worker opened frodo-lib#803 to #806 from frodo-cli#919 to #922\./);
});

test('deployment: what an operator installs and checks for the link notice', () => {
  assert.match(deployment, /once when the issue is linked, and once for each request for information/);
  assert.match(deployment, /It runs when a linked issue \(one with a `Reported from` line\) is opened or gets `plan-approval-required`, `issue-worker-ready` or `needs-info`, or by hand for one issue\./);
  assert.match(deployment, /confirm that the linked issue gets one comment right after it is created that starts `Original report:` and mentions the reporter/);
});
