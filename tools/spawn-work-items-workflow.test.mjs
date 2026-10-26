import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Work in more than one repository (docs/multi-phase-design.md, decision 0032): the plain workflow, the script that does
// the one thing it may do, the three prompts that make the plan the place where a split is proposed, and where it is
// installed and documented. What the script decides is pinned in scripts/spawn-work-items.test.mjs.
//
// Why: a fix can need a library function and the command that calls it. The Concierge knew "keep" and "route" and had no
// way to say "both"; the issue worker cannot split (it decides from untrusted text and is open to every reporter), so the
// plan worker, which reads the code on both sides, proposes the split and a maintainer starts it.

const REPO = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, REPO), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const parts = (md) => {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'frontmatter not found');
  return { frontmatter: m[1], body: m[2] };
};
/** What the agent sees: the body with HTML comments removed, as gh-aw renders it. */
const rendered = (md) => parts(md).body.replace(/<!--[\s\S]*?-->/g, '');
const section = (text, heading) => {
  const start = text.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `section "${heading}" not found`);
  const rest = text.slice(start + 1 + heading.length);
  const next = rest.search(/\n#{1,3} /);
  return rest.slice(0, next < 0 ? undefined : next);
};
const yml = read('workflows/spawn-work-items.yml');
const code = yml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const script = read('scripts/spawn-work-items.mjs');
const design = flat(read('docs/multi-phase-design.md'));
const deployment = flat(read('docs/deployment.md'));

test('workflow: started by hand and by nothing else, for one issue, with a dry run', () => {
  assert.match(code, /^name: "Concierge 2d ▸ Spawn Work Items"$/m);
  assert.match(code, /^on:\n {2}workflow_dispatch:\n {4}inputs:\n {6}issue_number:\n(?: {8}.*\n)*? {8}required: true\n/m);
  assert.match(code, / {6}dry_run:\n(?: {8}.*\n)*? {8}type: boolean\n {8}default: false\n/);
  const triggers = code.match(/^on:\n((?: {2,}.*\n|\n)+)/m)[1];
  assert.doesNotMatch(triggers, /^ {2}(issues|issue_comment|schedule|pull_request|push):/m, 'splitting a fix is a maintainer\'s act (record 0005)');
});

test('workflow: no LLM; the workflow token comments here, the signal token gates, the generated token creates there', () => {
  assert.doesNotMatch(code, /copilot|gh-aw|engine:/i);
  assert.match(code, /^permissions:\n {2}contents: read\n {2}issues: write$/m);
  assert.match(code, /SIGNAL_TOKEN: \$\{\{ secrets\.SIGNAL_TOKEN \}\}/);
  assert.equal((code.match(/secrets\./g) || []).length, 1, 'the only secret named in the source is the signal token');
  assert.equal((yml.match(/# concierge:cross-repo-env/g) ?? []).length, 1, 'one marker, in the step environment');
  assert.doesNotMatch(code, /CROSS_REPO(_TOKEN)?:/, 'the generated lines are not in the source');
  assert.match(yml, /GH_TOKEN: \$\{\{ github\.token \}\}\n(?: {10}.*\n)*? {10}# concierge:cross-repo-env\n {8}run:/);
  assert.match(code, /^concurrency:\n {2}group: spawn-work-items-\$\{\{ inputs\.issue_number \}\}\n {2}cancel-in-progress: false$/m);
  assert.match(code, /run: node \.github\/scripts\/spawn-work-items\.mjs \$\(\[ "\$DRY_RUN" = "true" \] && echo --dry-run\)/);
});

test('script: it creates, comments and gates, and never closes, unlabels, lifts a hold or routes', () => {
  assert.match(script, /export const LABEL_HOLD = 'plan-approval-required';/);
  assert.match(script, /export const LABEL_DEPENDENCY = 'dependency-required';/);
  assert.match(script, /createIssue\(item\.repo, childTitle\(item, originRef\), childBody\(item, originRef, verdict\.planUrl\), \[LABEL_HOLD\]\)/, 'a work item starts held and carries no other label');
  assert.doesNotMatch(script, /state=closed|--method', 'DELETE'|--method', 'PATCH'|removeLabel/);
  assert.doesNotMatch(script, /original-in-related-repo|related-repo['"]\s*\)|Reported from \$\{/, 'a work item is not the canonical issue of a link');
  assert.match(script, /import \{ readComments \} from '\.\/related-repo-closer\.mjs';/);
  assert.match(script, /if \(key !== lower\(ctx\.relatedRepo\)\) return skip\(/, 'only the configured related repository');
});

test('plan worker: work items are written only after reading both sides, in one exact form, naming only a listed repository', () => {
  const text = rendered(read('workflows/plan-worker.md'));
  const items = section(text, '## Work items');
  assert.match(items, /Only in a repository with `\.github\/agentic-workflows\/related-repos\.md`, and only when you read the code on both sides and found that the fix needs a change in this repository and a change in the related repository/);
  assert.match(items, /If the whole fix is in one repository, write no work items and say nothing about them\./);
  assert.match(items, /Work item: \{owner\}\/\{repo\} \| \{what changes, in one sentence\} \| where: \{the file or function you read\} \| order: \{first, independent or this\}/);
  assert.match(items, /`order: this` is the line for this repository\./);
  assert.match(items, /Name only a repository that `related-repos\.md` lists, at most one line each\./);
  assert.match(section(text, '## Plan contents'), /"Work item:" lines, when the fix needs a change in this repository and in the related repository \(see "Work items"\)/);
});

test('plan triage: a plan that needs another repository is held like a wrong layer, and never lifted by the gate itself', () => {
  const triage = rendered(read('workflows/plan-triage.md'));
  const work = section(triage, '## Work in another repository');
  assert.match(work, /If the plan has a line that starts with "Work item:" for a repository other than the one holding this issue/);
  assert.match(work, /add the label `plan-approval-required` unless the issue already carries it, and do \*\*not\*\* emit `plan-triage-handoff`, whatever the classification\./);
  assert.match(work, /unless the issue already carries `plan-approval-required` \(then post no comment, as under "A hold that is already there"\)/);
  assert.match(work, /A maintainer splits it with the Spawn Work Items workflow, or removes the plan-approval-required label if this repository's part can go on alone\./);
  assert.match(work, /You never lift this hold yourself/);
  assert.match(triage, /A plan that needs work in another repository \(see "Work in another repository"\) is held the same way\./);
});

test('issue worker: it keeps an issue that needs both repositories, and never routes or splits a work item', () => {
  const text = rendered(read('workflows/issue-worker.md'));
  const related = section(text, '## Related repositories (linked-issue flow)');
  assert.match(related, /An issue with a `Part of \{owner\}\/\{repo\}#\{number\}` line is a work item that a maintainer approved in a plan of another issue: keep it here, never create a linked issue for it, and skip the rest of this section\./);
  assert.match(related, /When part of the work belongs in the related repository and part here, keep the issue\. Do not route it and do not create a linked issue/);
  assert.match(section(text, '### Opened from another repository'), /An issue with a `Part of \{owner\}\/\{repo\}#\{number\}` line was created from a plan/);
});

test('installed by the updater and documented where an operator looks', () => {
  const aw = read('aw.yml');
  assert.match(aw, /^ {2}- workflows\/spawn-work-items\.yml$/m);
  assert.match(aw, /^ {2}- scripts\/spawn-work-items\.mjs$/m);
  assert.match(read('README.md'), /spawn-work-items\.yml/);
  assert.match(read('README.md'), /spawn-work-items\.mjs/);
  assert.match(deployment, /### Spawn work items/);
  assert.match(deployment, /\| `workflows\/spawn-work-items\.yml` \| `\.github\/workflows\/spawn-work-items\.yml` \|/);
  assert.match(deployment, /\| `scripts\/spawn-work-items\.mjs` \| `\.github\/scripts\/spawn-work-items\.mjs` \|/);
  assert.match(deployment, /\[ \] Spawn work items installed where there is a `related-repos\.md`/);
  assert.match(design, /\| `Concierge 2d ▸ Spawn Work Items` \|/);
  assert.match(design, /## Work in more than one repository/);
  assert.match(design, /\*\*Intake does not split\.\*\*/);
});

test('decision 0032 records it and the index lists it', () => {
  const record = read('docs/decisions/0032-a-fix-that-needs-two-repositories-is-split-from-its-plan-by-a-maintainer.md');
  assert.match(record, /^ {2}- workflows\/spawn-work-items\.yml$/m);
  assert.match(record, /The issue worker never splits an issue\./);
  assert.match(record, /Releasing the first part and bumping the pin stay with a maintainer or Dependabot/);
  assert.match(read('docs/decisions/README.md'), /\| 0032 \| \[A fix that needs two repositories is split from its plan by a maintainer\]\(0032-a-fix-that-needs-two-repositories-is-split-from-its-plan-by-a-maintainer\.md\) \|/);
});
