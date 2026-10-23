import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// max-ai-credits is not a per-run cap, but it feeds gh-aw's daily guardrail and the failure report,
// so it has to match what runs really use (docs/multi-phase-design.md, "Repository guidance", Cost).
// Measured on 2026-10-23: plan worker 12.6 to 15.0 AIC, PR triage 12.3 to 20.4 AIC, plus about
// 2.5 AIC for reading the repository guidance, and up to about 2 AIC more when the plan worker reads a
// file to check a bug's cause (worst case about 19.5 AIC).

const REPO = new URL('..', import.meta.url);
const credits = (workflow) => {
  const fm = fs.readFileSync(new URL(`workflows/${workflow}.md`, REPO), 'utf8').match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(fm, `${workflow}: frontmatter not found`);
  const m = fm[1].match(/^max-ai-credits: (\d+)$/m);
  assert.ok(m, `${workflow}: max-ai-credits not found`);
  return Number(m[1]);
};

test('pr-triage budget covers the largest measured run plus the guidance overhead', () => {
  assert.ok(credits('pr-triage') >= 24, `pr-triage max-ai-credits is ${credits('pr-triage')}`);
});

test('plan-worker budget covers its largest measured run plus the guidance overhead and a cause check', () => {
  assert.ok(credits('plan-worker') >= 24, `plan-worker max-ai-credits is ${credits('plan-worker')}`);
});
