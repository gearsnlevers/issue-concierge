import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontMatter } from './validate-decision-records.mjs';

// A gate finds the records that apply to a change by their `applies-to` globs. A glob that names a file by name stops matching
// when the file is renamed or changes type (the closer was `related-repo-closer.md`, then a plain workflow, then the whole
// product was renamed), and the record silently stops being surfaced: seven accepted records had gone that way when this
// was measured. So every pattern of a record that binds must match at least one file of the repository.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** A glob as the records use them: `**` crosses folders, `*` does not, everything else is literal. */
export function globToRegex(glob) {
  // `**` and `*` become placeholders first, so that the star of one rule is not rewritten by the next.
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*');
  return new RegExp(`^${body}$`);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const files = walk('');
const records = fs.readdirSync(path.join(ROOT, 'docs/decisions')).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort();

test('a glob matches what the records mean by it', () => {
  assert.ok(globToRegex('scripts/**').test('scripts/a/b.mjs'));
  assert.ok(globToRegex('scripts/**').test('scripts/a.mjs'));
  assert.ok(!globToRegex('scripts/*.mjs').test('scripts/a/b.mjs'), '* does not cross a folder');
  assert.ok(globToRegex('scripts/issue-concierge-*.mjs').test('scripts/issue-concierge-state.mjs'));
  assert.ok(!globToRegex('workflows/related-repo-closer.md').test('workflows/related-repo-closer.yml'), 'a file name is literal');
  assert.ok(!globToRegex('a.b').test('axb'), 'a dot is a dot');
  assert.ok(globToRegex('**/x.md').test('x.md') && globToRegex('**/x.md').test('a/b/x.md'));
});

test('every pattern of an accepted record matches at least one file of the repository', () => {
  const dead = [];
  let checked = 0;
  for (const f of records) {
    const parsed = parseFrontMatter(read(`docs/decisions/${f}`));
    if (parsed.error || parsed.data.status !== 'accepted') continue; // a replaced or proposed record binds nothing
    for (const glob of parsed.data['applies-to'] ?? []) {
      checked += 1;
      if (!files.some((p) => globToRegex(glob).test(p))) dead.push(`${f.slice(0, 4)}: ${glob}`);
    }
  }
  assert.ok(checked >= 40, `the check looked at ${checked} patterns: has the scan stopped finding the records?`);
  assert.deepEqual(dead, [], 'a pattern that matches no file keeps the gates from finding the record: correct it in a pull request that says why');
});

test('the skill, the template and the records README tell an author to prefer folders and prefix globs', () => {
  assert.match(read('.claude/skills/record-a-decision/SKILL.md'), /prefer a folder or a prefix glob such as `scripts\/\*\*` to a single file name/);
  assert.match(read('shared/decision-record.md'), /Prefer a folder or a prefix glob \(`src\/ops\/\*\*`, `scripts\/issue-\*\.mjs`\) to a single file name/);
  assert.match(read('docs/decisions/README.md'), /every pattern of an accepted record must match a file \(`tools\/decision-applies-to\.test\.mjs`\)/);
});
