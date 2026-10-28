import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A repository's own files for the Concierge (scope.md, related-repos.md, settings.yml and the others) moved from
// `.github/agentic-workflows/` to `.github/issue-concierge/`. A repository that has not been updated yet still has them in the
// old folder, so the readers look in both (scripts/issue-concierge-paths.mjs, tested next to the readers) and a gate that reads
// a file by its prompt has to be told to do the same. These tests keep the prompts, the trigger of the deployment check and the
// deployment guide in step with that.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const prompts = fs.readdirSync(path.join(ROOT, 'workflows')).filter((f) => f.endsWith('.md'));

const SENTENCE = "A repository's own files for the Concierge are in `.github/issue-concierge/`. A repository that has not been updated yet still has them in `.github/agentic-workflows/`: where this prompt names a file in the first folder and it is not there, look for the same name in the second.";
const FILE_PATH = /\.github\/issue-concierge\/[A-Za-z0-9._-]+\.(?:md|yml)/;

test('a prompt that names a file of the folder says once that the old folder is the fallback, before it names the file', () => {
  const naming = prompts.filter((f) => FILE_PATH.test(read(`workflows/${f}`)));
  assert.deepEqual(naming, ['issue-worker.md', 'plan-triage.md', 'plan-worker.md', 'release-closer.md'], 'the prompts that read the folder');
  for (const f of naming) {
    const text = read(`workflows/${f}`);
    assert.equal(text.split(SENTENCE).length - 1, 1, `${f} carries the sentence exactly once`);
    const sentenceAt = text.indexOf(SENTENCE);
    const firstFile = text.search(FILE_PATH);
    assert.ok(sentenceAt < firstFile, `${f}: the sentence comes before the first file it covers`);
  }
});

test('a prompt that does not read the folder does not carry the sentence', () => {
  for (const f of prompts.filter((p) => !FILE_PATH.test(read(`workflows/${p}`)))) assert.ok(!read(`workflows/${f}`).includes('agentic-workflows'), f);
});

test('the sentence names the new folder first and the old one second, and is plain text', () => {
  assert.ok(SENTENCE.indexOf('.github/issue-concierge/') < SENTENCE.indexOf('.github/agentic-workflows/'));
  assert.doesNotMatch(SENTENCE, /<!--/, 'gh-aw removes an HTML comment from a prompt');
});

test('the deployment check runs for a change in either folder and either pin file', () => {
  const on = read('workflows/check-deployment.yml').split('\njobs:')[0];
  for (const p of ['.github/issue-concierge/**', '.github/agentic-workflows/**', '.github/issue-concierge.yml', '.github/concierge.yml']) {
    assert.ok(on.includes(`- '${p}'`), `the pull_request paths include ${p}`);
  }
});

test('the deployment guide says nothing is required, how the update moves the files, what the check says, and how to move by hand', () => {
  const guide = read('docs/deployment.md');
  const section = guide.split('### Moving to the new names')[1].split('\n## ')[0];
  assert.match(section, /Nothing here is required/);
  assert.match(section, /looks for each file in the new folder first and in the old one second/);
  assert.match(section, /next run of the updater/);
  assert.match(section, /A notice lists the files that are still in the old folder, and a warning says that a file is in both places/);
  assert.match(section, /git mv \.github\/agentic-workflows\/scope\.md \.github\/issue-concierge\/scope\.md/);
  assert.match(section, /Move before the next major release/);
  assert.match(guide, /none left in the old folder `\.github\/agentic-workflows\/`/, 'the checklist asks for it');
});
