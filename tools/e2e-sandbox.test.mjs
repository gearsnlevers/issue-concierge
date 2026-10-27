import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main, placeholderValues, renderTemplate, seed } from './e2e/seed-sandbox.mjs';
import { validateDecisionRecords } from './validate-decision-records.mjs';
import { parseRelatedRepos } from '../scripts/dependency-watch.mjs';

// The sandbox pairs the end-to-end tests run against. A public pair is the baseline; a private pair finds what
// breaks when the workflow token cannot read the other repository.
const PAIRS = [
  { lib: 'gearsnlevers/e2e-lib', app: 'gearsnlevers/e2e-app' },
  { lib: 'gearsnlevers/e2e-lib-private', app: 'gearsnlevers/e2e-app-private' },
];
const LIB_SECRET = 'E2E_APP_ISSUES_TOKEN'; // the secret the library repository holds: it writes into the app
const APP_SECRET = 'E2E_LIB_ISSUES_TOKEN';

const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');
const lines = (text) => text.split('\n').filter((l, i, a) => i < a.length - 1 || l !== '').length;

function seedPair(pair) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sandbox-'));
  const libDir = path.join(root, 'lib');
  const appDir = path.join(root, 'app');
  seed({ role: 'lib', out: libDir, this: pair.lib, other: pair.app, secret: LIB_SECRET });
  seed({ role: 'app', out: appDir, this: pair.app, other: pair.lib, secret: APP_SECRET });
  return { libDir, appDir };
}

for (const pair of PAIRS) {
  const label = pair.lib.split('/')[1];
  const { libDir, appDir } = seedPair(pair);
  const libName = pair.lib.split('/')[1];
  const appName = pair.app.split('/')[1];

  test(`${label}: every placeholder is filled with the names of the pair`, () => {
    for (const dir of [libDir, appDir]) {
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
      for (const file of walk(dir)) assert.ok(!fs.readFileSync(file, 'utf8').includes('{{'), `${file} still has a placeholder`);
    }
    assert.equal(JSON.parse(read(libDir, 'package.json')).name, libName);
    const app = JSON.parse(read(appDir, 'package.json'));
    assert.equal(app.name, appName);
    assert.deepEqual(app.dependencies, { [libName]: `github:${pair.lib}#main` });
    assert.match(read(appDir, 'src/cli.js'), new RegExp(`from '${libName}'`));
    assert.match(read(appDir, 'AGENTS.md'), new RegExp(pair.lib));
    assert.match(read(libDir, 'AGENTS.md'), new RegExp(pair.app));
  });

  test(`${label}: AGENTS.md stays short and keeps the sections the gates read`, () => {
    for (const dir of [libDir, appDir]) {
      const text = read(dir, 'AGENTS.md');
      assert.ok(lines(text) <= 60, `${dir} AGENTS.md has ${lines(text)} lines`);
      for (const heading of ['## Commands', '## Boundaries', '## Layers', '## Decisions', '## Component rules']) {
        assert.ok(text.includes(heading), `${dir} AGENTS.md lacks ${heading}`);
      }
      assert.match(text, /Never edit the Repo Concierge's files/);
    }
  });

  test(`${label}: the instruction files carry applyTo and are linked from AGENTS.md`, () => {
    for (const dir of [libDir, appDir]) {
      const files = fs.readdirSync(path.join(dir, '.github/instructions'));
      assert.ok(files.length >= 2);
      for (const file of files) {
        assert.match(read(dir, `.github/instructions/${file}`), /^---\napplyTo: '[^']+'\n---\n/);
        assert.ok(read(dir, 'AGENTS.md').includes(`.github/instructions/${file}`), `${file} is not linked from AGENTS.md`);
      }
    }
  });

  test(`${label}: the decision records pass the Concierge's own validator, and one of them does not bind`, () => {
    for (const dir of [libDir, appDir]) {
      assert.deepEqual(validateDecisionRecords({ dir: path.join(dir, 'docs/decisions') }), []);
    }
    const statuses = (dir) =>
      fs.readdirSync(path.join(dir, 'docs/decisions')).filter((f) => /^\d{4}-/.test(f)).map((f) => read(dir, `docs/decisions/${f}`).match(/^status: (.+)$/m)[1]);
    assert.deepEqual(statuses(libDir), ['accepted', 'accepted', 'proposed'], 'the library has a proposed record the gates must ignore');
    assert.deepEqual(statuses(appDir), ['accepted', 'accepted']);
  });

  test(`${label}: related-repos.md names the other repository and the secret that writes there`, () => {
    const lib = parseRelatedRepos(read(libDir, '.github/agentic-workflows/related-repos.md'));
    const app = parseRelatedRepos(read(appDir, '.github/agentic-workflows/related-repos.md'));
    assert.equal(lib.this, pair.lib);
    assert.deepEqual(lib.related.map((r) => [r.repo, r.secret]), [[pair.app, LIB_SECRET]]);
    assert.equal(app.this, pair.app);
    assert.deepEqual(app.related.map((r) => [r.repo, r.secret]), [[pair.lib, APP_SECRET]]);
  });

  test(`${label}: scope.md declines a graphical interface in both repositories`, () => {
    for (const dir of [libDir, appDir]) {
      const text = read(dir, '.github/agentic-workflows/scope.md');
      const out = text.split('## Out of scope')[1].split('\n## ')[0];
      assert.match(out, /^- A web page, a dashboard or any other graphical interface/m);
    }
  });

  test(`${label}: the seeded projects build and pass their own tests`, () => {
    const run = (cwd, args) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
    const lib = run(libDir, ['--test']);
    assert.equal(lib.status, 0, lib.stdout + lib.stderr);
    const app = run(appDir, ['--test']);
    assert.equal(app.status, 0, app.stdout + app.stderr);
    const check = run(appDir, ['--check', 'src/cli.js']);
    assert.equal(check.status, 0, check.stderr);
  });
}

test('the library flattens a repeated node once, which a sandbox issue can ask to change', () => {
  const { libDir } = seedPair(PAIRS[0]);
  assert.match(read(libDir, 'src/tree.js'), /is listed once/);
});

test('placeholderValues rejects a repository, a pair or a secret that cannot be right', () => {
  const ok = { this: 'o/e2e-lib', other: 'o/e2e-app', secret: 'E2E_APP_ISSUES_TOKEN' };
  assert.deepEqual(placeholderValues(ok), { name: 'e2e-lib', this: 'o/e2e-lib', other: 'o/e2e-app', other_name: 'e2e-app', secret: 'E2E_APP_ISSUES_TOKEN' });
  assert.throws(() => placeholderValues({ ...ok, this: 'e2e-lib' }), /--this must be owner\/name/);
  assert.throws(() => placeholderValues({ ...ok, other: undefined }), /--other must be owner\/name/);
  assert.throws(() => placeholderValues({ ...ok, other: ok.this }), /the same repository/);
  assert.throws(() => placeholderValues({ ...ok, secret: 'e2e_token' }), /--secret must be an Actions secret name/);
});

test('renderTemplate refuses an unknown placeholder, an unfilled one and an unknown role', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-template-'));
  fs.mkdirSync(path.join(root, 'lib'));
  const values = placeholderValues({ this: 'o/a', other: 'o/b', secret: 'S' });
  fs.writeFileSync(path.join(root, 'lib', 'x.md'), 'hello {{bogus}}');
  assert.throws(() => renderTemplate('lib', values, root), /unknown placeholder {{bogus}}/);
  fs.writeFileSync(path.join(root, 'lib', 'x.md'), 'hello {{ name }}');
  assert.throws(() => renderTemplate('lib', values, root), /an unfilled placeholder is left/);
  fs.writeFileSync(path.join(root, 'lib', 'x.md'), 'hello {{name}}');
  assert.equal(renderTemplate('lib', values, root).get('x.md'), 'hello a');
  assert.throws(() => renderTemplate('web', values, root), /--role must be one of lib, app/);
});

test('seed overwrites the files of the template and leaves other files alone', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-reseed-'));
  const args = { role: 'lib', out, this: 'o/e2e-lib', other: 'o/e2e-app', secret: 'E2E_APP_ISSUES_TOKEN' };
  const first = seed(args);
  assert.ok(first.includes('AGENTS.md') && first.includes('.github/agentic-workflows/related-repos.md'));
  fs.writeFileSync(path.join(out, 'README.md'), 'changed by hand');
  fs.writeFileSync(path.join(out, 'NOTES.md'), 'mine');
  seed(args);
  assert.match(read(out, 'README.md'), /^# e2e-lib/);
  assert.equal(read(out, 'NOTES.md'), 'mine');
});

test('the command line seeds a directory, and explains a mistake with exit code 1', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cli-'));
  const log = [];
  const realLog = console.log;
  const realError = console.error;
  console.log = (m) => log.push(m);
  console.error = (m) => log.push(m);
  try {
    assert.equal(main(['--role', 'app', '--this', 'o/e2e-app', '--other', 'o/e2e-lib', '--secret', 'E2E_LIB_ISSUES_TOKEN', '--out', out]), 0);
    assert.match(log[0], /^Seeded \d+ files into .* \(app, o\/e2e-app\)\.$/);
    assert.equal(main(['--role', 'app', '--this', 'o/e2e-app']), 1);
    assert.equal(log.at(-1), '--out DIR is required');
    assert.equal(main(['--role']), 1);
    assert.match(log.at(-1), /cannot read the arguments at "--role"/);
  } finally {
    console.log = realLog;
    console.error = realError;
  }
});
