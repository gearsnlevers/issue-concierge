import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The display names of the workflows are a convention, and the Actions sidebar sorts by them:
//   Concierge <phase digit><step letter> [▸ ]<Name>
// The code decides the order (pipeline order), the marker says "can be run by hand" and must
// not lie. See docs/multi-phase-design.md, "Workflow names".

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workflows');
const MARKER = '▸';
const MAX_LENGTH = 40; // the sidebar truncates long names; the longest today is 35

/** Parse a workflow definition: its display name and whether it has a manual trigger. */
export function inspect(file) {
  const text = fs.readFileSync(path.join(DIR, file), 'utf8');
  // gh-aw definitions keep their configuration in the frontmatter; plain workflows are all YAML.
  const yaml = file.endsWith('.md') ? text.split('---')[1] || '' : text;
  const code = yaml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const m = code.match(/^name:\s*(.+?)\s*$/m);
  const name = m ? m[1].replace(/^(["'])(.*)\1$/, '$2') : null;
  return { file, name, dispatchable: /^\s*workflow_dispatch:/m.test(code) };
}

const files = fs.readdirSync(DIR).filter((f) => /\.(yml|md)$/.test(f)).sort();
const flows = files.map(inspect);
const PATTERN = /^Concierge ([1-9])([a-z]) (▸ )?(\S.*)$/;

test('every workflow definition has a display name', () => {
  assert.ok(flows.length >= 15, `expected the harness workflows, found ${flows.length}`);
  for (const f of flows) assert.ok(f.name, `${f.file} has no name`);
});

test('every name follows "Concierge <code> [▸ ]<Name>" and stays short enough for the sidebar', () => {
  for (const f of flows) {
    assert.match(f.name, PATTERN, `${f.file}: "${f.name}"`);
    assert.ok(f.name.length <= MAX_LENGTH, `${f.file}: "${f.name}" is ${f.name.length} characters (maximum ${MAX_LENGTH})`);
  }
});

test('the marker is on exactly the workflows that can be run by hand', () => {
  for (const f of flows) {
    const marked = Boolean(f.name.match(PATTERN)?.[3]);
    assert.equal(marked, f.dispatchable, `${f.file}: "${f.name}" ${f.dispatchable ? 'can' : 'cannot'} be dispatched but is ${marked ? '' : 'not '}marked`);
  }
});

test('codes are unique, and sorting the names sorts the pipeline', () => {
  const codes = flows.map((f) => f.name.match(PATTERN)[1] + f.name.match(PATTERN)[2]);
  assert.equal(new Set(codes).size, codes.length, `duplicate codes: ${codes.join(', ')}`);
  const byName = [...flows].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())).map((f) => f.file);
  const byCode = [...flows].sort((a, b) => a.name.match(PATTERN)[1].localeCompare(b.name.match(PATTERN)[1]) || a.name.match(PATTERN)[2].localeCompare(b.name.match(PATTERN)[2])).map((f) => f.file);
  assert.deepEqual(byName, byCode);
});

test('the ordering holds whether the sidebar counts punctuation or ignores it', () => {
  const alnum = (s) => s.toLowerCase().replace(/[^0-9a-z]/g, '');
  const plain = [...flows].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())).map((f) => f.file);
  const ignoring = [...flows].sort((a, b) => alnum(a.name).localeCompare(alnum(b.name))).map((f) => f.file);
  assert.deepEqual(plain, ignoring);
});

test('step letters in each phase run a, b, c without gaps', () => {
  const phases = new Map();
  for (const f of flows) {
    const [, phase, step] = f.name.match(PATTERN);
    phases.set(phase, [...(phases.get(phase) || []), step]);
  }
  for (const [phase, steps] of phases) {
    const sorted = [...steps].sort();
    assert.deepEqual(sorted, 'abcdefghijklmnopqrstuvwxyz'.slice(0, sorted.length).split(''), `phase ${phase} has steps ${sorted.join(',')}`);
  }
});

test('inspect reads quoted and unquoted names and ignores a commented-out trigger', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'names-'));
  const write = (n, c) => fs.writeFileSync(path.join(dir, n), c);
  write('a.yml', '# workflow_dispatch: mentioned only in a comment\nname: "Concierge 1a ▸ X"\non:\n  workflow_dispatch:\n');
  write('b.yml', "# workflow_dispatch:\nname: 'Concierge 1b Y'\non:\n  issues:\n");
  const real = DIR;
  // inspect() reads from DIR; point the check at the temp files through a relative path
  const rel = (n) => path.relative(real, path.join(dir, n));
  assert.deepEqual(inspect(rel('a.yml')), { file: rel('a.yml'), name: 'Concierge 1a ▸ X', dispatchable: true });
  assert.deepEqual(inspect(rel('b.yml')), { file: rel('b.yml'), name: 'Concierge 1b Y', dispatchable: false });
});
