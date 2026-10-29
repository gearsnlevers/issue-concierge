import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_KEYS, commandLines, MAINTAINER_LINE, parseSkill, validateSkills } from './validate-skills.mjs';

// The agent skills in .claude/skills are procedures that Claude Code and GitHub's Copilot coding agent
// follow literally, so they must not name a file, an npm script, a workflow or a workflow input that does
// not exist (tools/validate-skills.mjs). The first test checks the real skills; the rest feed the validator
// small broken skills, one defect each, to show that every rule fires.

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the skills in this repository are valid', () => {
  assert.deepEqual(validateSkills(REPO), []);
  const names = fs.readdirSync(path.join(REPO, '.claude/skills'));
  for (const expected of ['cut-an-issue-concierge-release', 'change-a-gate-workflow']) assert.ok(names.includes(expected), `${expected} is missing`);
});

test('the release skill is maintainer-only and says so first', () => {
  const { meta, body } = parseSkill(fs.readFileSync(path.join(REPO, '.claude/skills/cut-an-issue-concierge-release/SKILL.md'), 'utf8'));
  assert.equal(meta['disable-model-invocation'], 'true');
  assert.equal(body.split('\n').find((l) => l.trim()), MAINTAINER_LINE);
});

/** A small repository with one good skill; `overrides` replace or add files (null removes one). */
function repo(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  const files = {
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    'docs/guide.md': '# Guide\n',
    'tools/check.sh': '#!/bin/sh\n',
    '.github/workflows/release.yml': 'name: Release\non:\n  workflow_dispatch:\n    inputs:\n      release-type:\n        type: choice\n      dry-run:\n        type: boolean\njobs: {}\n',
    'workflows/job.yml': 'name: Job\non:\n  schedule:\n    - cron: "1 * * * *"\njobs: {}\n',
    '.claude/skills/do-it/SKILL.md': skill(),
    ...overrides,
  };
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) continue;
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

function skill({ front = {}, body = 'Read [the guide](../../../docs/guide.md) and `docs/guide.md`.\n\n```bash\nnpm test\nbash tools/check.sh\ngh workflow run release.yml -R o/r -f release-type=patch -f dry-run=true\n```\n' } = {}) {
  const meta = { name: 'do-it', description: 'Do the thing. Use when asked to.', ...front };
  const lines = Object.entries(meta).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

const problemsOf = (overrides) => validateSkills(repo(overrides));
const only = (problems, needle) => {
  assert.equal(problems.length, 1, `expected one problem containing "${needle}", got ${JSON.stringify(problems)}`);
  assert.ok(problems[0].includes(needle), `"${problems[0]}" does not contain "${needle}"`);
};

test('a good skill passes', () => {
  assert.deepEqual(problemsOf({}), []);
});

test('front matter: missing, malformed and unknown keys', () => {
  only(problemsOf({ '.claude/skills/do-it/SKILL.md': '# no front matter\n' }), 'no front matter');
  only(problemsOf({ '.claude/skills/do-it/SKILL.md': '---\nname: do-it\ndescription: |\n  multi line\n---\nbody\n' }), 'single-line');
  only(problemsOf({ '.claude/skills/do-it/SKILL.md': skill({ front: { 'allowed-tools': 'Bash' } }) }), 'allowed-tools');
  assert.ok(!ALLOWED_KEYS.includes('allowed-tools'));
});

test('name: equals the directory, lowercase with hyphens', () => {
  only(problemsOf({ '.claude/skills/do-it/SKILL.md': skill({ front: { name: 'other' } }) }), 'must equal the directory name');
  const bad = problemsOf({ '.claude/skills/Do_It/SKILL.md': skill({ front: { name: 'Do_It' } }), '.claude/skills/do-it/SKILL.md': null });
  assert.ok(bad.some((p) => p.includes('lowercase')), JSON.stringify(bad));
});

test('description: required and under 1000 characters', () => {
  only(problemsOf({ '.claude/skills/do-it/SKILL.md': skill({ front: { description: undefined } }) }), 'description is empty');
  only(problemsOf({ '.claude/skills/do-it/SKILL.md': skill({ front: { description: 'x'.repeat(1000) } }) }), 'description is 1000 characters');
  assert.deepEqual(problemsOf({ '.claude/skills/do-it/SKILL.md': skill({ front: { description: 'x'.repeat(999) } }) }), []);
});

test('body: under 500 lines', () => {
  only(problemsOf({ '.claude/skills/do-it/SKILL.md': skill({ body: 'line\n'.repeat(500) }) }), 'body is');
  assert.deepEqual(problemsOf({ '.claude/skills/do-it/SKILL.md': skill({ body: 'line\n'.repeat(497) }) }), []);
  only(problemsOf({ '.claude/skills/do-it/SKILL.md': skill({ body: 'line\n'.repeat(498) }) }), 'body is 500 lines');
});

test('a skill with side effects opens with the maintainer-only line', () => {
  const side = (body) => skill({ front: { 'disable-model-invocation': 'true' }, body });
  only(problemsOf({ '.claude/skills/do-it/SKILL.md': side('Do it.\n') }), 'must open with');
  assert.deepEqual(problemsOf({ '.claude/skills/do-it/SKILL.md': side(`\n${MAINTAINER_LINE}\n\nDo it.\n`) }), []);
  only(problemsOf({ '.claude/skills/do-it/SKILL.md': skill({ front: { 'disable-model-invocation': 'yes' } }) }), 'true or false');
});

test('links and repository paths must exist', () => {
  only(problemsOf({ '.claude/skills/do-it/SKILL.md': skill({ body: 'See [x](../../../docs/missing.md).\n' }) }), 'does not resolve');
  only(problemsOf({ '.claude/skills/do-it/SKILL.md': skill({ body: 'See `docs/missing.md`.\n' }) }), '`docs/missing.md` does not exist');
  assert.deepEqual(problemsOf({ '.claude/skills/do-it/SKILL.md': skill({ body: 'See [web](https://example.com/x) and `tools/*.test.mjs` and `docs/<name>.md`.\n' }) }), []);
});

test('commands must name an existing script, npm script, workflow and workflow input', () => {
  const cmd = (line) => problemsOf({ '.claude/skills/do-it/SKILL.md': skill({ body: `\`\`\`bash\n${line}\n\`\`\`\n` }) });
  only(cmd('npm run nope'), 'no script "nope"');
  only(cmd('node tools/missing.mjs'), 'tools/missing.mjs does not exist');
  only(cmd('bash tools/missing.sh'), 'tools/missing.sh does not exist');
  only(cmd('gh workflow run nope.yml -R o/r'), 'not found');
  only(cmd('gh workflow run release.yml -R o/r -f release_type=patch'), 'no input "release_type"');
  only(cmd('gh workflow run job.yml -R o/r'), 'no workflow_dispatch trigger');
  assert.deepEqual(cmd('gh workflow run release.yml -R o/r \\\n  -f dry-run=true'), []);
});

test('a file next to SKILL.md must be mentioned in it', () => {
  only(problemsOf({ '.claude/skills/do-it/scripts/orphan.mjs': '// unused\n' }), 'orphan.mjs is not mentioned');
  assert.deepEqual(problemsOf({ '.claude/skills/do-it/scripts/used.mjs': '// used\n', '.claude/skills/do-it/SKILL.md': skill({ body: 'Run `.claude/skills/do-it/scripts/used.mjs`.\n' }) }), []);
});

test('something that looks like a credential is rejected', () => {
  only(problemsOf({ '.claude/skills/do-it/SKILL.md': skill({ body: `token ${'ghp_'}${'a'.repeat(30)}\n` }) }), 'credential');
});

test('a folder without SKILL.md is reported, a repository without skills is fine', () => {
  only(problemsOf({ '.claude/skills/empty/README.md': 'x\n' }), 'no SKILL.md');
  assert.deepEqual(validateSkills(fs.mkdtempSync(path.join(os.tmpdir(), 'noskills-'))), []);
});

test('commandLines joins continuation lines and ignores prose', () => {
  assert.deepEqual(commandLines('text\n```bash\na \\\n  b\nc\n```\nmore `x`\n'), ['a b', 'c']);
});
