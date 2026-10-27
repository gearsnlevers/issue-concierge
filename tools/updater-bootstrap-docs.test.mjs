import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** The scripts the updater needs on disk before it can run: itself and everything it imports from this folder, transitively. */
function importClosure(start) {
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const m of read(`scripts/${name}.mjs`).matchAll(/^import .* from '\.\/([a-z-]+)\.mjs';$/gm)) visit(m[1]);
  };
  visit(start);
  return seen;
}

// Found on 2026-10-26 when the first adoption of the end-to-end sandbox failed with ERR_MODULE_NOT_FOUND: the loop
// copied the updater and the dependency watcher, and the dependency watcher had started to import opt-out.mjs.
test('the first-adoption bootstrap in docs/updater.md copies every script the updater imports', () => {
  const loop = read('docs/updater.md').match(/^for f in ([a-z -]+); do$/m);
  assert.ok(loop, 'docs/updater.md has the bootstrap loop');
  assert.deepEqual([...importClosure('concierge-updater')].sort(), loop[1].split(' ').sort());
});

test('the closure is computed from the real imports', () => {
  const closure = importClosure('concierge-updater');
  assert.ok(closure.has('dependency-watch') && closure.has('opt-out'));
  assert.ok(!closure.has('janitor'));
});
