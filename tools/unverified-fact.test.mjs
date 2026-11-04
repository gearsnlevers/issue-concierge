import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// On 2026-11-04 the plan for frodo-cli#591 labelled the name of a configuration entity "Hypothesis (unverified)" and
// listed it as an open question, plan triage rated it medium and low and handed it on, and the coding agent, whose
// firewall blocked the documentation host, named an entity from memory and described it as fact in the pull request.
// A plan that rests on a fact it could not confirm is now held for a maintainer (docs/decisions/0042-..., and
// docs/multi-phase-design.md, "Unverified fact"). The plan worker writes the line, plan triage holds on it, the
// options comment names it, and the PR worker's static instructions tell the coding agent not to build on a guess.
const REPO = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, REPO), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const prompt = (name) => read(`workflows/${name}.md`).replace(/<!--[\s\S]*?-->/g, '');
const section = (text, heading) => flat(text.split(`\n## ${heading}\n`)[1].split('\n## ')[0]);

const worker = prompt('plan-worker');
const triage = prompt('plan-triage');
const unverified = section(worker, 'Unverified facts');
const hold = section(triage, 'An unverified fact');

test('plan worker: the plan contents list the line, in the form the options comment and plan triage read', () => {
  assert.match(worker, /- An "Unverified:" line for each fact the change depends on that you could not confirm \(see "Unverified facts"\)/);
  assert.match(unverified, /Unverified: \{the fact\} \| tried: \{what you read or fetched, and what stopped you\}/);
  assert.match(unverified, /Write at most three such lines/);
});

test('plan worker: a blocked, refused or empty lookup confirmed nothing, and a candidate is never written as the answer', () => {
  assert.match(unverified, /A lookup that was blocked, refused or empty confirmed nothing\./);
  assert.match(unverified, /do not write a candidate into the plan as if it were the answer: where the plan has to name the fact, name it as unknown/);
});

test('plan worker: a cause labelled "Hypothesis (unverified)" that the change would fix counts, a detail in the code or a design choice does not', () => {
  assert.match(unverified, /A cause that you label "Hypothesis \(unverified\)" \(see "Reports with a runtime failure"\) is such a fact when the change would fix that cause, so give it an "Unverified:" line too\./);
  assert.match(unverified, /Do not write the line for a detail that the coding agent can read in the code when it works, for a choice of design or scope that is the maintainer's to make \(put those in the open questions\), or for a fact that you did confirm\./);
});

test('plan worker: the section sits after the change check and before the repository guidance, and names no label', () => {
  const headings = [...worker.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.equal(headings.indexOf('Unverified facts'), headings.indexOf('Change check') + 1);
  assert.equal(headings[headings.indexOf('Unverified facts') + 1], 'Repository guidance');
  assert.doesNotMatch(unverified, /plan-approval-required|plan-triage-handoff|plan-worker-ready|complexity\/|risk\//);
});

test('plan triage: a plan with an "Unverified:" line is classified, labelled and held, and neither label is lowered', () => {
  assert.match(hold, /If the plan has a line that starts with "Unverified:"/);
  assert.match(hold, /Classify as usual and apply the complexity and risk labels, whatever they are: do not lower either because the plan calls the change small\./);
  assert.match(hold, /Add the label `plan-approval-required` unless the issue already carries it, and do \*\*not\*\* emit `plan-triage-handoff`, whatever the classification\./);
  assert.match(flat(section(triage, 'Approval gate')), /A plan that needs work in another repository \(see "Work in another repository"\) is held the same way\. So is a plan that rests on a fact it could not confirm \(see "An unverified fact"\)\./);
});

test('plan triage: the comment says what is missing and how to resume, and is not posted again on a hold that is already there', () => {
  assert.match(hold, /"The plan could not confirm a fact the change depends on \(see the Unverified line in the plan\)\. A maintainer has to supply it or accept the risk\. Remove the plan-approval-required label to resume\."/);
  assert.match(hold, /unless the issue already carries `plan-approval-required` \(then post no comment, as under "A hold that is already there"\)/);
  assert.match(hold, /You never lift this hold yourself: removing the label is the maintainer's decision, and `plan-approval-resume` hands the issue on\./);
});

test('plan triage: the hold uses the labels that exist and adds none', () => {
  const labels = [...hold.matchAll(/`([a-z][a-z-]+)`/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(labels)].sort(), ['plan-approval-required', 'plan-approval-resume', 'plan-triage-handoff']);
});

test('pr worker: the static instructions tell the coding agent not to build on a guess, and to say what it could not confirm', () => {
  const frontmatter = read('workflows/pr-worker.md').match(/^---\n([\s\S]*?)\n---\n/)[1];
  const block = flat(frontmatter.match(/custom-instructions: \|\n((?:      .*\n?)+)/)?.[1] ?? '');
  assert.ok(block, 'custom-instructions block not found in the frontmatter');
  assert.match(block, /Do not build on a guess\. If a fact that decides what you build is unverified or still open in the plan \(the name of an object in another system, a file format, what a service returns\) and you cannot confirm it from the code, the tests, the repository's records or a page you can read, stop and comment on the issue with what you could not confirm instead of writing code\./);
  assert.match(block, /A lookup that was blocked or failed \(a firewall block, a failed fetch\) confirmed nothing\. In the pull request description, say which facts you could not confirm, including such a lookup, and what you assumed\./);
});

test('pr worker: the rule changes nothing about what the worker reads or does', () => {
  const source = read('workflows/pr-worker.md');
  assert.doesNotMatch(source.split('\n---\n')[0], /min-integrity/);
  assert.match(prompt('pr-worker'), /stop on a missing dependency, stop instead of building on a fact the plan leaves unverified, follow the repository's/);
});

test('the compile smoke reads the instruction in the compiled PR worker, where it takes effect', () => {
  const smoke = read('tools/ci-compile-smoke.sh');
  assert.match(smoke, /grep -q 'Do not build on a guess' "\$tmp\/\.github\/workflows\/pr-worker\.lock\.yml"/);
});
