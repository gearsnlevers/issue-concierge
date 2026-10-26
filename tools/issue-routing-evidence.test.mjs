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
// decide from the report text and keep by default, route only when the report itself names the failing component
// in the related repository (and quote it), never search to decide, say only what a tool call showed, start the
// routed issue held, and let the plan gate say "Wrong layer" and stop. A prompt is the first layer: the hold
// label is also pinned where it takes effect (the compiled lock, tools/ci-compile-smoke.sh).
//
// Why no search decides the routing: a replay of 33 historical issues (one pass per cell, the small and the
// default model) showed that code-search hits did not help in any form. Handing the model hits for the outer
// error text or the command hurt the small model (A 78.8% to AE 72.7%, B 90.9% to BE 81.8%); a confirm step
// ("keep when the other repository also matches, route only when this one finds nothing") was worse still (C:
// 75.8% on the small model, 81.8% on the default one; it routed 1 of 9 and 3 of 9 true library issues) because a
// CLI command that wraps a library function matches in both repositories. The corrected rule text alone gave
// 90.9% on both models. Under-routing is the cheap error (the plan gate reads the code and holds a wrong layer),
// so the text decides and a keep needs no tool call.

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
const decide = section(routing, '### Decide from the text');
const create = section(routing, '### Create the linked issue');

test('issue worker: the routing section decides before it creates anything', () => {
  assert.ok(routing.indexOf('### Decide from the text') < routing.indexOf('### Create the linked issue'));
  assert.match(routing, /Do this before you create anything\./);
});

test('issue worker: the `when` text and the notes are a guide to where to look, never evidence', () => {
  assert.match(routing, /They tell you where to look\. They are never evidence by themselves\./);
  assert.doesNotMatch(routing, /per the `when` text/, 'the old rule routed on the `when` text alone');
  assert.doesNotMatch(routing, /clearly belongs in a related repository/);
});

test('issue worker: it takes the innermost cause, not the wrapper another layer put around it', () => {
  assert.match(decide, /Take the cause, not the wrapper\./);
  assert.match(decide, /innermost error/);
  assert.match(decide, /"Error getting tokens" around "EAGAIN: resource temporarily unavailable, read"/);
});

test('issue worker: it decides from the text, keeps by default, and a keep needs no tool call', () => {
  assert.match(decide, /Apply the layering the repository states\./);
  assert.match(decide, /a keyword in them, in the title or in a wrapper message \("authentication", "import", "config"\) decides nothing/);
  assert.match(decide, /The default is to keep the issue here/);
  assert.match(decide, /or you cannot tell, go on with the normal analysis below and skip the rest of this section/);
  assert.match(decide, /A keep needs no tool call\./);
  assert.match(decide, /Deciding where an issue belongs needs no search/);
});

test('issue worker: the layering a repository states outranks the `when` text and any keyword', () => {
  assert.match(decide, /Apply the layering the repository states: the ownership lists in the file, and `AGENTS\.md` or an accepted decision record when the file points to them/);
  assert.match(decide, /That statement outranks the `when` text and any keyword\./);
  assert.match(decide, /do not open other files to find the layering/);
});

test('issue worker: no search decides the routing: no mandatory search, no both-repositories rule, no order of searches', () => {
  assert.doesNotMatch(decide, /`search_code`/, 'the routing section names no search tool');
  assert.doesNotMatch(decide, /confirm before you route/);
  assert.doesNotMatch(decide, /Make these two/);
  assert.doesNotMatch(decide, /\(a\) in THIS repository|\(b\) in the related repository/, 'the old order of two searches is gone');
  assert.doesNotMatch(decide, /If \(a\) finds|Route only when \(b\) finds/);
  assert.doesNotMatch(decide, /When both searches find something/, 'the both-repositories-match rule almost never lets a worker route');
  assert.doesNotMatch(decide, /at most two/);
  assert.doesNotMatch(routing, /Look in both repositories\./, 'the first version searched both repositories for every issue');
  assert.doesNotMatch(routing, /Use `search_code` in this repository and in the related one for that cause/);
  assert.match(decide, /Do not search the code to decide this: a command here that wraps a library function matches in both repositories, so a search finds both and settles nothing\./);
  assert.match(decide, /Never search to decide where an issue belongs\./);
  assert.match(decide, /Read the issue and its comments once\./);
  assert.match(decide, /Do not call `search_repositories`/);
});

test('issue worker: it routes only when the report itself names the failing component in the related repository', () => {
  assert.match(decide, /Route only when the report itself names the failing component in the related repository: a stack-trace path or a package of that repository, that repository's own command or API as the call that failed, or an error that only that repository can produce, in the innermost position\./);
  assert.match(decide, /A keyword from the `when` text, a wrapper message, or the name of a command that exists in both repositories is not enough\./);
});

test('issue worker: the rationale quotes the words that name the failing component, and HIGH needs the quote', () => {
  assert.match(decide, /The `rationale` you give when you add `related-repo` quotes the words in the report that name the failing component in the related repository\./);
  assert.match(decide, /A decision that rests on the `when` text, the title or a keyword has no such words and is a keep\./);
  assert.match(decide, /Give `confidence: HIGH` only when the rationale quotes those words\./);
  assert.match(decide, /Without a quote the confidence is MEDIUM or LOW, and the issue stays here\./);
});

test('issue worker: keeping is the safe side because the plan gate catches a wrong layer; the one allowed tool call is for a statement in the comment', () => {
  assert.match(decide, /Keeping is the safe side\. The plan gate reads the code, and when its layer check finds that the fix belongs in the other repository it says so and holds the issue for a maintainer\./);
  assert.match(decide, /An issue that stays here by mistake costs a comment; an issue routed by mistake costs a canonical issue and a plan in the wrong repository\./);
  assert.match(decide, /make the one tool call that statement needs \(see "Say only what you checked" below\)/);
});

test('issue worker: an issue kept because the report names nothing in the related repository says which part might be elsewhere', () => {
  assert.match(routing, /If you keep an issue because the report does not name a component of the related repository, skip the linked-issue steps below/);
  assert.match(routing, /say plainly in your comment which part might belong in the other repository and why/);
  assert.match(routing, /When in doubt, keep it here\./);
});

test('issue worker: the prompt states the turn budget, it is the one in the frontmatter, and nothing in the section needs a search', () => {
  const stated = decide.match(/you have (\d+) turns in all\./);
  assert.ok(stated, 'the turn budget is stated in the prompt');
  assert.equal(Number(stated[1]), Number(parts(worker).frontmatter.match(/^max-turns: (\d+)$/m)[1]), 'the prompt and the frontmatter agree');
  assert.match(decide, /a keep and a route both fit the turns you already had/);
  assert.doesNotMatch(decide, /turn 8/, 'no fallback for searches that are no longer made');
});

test('issue worker: the link steps only apply once the report names a failing component in the related repository', () => {
  assert.match(create, /When the report names a failing component in the related repository, so the current issue belongs there:/);
  assert.doesNotMatch(create, /When the evidence shows/);
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
  assert.match(block[1], /^ {4}labels:\n {6}- plan-approval-required\n {6}- original-in-related-repo\n/m);
  assert.equal([...block[1].matchAll(/^ {6}- /gm)].length, 2, 'the hold and the link label are the only labels the system adds (tools/original-in-related-repo.test.mjs)');
  assert.equal((fm.match(/# concierge:cross-repo/g) ?? []).length, 1, 'the updater replaces this marker with the token and allowed repositories');
  assert.match(create, /Do not set labels on it\. The system opens it with the hold label `plan-approval-required` and the link label `original-in-related-repo`/);
});

test('the updater keeps the hold when it generates the cross-repository settings', () => {
  const generated = applyCrossRepo(worker, { repo: 'o/lib', secret: 'LIB_TOKEN' });
  const block = generated.match(/^ {2}create-issue:\n((?: {4}.*\n)+)/m)[1];
  assert.match(block, /labels:\n {6}- plan-approval-required\n {6}- original-in-related-repo\n/);
  assert.match(block, /github-token: \$\{\{ secrets\.LIB_TOKEN \}\}\n/);
  assert.match(block, /allowed-repos: \["o\/lib"\]\n/);
  const without = applyCrossRepo(worker, null).match(/^ {2}create-issue:\n((?: {4}.*\n)+)/m)[1];
  assert.match(without, /labels:\n {6}- plan-approval-required\n {6}- original-in-related-repo\n/, 'without related repositories the labels stay and nothing else is added');
  assert.doesNotMatch(without, /github-token|allowed-repos/);
});

test('the budget of the issue worker: the routing decision adds no search and no turns, a report that names code gets 14', () => {
  const fm = parts(worker).frontmatter;
  // Measured on cli#887: 7 of 10 turns, 1.03 AIC. Neither a keep nor a route adds a search: the decision is made
  // from the report text after a single read of the issue.
  // Raised from 10 to 14 after frodo-lib#803 (tools/stalled-intake.test.mjs): a report that names a function makes the
  // worker check the code, and its first run used all ten turns on reading and searching and ended on
  // "429 Maximum LLM invocations exceeded (10 / 10)" before it posted anything; the second run posted its comment and
  // its label and then hit the same limit on the closing reply (1.54 AIC against a cap of 16). The prompt asks for
  // at most ten turns of checking, so the comment and the labels always fit.
  assert.match(fm, /^max-turns: 14$/m);
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
