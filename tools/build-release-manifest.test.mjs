import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseManifestFiles,
  findUnlisted,
  buildManifest,
  verifyManifest,
} from './build-release-manifest.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture(files, awFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-manifest-'));
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  for (const [rel, content] of Object.entries(files)) write(rel, content);
  write('aw.yml', `name: x\nfiles:\n${awFiles.map((f) => `  - ${f}`).join('\n')}\n`);
  write(
    'requirements.json',
    JSON.stringify({ ghAw: { version: 'v0.92.0' }, labels: [{ name: 'a', color: '000000', description: 'd' }], secrets: [] })
  );
  return dir;
}

test('parseManifestFiles reads only the files list', () => {
  const text = 'manifest-version: "1"\nname: X\nfiles:\n  - workflows/a.md\n  - scripts/b.mjs\nother:\n  - nope\n';
  assert.deepEqual(parseManifestFiles(text), ['workflows/a.md', 'scripts/b.mjs']);
});

test('the digest of every listed file is recorded, sorted by path', () => {
  const dir = fixture({ 'workflows/b.md': 'B', 'workflows/a.md': 'A' }, ['workflows/b.md', 'workflows/a.md']);
  const m = buildManifest({ root: dir, version: '1.2.3', commit: 'abc' });
  assert.deepEqual(m.files.map((f) => f.path), ['workflows/a.md', 'workflows/b.md']);
  assert.match(m.files[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(m.files[0].bytes, 1);
  assert.equal(m.tag, 'v1.2.3');
  assert.equal(m.commit, 'abc');
  assert.equal(m.requires.labels.length, 1);
});

test('the same inputs give the same manifest', () => {
  const dir = fixture({ 'workflows/a.md': 'A' }, ['workflows/a.md']);
  assert.deepEqual(buildManifest({ root: dir, version: '1.0.0' }), buildManifest({ root: dir, version: '1.0.0' }));
});

test('a file that is not listed in aw.yml fails the build (tests are exempt)', () => {
  const dir = fixture(
    { 'workflows/a.md': 'A', 'workflows/new.md': 'N', 'scripts/x.mjs': 'x', 'scripts/x.test.mjs': 't' },
    ['workflows/a.md', 'scripts/x.mjs']
  );
  assert.deepEqual(findUnlisted(dir, ['workflows/a.md', 'scripts/x.mjs']), ['workflows/new.md']);
  assert.throws(() => buildManifest({ root: dir, version: '1.0.0' }), /not listed in aw\.yml: workflows\/new\.md/);
});

test('a listed file that does not exist fails the build', () => {
  const dir = fixture({ 'workflows/a.md': 'A' }, ['workflows/a.md', 'workflows/gone.md']);
  assert.throws(() => buildManifest({ root: dir, version: '1.0.0' }), /missing: workflows\/gone\.md/);
});

test('verification catches a changed, resized or missing file', () => {
  const dir = fixture({ 'workflows/a.md': 'A', 'workflows/b.md': 'B' }, ['workflows/a.md', 'workflows/b.md']);
  const m = buildManifest({ root: dir, version: '1.0.0' });
  assert.deepEqual(verifyManifest(m, dir), []);
  fs.writeFileSync(path.join(dir, 'workflows/a.md'), 'tampered');
  fs.rmSync(path.join(dir, 'workflows/b.md'));
  const problems = verifyManifest(m, dir);
  assert.ok(problems.includes('digest mismatch: workflows/a.md'));
  assert.ok(problems.includes('missing: workflows/b.md'));
});

test('this repository: every deployable file is listed in aw.yml', () => {
  const listed = parseManifestFiles(fs.readFileSync(path.join(REPO, 'aw.yml'), 'utf8'));
  assert.deepEqual(findUnlisted(REPO, listed), []);
  for (const f of listed) assert.ok(fs.existsSync(path.join(REPO, f)), `${f} is listed but missing`);
});

test('this repository: requirements.json labels match the label table in docs/deployment.md', () => {
  const req = JSON.parse(fs.readFileSync(path.join(REPO, 'requirements.json'), 'utf8'));
  const docs = fs.readFileSync(path.join(REPO, 'docs/deployment.md'), 'utf8');
  const table = [];
  for (const line of docs.split('\n')) {
    const m = line.match(/^\| `([a-z/:-]+)` \| `([0-9a-f]{6})` \| (.*) \|\s*$/);
    if (m) table.push({ name: m[1], color: m[2], description: m[3] });
  }
  assert.deepEqual(req.labels, table);
});

test('this repository: the manifest builds and verifies', () => {
  const m = buildManifest({ root: REPO, version: '0.0.0-test' });
  assert.ok(m.files.length > 20);
  assert.deepEqual(verifyManifest(m, REPO), []);
});
