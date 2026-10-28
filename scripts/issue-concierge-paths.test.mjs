import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFIG_DIR, CONFIG_FILES, LEGACY_DIR, LEGACY_PIN_PATH, PIN_PATH, configPath, configViaApi, firstFound, legacyPath, plannedMoves, readConfig, readPin, viaApi,
} from './issue-concierge-paths.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = (...present) => (p) => (present.includes(p) ? `content of ${p}` : null);

test('the new folder and pin file are named for the product, the old ones are what they used to be', () => {
  assert.equal(CONFIG_DIR, '.github/issue-concierge');
  assert.equal(PIN_PATH, '.github/issue-concierge.yml');
  assert.equal(LEGACY_DIR, '.github/agentic-workflows');
  assert.equal(LEGACY_PIN_PATH, '.github/concierge.yml');
  assert.equal(configPath('scope.md'), '.github/issue-concierge/scope.md');
  assert.equal(legacyPath('scope.md'), '.github/agentic-workflows/scope.md');
});

test('the new place wins, the old one is the fallback, and a file in neither is reported at the new place', () => {
  assert.deepEqual(readConfig('scope.md', files(configPath('scope.md'), legacyPath('scope.md'))), { path: configPath('scope.md'), value: `content of ${configPath('scope.md')}`, legacy: false });
  assert.deepEqual(readConfig('scope.md', files(legacyPath('scope.md'))), { path: legacyPath('scope.md'), value: `content of ${legacyPath('scope.md')}`, legacy: true });
  assert.deepEqual(readConfig('scope.md', files()), { path: configPath('scope.md'), value: null, legacy: false });
  assert.equal(readConfig('scope.md', files(configPath('guard.md'))).value, null, 'another file of the folder is not this one');
});

test('an empty file is a file: only a missing one falls back', () => {
  const read = (p) => (p === configPath('settings.yml') ? '' : 'old');
  assert.deepEqual(readConfig('settings.yml', read), { path: configPath('settings.yml'), value: '', legacy: false });
});

test('the pin is read from the new place or else the old one', () => {
  assert.equal(readPin(files(PIN_PATH, LEGACY_PIN_PATH)).path, PIN_PATH);
  assert.deepEqual(readPin(files(LEGACY_PIN_PATH)), { path: LEGACY_PIN_PATH, value: `content of ${LEGACY_PIN_PATH}`, legacy: true });
  assert.equal(readPin(files()).path, PIN_PATH);
});

test('through an API the old place is tried only when the new one is not there', () => {
  const answers = (table) => (p) => table[p] ?? { status: 404 };
  assert.equal(configViaApi('related-repos.md', answers({ [configPath('related-repos.md')]: { status: 200 }, [legacyPath('related-repos.md')]: { status: 200 } })).path, configPath('related-repos.md'));
  const old = configViaApi('related-repos.md', answers({ [legacyPath('related-repos.md')]: { status: 200 } }));
  assert.equal(old.path, legacyPath('related-repos.md'));
  assert.equal(old.legacy, true);
  const neither = configViaApi('related-repos.md', answers({}));
  assert.deepEqual([neither.path, neither.result.status, neither.legacy], [configPath('related-repos.md'), 404, false]);
});

test('an error on the new place is the answer: a stale file in the old place does not stand in for it', () => {
  for (const status of [403, 500, 502]) {
    const got = configViaApi('scope.md', (p) => (p === configPath('scope.md') ? { status } : { status: 200 }));
    assert.deepEqual([got.path, got.result.status], [configPath('scope.md'), status]);
  }
  assert.equal(viaApi(['a', 'b'], () => null).result, null, 'no answer at all is no answer');
});

test('the updater moves what is only in the old place, and reports what is in both', () => {
  const exists = (...present) => (p) => present.includes(p);
  assert.deepEqual(plannedMoves(exists()), { moves: [], both: [] });
  assert.deepEqual(plannedMoves(exists(legacyPath('scope.md'), legacyPath('related-repos.md'))), {
    moves: [
      { from: legacyPath('related-repos.md'), to: configPath('related-repos.md') },
      { from: legacyPath('scope.md'), to: configPath('scope.md') },
    ],
    both: [],
  });
  assert.deepEqual(plannedMoves(exists(legacyPath('scope.md'), configPath('scope.md'))), { moves: [], both: [{ from: legacyPath('scope.md'), to: configPath('scope.md') }] });
  assert.deepEqual(plannedMoves(exists(configPath('scope.md'))), { moves: [], both: [] }, 'a repository that has moved has nothing to move');
  assert.deepEqual(plannedMoves(exists(`${LEGACY_DIR}/notes.txt`)), { moves: [], both: [] }, 'a file the Concierge does not know is not touched');
});

test('every file of the folder that the prompts, scripts, templates or docs name is in CONFIG_FILES, and each is a real template or file', () => {
  const named = new Set();
  for (const dir of ['workflows', 'scripts', 'shared', 'docs']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      const p = path.join(ROOT, dir, f);
      if (!fs.statSync(p).isFile() || f.endsWith('.test.mjs') || f === 'issue-concierge-paths.mjs') continue;
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/\.github\/issue-concierge\/([A-Za-z0-9._-]+\.(?:md|yml))/g)) named.add(m[1]);
    }
  }
  assert.deepEqual([...named].filter((n) => !CONFIG_FILES.includes(n)), [], 'a file is named that the updater would not move');
  assert.deepEqual([...CONFIG_FILES].sort(), CONFIG_FILES, 'the list is sorted');
});
