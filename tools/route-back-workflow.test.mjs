import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Route back (docs/multi-phase-design.md, "Routing back", decision 0031): the plain workflow, the script that does the
// one thing it may do, the prompts that hand findings from one repository's worker to the other's, and where it is
// installed and documented. What the script decides is pinned in scripts/route-back.test.mjs.
//
// What went wrong: frodo-cli#919 was routed to frodo-lib#803 because the routing worker read the code and saw that the
// CLI only formats what the library resolves, and it wrote none of that down; the library's plan worker then wrote
// "Layer: not verified ... probably in frodo-cli" about code it had not read, and nothing in the Concierge could move
// the work back (plan triage says "move or re-route", the closer leaves a not-planned close to a maintainer).

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
const yml = read('workflows/route-back.yml');
const code = yml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const script = read('scripts/route-back.mjs');
const design = flat(read('docs/multi-phase-design.md'));
const deployment = flat(read('docs/deployment.md'));

test('workflow: started by hand and by nothing else, for one open canonical issue, with a dry run', () => {
  assert.match(code, /^name: "Issue Concierge 4g ▸ Route Back"$/m);
  assert.match(code, /^on:\n {2}workflow_dispatch:\n {4}inputs:\n {6}issue_number:\n(?: {8}.*\n)*? {8}required: true\n/m);
  assert.match(code, / {6}dry_run:\n(?: {8}.*\n)*? {8}type: boolean\n {8}default: false\n/);
  const triggers = code.match(/^on:\n((?: {2,}.*\n|\n)+)/m)[1];
  assert.doesNotMatch(triggers, /^ {2}(issues|issue_comment|schedule|pull_request|push):/m, 'moving work to another repository is a maintainer\'s act (record 0005)');
});

test('workflow: no LLM; the workflow token writes to this repository, the generated token to the other one', () => {
  assert.doesNotMatch(code, /copilot|gh-aw|engine:/i);
  assert.match(code, /^permissions:\n {2}contents: read\n {2}issues: write$/m);
  assert.equal((yml.match(/# concierge:cross-repo-env/g) ?? []).length, 1, 'one marker, in the step environment');
  assert.doesNotMatch(code, /secrets\./, 'a secret name in the source would be the same in every deployment');
  assert.match(yml, /GH_TOKEN: \$\{\{ github\.token \}\}\n(?: {10}.*\n)*? {10}# concierge:cross-repo-env\n {8}run:/);
  assert.match(code, /^concurrency:\n {2}group: route-back-\$\{\{ inputs\.issue_number \}\}\n {2}cancel-in-progress: false$/m);
  assert.match(code, /run: node \.github\/scripts\/route-back\.mjs \$\(\[ "\$DRY_RUN" = "true" \] && echo --dry-run\)/);
});

test('script: it writes only what a route back is, never lifts a hold, never touches the issue worker', () => {
  assert.match(script, /export const LABEL_HOLD = 'plan-approval-required';/);
  assert.match(script, /export const LABEL_HANDOFF = 'issue-triage-handoff';/);
  // the three labels it touches: the hold (added), the link label (removed), the hand-off (added)
  assert.equal((script.match(/addLabel\(original\.repo, original\.number, (LABEL_\w+)\)/g) || []).length, 2);
  assert.equal((script.match(/removeLabel\(original\.repo, original\.number, (LABEL_\w+)\)/g) || []).length, 1);
  assert.match(script, /removeLabel\(original\.repo, original\.number, LABEL_ORIGINAL\)/);
  assert.doesNotMatch(script, /removeLabel\([^)]*LABEL_HOLD/, 'a hold is never removed');
  assert.doesNotMatch(script, /no-auto-processing['"]\s*\)/, 'the opt-out label is only read');
  assert.doesNotMatch(script, /workflow_dispatch|dispatches|issue-worker/);
  assert.match(script, /state_reason=not_planned/);
  assert.match(script, /import \{ LABEL_CANONICAL, LABEL_ORIGINAL, readComments, verifyOriginal \} from '\.\/related-repo-closer\.mjs';/, 'the proof of the link is the closer\'s');
});

test('script: the canonical issue is closed after every other step', () => {
  const order = [...script.matchAll(/write\(`([^`]*)`/g)].map((m) => m[1]);
  assert.match(order[order.length - 1], /^closed /, order.join(' | '));
  assert.equal(order.filter((o) => o.startsWith('closed ')).length, 1);
});

test('installed by the updater and documented where an operator looks', () => {
  const aw = read('aw.yml');
  assert.match(aw, /^ {2}- workflows\/route-back\.yml$/m);
  assert.match(aw, /^ {2}- scripts\/route-back\.mjs$/m);
  assert.match(aw, /^ {2}- scripts\/related-repo-closer\.mjs$/m, 'what route-back imports');
  assert.match(read('README.md'), /route-back\.yml/);
  assert.match(read('README.md'), /route-back\.mjs/);
  assert.match(deployment, /### Route back/);
  assert.match(deployment, /\| `workflows\/route-back\.yml` \| `\.github\/workflows\/route-back\.yml` \|/);
  assert.match(deployment, /\| `scripts\/route-back\.mjs` \| `\.github\/scripts\/route-back\.mjs` \|/);
  assert.match(deployment, /\[ \] Route back installed where there is a `related-repos\.md`/);
  assert.match(design, /\| `Issue Concierge 4g ▸ Route Back` \|/);
  assert.match(design, /## Routing back/);
  assert.match(design, /\*\*What travels with a link\.\*\*/);
});

test('decision 0031 records it and the index lists it', () => {
  const record = read('docs/decisions/0031-the-work-of-a-link-is-routed-back-by-one-explicit-act.md');
  assert.match(record, /^ {2}- workflows\/route-back\.yml$/m);
  assert.match(record, /Nothing starts it by itself/);
  assert.match(record, /Workers hand findings to each other in text, as leads and never as facts\./);
  assert.match(read('docs/decisions/README.md'), /\| 0031 \| \[The work of a link is routed back by one explicit act\]\(0031-the-work-of-a-link-is-routed-back-by-one-explicit-act\.md\) \|/);
});

// ---------------------------------------------------------------- what the workers hand to each other

test('issue worker: the canonical issue carries a routing note, so the other repository\'s worker does not start from nothing', () => {
  const text = rendered(read('workflows/issue-worker.md'));
  const create = text.split('### Create the linked issue\n')[1].split('\n## ')[0];
  assert.match(create, /Body: include the original report, a line `Reported from \{owner\}\/\{repo\}#\{number\}` \(the original issue, whose number you know\), and under it a short "Routing note"\./);
  assert.match(create, /The note has three lines: the words in the report that name the failing component here \(your rationale, quoted\); what you read or searched to decide, with the file, or "nothing but the report"; and what you did not check\./);
  assert.match(create, /Only what the report or a tool call in this run showed: name no place where the fix lies beyond the words you quote\./);
});

test('issue worker: a note from the worker of another repository is a lead to check, not proof', () => {
  const text = rendered(read('workflows/issue-worker.md'));
  const section = text.split('\n### Opened from another repository\n')[1]?.split('\n### ')[0];
  assert.ok(section, 'section not found');
  assert.match(section, /It is a lead, not proof: check the part you can with the one tool call it needs/);
  assert.match(section, /say only what you checked/);
});

test('plan worker: it reads the routing note and the plan of the other repository as leads, checks the code they name, and never names a repository it did not read', () => {
  const text = rendered(read('workflows/plan-worker.md'));
  const layer = text.split('\n## Layer check\n')[1].split('\n## ')[0];
  assert.match(layer, /the "Routing note" in the issue body \(the words in the report that name the failing component, what the routing worker read, and what it did not check\)/);
  assert.match(layer, /the plan comment that comment links/);
  assert.match(layer, /These are leads, not facts: read the code a lead names, in the repository it names, before you rely on it/);
  assert.match(layer, /"Layer: confirmed, see \{file\}"/);
  assert.match(layer, /"Layer: not verified" in the plan's open questions and do not guess\. Name no repository as the likely home of the fix/);
  assert.match(layer, /The one exception is an issue that was routed here: it gets the "Layer: confirmed" line above/);
});
