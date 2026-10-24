import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The plan gate stops for a human on high complexity OR high risk (docs/multi-phase-design.md,
// "Plan gate"). frodo-lib#783 was complexity low and risk high, went straight to the coding agent
// and got a plan that was still a hypothesis. These pins carry that rule: what plan triage adds and
// says, that nothing hands off while the label is there, that the resume workflow can act on both
// labels and learns who removed the label, and that the plan says what was checked.

const REPO = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, REPO), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const split = (md) => {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'frontmatter not found');
  return { frontmatter: m[1], body: m[2] };
};
/** One `## ` section of a Markdown body, without its heading line (whitespace kept). */
const rawSection = (body, heading) => {
  const m = body.match(new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
  assert.ok(m, `section "${heading}" not found`);
  return m[1];
};
const section = (body, heading) => flat(rawSection(body, heading));

const triage = split(read('workflows/plan-triage.md'));
const worker = split(read('workflows/plan-worker.md'));

// ---- Plan Triage ------------------------------------------------------------------------------

test('plan triage: high complexity, high risk or both adds plan-approval-required and no handoff', () => {
  const s = section(triage.body, 'Approval gate');
  assert.match(s, /^If complexity is high, or risk is high, or both: - Add the label `plan-approval-required`\. - Do \*\*not\*\* emit `plan-triage-handoff`\./);
  assert.match(s, /Otherwise, and unless the issue already carries `plan-approval-required` \(see "A hold that is already there"\) or the plan reports a conflict with a decision record \(see "A conflict with a decision record"\), emit `plan-triage-handoff`\./);
});

test('plan triage: the comment names the reason and says how to resume', () => {
  const s = section(triage.body, 'Approval gate');
  assert.match(s, /only complexity is high: "High complexity\. Remove the plan-approval-required label to resume\."/);
  assert.match(s, /only risk is high: "High risk\. Remove the plan-approval-required label to resume\."/);
  assert.match(s, /both are high: "High complexity and high risk\. Remove the plan-approval-required label to resume\."/);
});

test('plan triage: never resumes a high-complexity or high-risk issue itself', () => {
  const s = section(triage.body, 'Approval gate');
  assert.match(s, /You never resume a high-complexity or high-risk issue yourself\. When a maintainer removes `plan-approval-required`, a separate workflow \(`plan-approval-resume`, no LLM\) applies `plan-triage-handoff`\./);
});

test('plan triage: the dependency gate is unchanged and the label budget still fits three labels', () => {
  assert.match(section(triage.body, 'Dependency gate'), /If the issue has the label `dependency-required`, do \*\*not\*\* emit `plan-triage-handoff`, whatever the classification\./);
  const max = Number(triage.frontmatter.match(/add-labels:[\s\S]*?\n    max: (\d+)/)?.[1]);
  assert.ok(max >= 3, `add-labels max is ${max}: complexity, risk and plan-approval-required are three labels`);
  for (const label of ['complexity/high', 'risk/high', 'plan-approval-required', 'plan-triage-handoff']) {
    assert.match(triage.frontmatter, new RegExp(`^      - ${label.replace('/', '\\/')}$`, 'm'), `${label} must stay allowed`);
  }
});

test('plan triage: the description says when approval is added', () => {
  assert.match(flat(triage.frontmatter), /Adds plan-approval-required for high complexity or high risk; does not hand off while that label is present\./);
});

// ---- Plan approval resume ---------------------------------------------------------------------

test('resume workflow: starts only for the approval label and passes the actor to the script', () => {
  const yml = read('workflows/plan-approval-resume.yml');
  assert.match(yml, /if: github\.event_name != 'issues' \|\| github\.event\.label\.name == 'plan-approval-required'/);
  assert.match(yml, /ACTOR: \$\{\{ github\.actor \}\}/);
});

test('resume script: both high labels are known, and a bot remover is refused', () => {
  const js = read('scripts/plan-approval-resume.mjs');
  assert.match(js, /export const LABEL_HIGH = 'complexity\/high';/);
  assert.match(js, /export const LABEL_RISK_HIGH = 'risk\/high';/);
  assert.match(js, /if \(isBot\(actor\)\) return \{ handoff: false, reason: `approval removed by a bot/);
  assert.match(js, /decide\(issue, ctx\.removedLabel, ctx\.actor\)/);
});

// ---- Plan Worker ------------------------------------------------------------------------------

test('plan worker: a report with a runtime failure gets its cause checked or labelled a hypothesis, in two lines', () => {
  const raw = rawSection(worker.body, 'Reports with a runtime failure');
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  assert.equal(lines.length, 2, 'the rule stays two lines');
  assert.match(flat(lines[0]), /If the report contains an error message or a stack trace, say in the plan how the likely cause was checked: the file and line you read, or "not verified"\./);
  assert.match(flat(lines[1]), /Label a cause you did not check against the code "Hypothesis \(unverified\)"\./);
});

test('plan worker: the repository guidance section and the plan contents are still there', () => {
  assert.match(section(worker.body, 'Repository guidance'), /ranks below the harness's safety policy/);
  assert.match(section(worker.body, 'Plan contents'), /Repository rules that apply, when the repository has guidance files/);
  assert.match(worker.body, /Produce a short, rough plan only\. No code\./);
});

// ---- Docs -------------------------------------------------------------------------------------

test('docs: the gate, the labels and the routing matrix say high risk stops too', () => {
  const design = flat(read('docs/multi-phase-design.md'));
  assert.match(design, /For high complexity or high risk it adds the internal label `plan-approval-required` and stops\./);
  assert.match(design, /It acts only on an open issue that plan triage has classified \(it carries `complexity\/high` or `risk\/high`, or both a `complexity\/\*` and a `risk\/\*` label with any value/);
  assert.match(design, /A removal made by a bot account never counts, because approval is a human decision\./);
  assert.match(design, /If complexity is high or risk is high, add `plan-approval-required` and do not emit `plan-triage-handoff`/);
  assert.match(design, /human review is still required unless both complexity and risk are low/);

  const readme = flat(read('README.md'));
  assert.match(readme, /High complexity or high risk adds `plan-approval-required`, and a maintainer can add it by hand to any issue to read the plan first/);
  assert.match(readme, /Added by plan triage for high complexity or high risk, or by a maintainer by hand\./);
  assert.match(readme, /\| Low \| Agent \+ auto-merge eligible \| Agent \+ human review \| Stop until `plan-approval-required` is removed/);
  assert.match(readme, /\| Medium \| Agent \+ human review \| Agent \+ human review \| Stop until `plan-approval-required` is removed/);

  const deployment = flat(read('docs/deployment.md'));
  assert.match(deployment, /removes `plan-approval-required` from an issue plan triage has classified/);
  assert.match(deployment, /Hold for approval \(also by hand\): nothing is assigned; remove to resume/);
  assert.match(deployment, /"High risk\. Remove the plan-approval-required label to resume\."/);
});
