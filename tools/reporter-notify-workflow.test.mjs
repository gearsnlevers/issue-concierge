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

test('workflow: runs when needs-info is applied to an open issue that is not a pull request, or by hand', () => {
  assert.match(code, /^name: "Concierge 1d ▸ Reporter Notify"$/m);
  assert.match(code, /^  issues:\n    types: \[labeled\]$/m);
  assert.match(code, /^  workflow_dispatch:\n    inputs:\n      issue_number:/m);
  const cond = code.match(/^    if: (.+)$/m);
  assert.ok(cond, 'job condition not found');
  assert.match(cond[1], /github\.event_name == 'workflow_dispatch'/);
  assert.match(cond[1], /github\.event\.label\.name == 'needs-info'/);
  assert.match(cond[1], /github\.event\.issue\.state == 'open'/);
  assert.match(cond[1], /github\.event\.issue\.pull_request == null/);
});

test('workflow: no LLM, no secret, least permissions, one script', () => {
  assert.match(code, /^permissions:\n  contents: read\n  issues: write$/m);
  assert.doesNotMatch(code, /secrets\./);
  assert.match(code, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(code, /run: node \.github\/scripts\/reporter-notify\.mjs/);
  assert.match(code, /^concurrency:\n  group: reporter-notify-/m);
});

test('script: reads with GET, and its only write is one comment on the issue', () => {
  const posts = script.match(/'--method', 'POST'/g) || [];
  assert.equal(posts.length, 1);
  assert.match(script, /`repos\/\$\{repo\}\/issues\/\$\{number\}\/comments`, '--method', 'POST'/);
  assert.doesNotMatch(script, /--method', '(PATCH|PUT|DELETE)'/);
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
  assert.match(design, /\| `Concierge 1d ▸ Reporter Notify` \| `needs-info` is applied to a linked issue/);
});

test('design: why a workflow and not the model, and every rule that makes the mention safe', () => {
  assert.match(design, /GitHub cannot subscribe another user to an issue; being mentioned in a comment is what subscribes a user to the thread\./);
  assert.match(design, /gh-aw's output step neutralizes every `@handle` in an agent's comment except the people who take part in the event/);
  assert.match(design, /The login is the author of the original issue as GitHub returns it, never a name found in text/);
  assert.match(design, /Removing that label is how a maintainer unlinks the two issues, and it stops the notifications\./);
  assert.match(design, /has a comment by `github-actions\[bot\]` that names this issue/);
  assert.match(design, /Anyone can write a `Reported from` line; only the harness writes that comment/);
  assert.match(design, /Exactly one linked original passes, and its author is a person \(not a bot, an app or the coding agent\)\./);
  assert.match(design, /The comment contains exactly one mention and no internal terms\./);
});
