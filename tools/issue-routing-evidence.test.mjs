import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyCrossRepo } from '../scripts/concierge-updater.mjs';

// What went wrong on frodo-cli#887 (run 40021303506, 2026-10-23): the Issue Worker (model `small`, 7 turns)
// read only the issue, labelled it `related-repo` with confidence HIGH and the rationale "per related-repos.md",
// and opened a canonical issue in the library. The repository's own related-repos.md told it to send
// "authentication flows" to the library, and the wrapper messages in the report ("Error getting tokens",
// "Error authenticating user") are produced by the library. The cause, `EAGAIN ... read`, was a terminal read
// in the CLI. The worker never opened a file, and its comment said "No change after this issue was opened
// touches the authentication code" although no search or listing in the run showed it. The library's plan
// worker then planned a wrong-layer fix and the coding agent started one (frodo-lib#785).
//
// These tests pin the prompt contract that answers it (docs/multi-phase-design.md, "Split-repo routing"):
// route on evidence found in both repositories, say only what a tool call showed, start the routed issue held,
// and let the plan gate say "Wrong layer" and stop. A prompt is the first layer: the hold label is also pinned
// where it takes effect (the compiled lock, tools/ci-compile-smoke.sh).

const REPO = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, REPO), 'utf8');
const parts = (md) => {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'frontmatter not found');
  return { frontmatter: m[1], body: m[2] };
};
/** What the agent sees: the body with HTML comments removed, as gh-aw renders it. */
const rendered = (md) => parts(md).body.replace(/<!--[\s\S]*?-->/g, '');
/** A section of a prompt: from its heading to the next heading of the same or a higher level. */
const section = (text, heading) => {
  const level = heading.match(/^#+/)[0].length;
  const start = text.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `section "${heading}" not found`);
  const rest = text.slice(start + 1);
  const next = rest.slice(heading.length).search(new RegExp(`\\n#{1,${level}} `));
  return next < 0 ? rest : rest.slice(0, heading.length + next);
};

const worker = read('workflows/issue-worker.md');
const workerPrompt = rendered(worker);
const routing = section(workerPrompt, '## Related repositories (linked-issue flow)');
const evidence = section(routing, '### Decide from evidence');
const create = section(routing, '### Create the linked issue');

test('issue worker: the routing section decides from evidence before it creates anything', () => {
  assert.ok(routing.indexOf('### Decide from evidence') < routing.indexOf('### Create the linked issue'));
  assert.match(routing, /Do this before you create anything\./);
});

test('issue worker: the `when` text and the notes are a guide to where to look, never evidence', () => {
  assert.match(routing, /They tell you where to look\. They are never evidence by themselves\./);
  assert.doesNotMatch(routing, /per the `when` text/, 'the old rule routed on the `when` text alone');
  assert.doesNotMatch(routing, /clearly belongs in a related repository/);
});

test('issue worker: it takes the innermost cause, not the wrapper another layer put around it', () => {
  assert.match(evidence, /Take the cause, not the wrapper\./);
  assert.match(evidence, /innermost error/);
  assert.match(evidence, /"Error getting tokens" around "EAGAIN: resource temporarily unavailable, read"/);
});

test('issue worker: it searches the code of BOTH repositories, in one step', () => {
  assert.match(evidence, /Use `search_code` in this repository and in the related one/);
  assert.match(evidence, /Run the two searches in step 2 in the same step/);
  assert.match(evidence, /Read the issue and its comments once/);
  assert.match(evidence, /Do not call `search_repositories`/);
});

test('issue worker: the layering a repository states outranks the `when` text', () => {
  assert.match(evidence, /Apply the layering the repository states\./);
  assert.match(evidence, /`AGENTS\.md` or an accepted decision record/);
  assert.match(evidence, /It outranks the `when` text\./);
});

test('issue worker: the rationale cites a file path, and HIGH needs one', () => {
  assert.match(evidence, /The `rationale` you give when you add `related-repo` names at least one file path from step 2/);
  assert.match(evidence, /has no evidence/);
  assert.match(evidence, /Give `confidence: HIGH` only when the rationale cites a file path from step 2/);
  assert.match(evidence, /Without such a path the confidence is never HIGH\./);
});

test('issue worker: missing, mixed or keyword-only evidence keeps the issue here and says which part might be elsewhere', () => {
  assert.match(routing, /If the evidence is missing, mixed \(the cause is found in both repositories\) or only a keyword matched, the issue stays in this repository/);
  assert.match(routing, /say plainly in your comment which part might belong in the other repository and why/);
  assert.match(routing, /When in doubt, keep it here\./);
});

test('issue worker: the link steps only apply once the evidence shows the issue belongs elsewhere', () => {
  assert.match(create, /When the evidence shows that the current issue belongs in a related repository:/);
  assert.match(create, /Set `temporary_id` to exactly `aw_canonical`/, 'the linked-issue contract moved with the steps');
});

test('issue worker: the analysis comment says only what a tool call in the run showed', () => {
  const analysis = section(workerPrompt, '## Analysis comment (reporter-facing)');
  assert.match(analysis, /Say only what you checked\. Every statement in the comment about the code, a commit, a pull request or another issue must come from a tool call you made in this run\./);
  assert.match(analysis, /A guess is never allowed, and neither is a "nothing has changed" or "nothing touches this" that no search or listing in this run showed\./);
});

test('issue worker: "already fixed or cannot reproduce" needs the listing and the code read as tool calls', () => {
  const fixed = section(workerPrompt, '### Already fixed or cannot reproduce');
  assert.match(fixed, /\(`list_commits`, `search_commits` or `search_pull_requests`\)/);
  assert.match(fixed, /\(`search_code`, `get_file_contents`\)/);
  assert.match(fixed, /Run steps 2 and 3 as tool calls\. If you did not run them, write nothing about whether the behavior is fixed, still present or cannot be reproduced; do not guess\./);
  assert.match(fixed, /Never write that no change touches a file or subsystem unless a listing or search in this run showed it\./);
});

test('the canonical issue starts held: create-issue carries the hold label and keeps the cross-repository marker', () => {
  const fm = parts(worker).frontmatter;
  const block = fm.match(/^ {2}create-issue:\n((?: {4}.*\n)+)/m);
  assert.ok(block, 'create-issue block not found in the frontmatter');
  assert.match(block[1], /^ {4}labels:\n {6}- plan-approval-required\n/m);
  assert.equal([...block[1].matchAll(/^ {6}- /gm)].length, 1, 'the hold is the only label the system adds');
  assert.equal((fm.match(/# concierge:cross-repo/g) ?? []).length, 1, 'the updater replaces this marker with the token and allowed repositories');
  assert.match(create, /Do not set labels on it\. The system opens it with the hold label `plan-approval-required`/);
});

test('the updater keeps the hold when it generates the cross-repository settings', () => {
  const generated = applyCrossRepo(worker, { repo: 'o/lib', secret: 'LIB_TOKEN' });
  const block = generated.match(/^ {2}create-issue:\n((?: {4}.*\n)+)/m)[1];
  assert.match(block, /labels:\n {6}- plan-approval-required\n/);
  assert.match(block, /github-token: \$\{\{ secrets\.LIB_TOKEN \}\}\n/);
  assert.match(block, /allowed-repos: \["o\/lib"\]\n/);
  const without = applyCrossRepo(worker, null).match(/^ {2}create-issue:\n((?: {4}.*\n)+)/m)[1];
  assert.match(without, /labels:\n {6}- plan-approval-required\n/, 'without related repositories the label stays and nothing else is added');
  assert.doesNotMatch(without, /github-token|allowed-repos/);
});

test('the budget of the issue worker is unchanged: the added searches fit the turns it already had', () => {
  const fm = parts(worker).frontmatter;
  // Measured on cli#887: 7 of 10 turns, 1.03 AIC. Two searches in one step and a single read of the issue add about two.
  assert.match(fm, /^max-turns: 10$/m);
  assert.match(fm, /^max-ai-credits: 16$/m);
  assert.match(fm, /^ {2}model: small$/m);
});

test('plan worker: a layer check says "Wrong layer" with the file it read, or "not verified"', () => {
  const plan = rendered(read('workflows/plan-worker.md'));
  const layer = section(plan, '## Layer check');
  assert.match(layer, /If that file does not exist, skip this section without comment\./);
  assert.match(layer, /Take the innermost error, not the wrapper another layer put around it/);
  assert.match(layer, /Search the related repository too when the report could belong there\./);
  assert.match(layer, /start the plan with one line: "Wrong layer: the fix belongs in \{owner\}\/\{repo\}, see \{file\}"/);
  assert.match(layer, /Never plan silently in the repository that happens to hold the issue\./);
  assert.match(layer, /"Layer: not verified"/);
  assert.match(layer, /If the code to change is in this repository, say nothing about layers\./);
  assert.match(section(plan, '## Plan contents'), /A "Wrong layer:" line, when the code to change is in the related repository \(see "Layer check"\)/);
});

test('plan triage: a "Wrong layer" plan adds the human hold and no hand-off, like a conflict with a record', () => {
  const triage = rendered(read('workflows/plan-triage.md'));
  const wrong = section(triage, '## A wrong layer');
  assert.match(wrong, /starts with, or has a line that starts with, "Wrong layer:"/);
  assert.match(wrong, /the plan worker found that the code to change is in another repository than the one holding this issue\. A coding agent started here would work in the wrong repository\./);
  assert.match(wrong, /add the label `plan-approval-required` unless the issue already carries it, and do \*\*not\*\* emit `plan-triage-handoff`, whatever the classification/);
  assert.match(wrong, /"The plan found that the fix belongs in another repository\. A maintainer has to move or re-route this issue\. Remove the plan-approval-required label to resume\."/);
  assert.match(wrong, /then post no comment, as under "A hold that is already there"/);
  assert.match(wrong, /You never lift this hold yourself/);
  assert.match(section(triage, '## Approval gate'), /or the plan reports a wrong layer \(see "A wrong layer"\), emit `plan-triage-handoff`/);
});

test('none of the new text is an HTML comment (gh-aw removes those from a prompt)', () => {
  for (const f of ['issue-worker', 'plan-worker', 'plan-triage']) {
    assert.equal((parts(read(`workflows/${f}.md`)).body.match(/<!--/g) ?? []).length, 0, `${f}.md`);
  }
});
