import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classify } from '../tools/build-release-manifest.mjs';
import {
  parseConfig,
  renderConfig,
  pickRelease,
  fetchRelease,
  selectRelated,
  applyCrossRepo,
  buildDesired,
  planWrites,
  applyWrites,
  detectDrift,
  run,
  BRANCH,
  CONFIG_PATH,
} from './concierge-updater.mjs';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const INSTALL = [
  { from: 'workflows/', to: '.github/workflows/' },
  { from: 'scripts/', to: '.github/scripts/' },
];

/** An in-memory harness repository with releases, and a fake GitHub context over it. */
function harness() {
  const releases = [];
  const manifests = new Map();
  const commits = new Map();
  const store = new Map();
  const calls = { git: [], compiled: [], installed: [], labels: [], prs: [] };
  const state = { existingLabels: [] };
  return {
    calls,
    state,
    add(tag, files, opts = {}) {
      const commit = createHash('sha1').update(tag).digest('hex');
      const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
      manifests.set(tag, {
        schema: 1,
        name: 'repo-concierge',
        version: tag.replace(/^v/, ''),
        tag: opts.manifestTag || tag,
        commit: opts.manifestCommit || commit,
        ghAw: { version: opts.ghAw || 'v0.92.0' },
        install: INSTALL,
        files: entries.map(([p, c]) => ({ path: p, ...classify(p, INSTALL), sha256: sha256(Buffer.from(c)), bytes: Buffer.byteLength(c) })),
        requires: { labels: opts.labels || [], secrets: opts.secrets || [] },
        ...(opts.schema ? { schema: opts.schema } : {}),
      });
      commits.set(tag, commit);
      for (const [p, c] of entries) store.set(`${commit}:${p}`, Buffer.from(opts.tamper === p ? `${c}!` : c));
      releases.push({
        tag_name: tag,
        draft: !!opts.draft,
        prerelease: !!opts.prerelease,
        body: opts.notes === undefined ? `Notes for ${tag}` : opts.notes,
        assets: opts.noManifest ? [] : [{ name: 'release-manifest.json', id: tag }],
      });
    },
    ctx() {
      return {
        log: () => {},
        releases: async () => releases,
        tagCommit: async (_s, tag) => commits.get(tag),
        downloadAsset: async (_s, a) => Buffer.from(JSON.stringify(manifests.get(a.id))),
        file: async (_s, p, ref) => store.get(`${ref}:${p}`),
        labels: async () => state.existingLabels,
        createLabel: async (l) => calls.labels.push(l.name),
        upsertPr: async (pr) => {
          calls.prs.push(pr);
          return { number: 7, html_url: 'https://github.com/o/r/pull/7' };
        },
        git: (args) => calls.git.push(args),
        installGhAw: (v) => calls.installed.push(v),
        compile: (names) => calls.compiled.push(names),
      };
    },
  };
}

function deployment(files = {}, cfg = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-deploy-'));
  const write = (rel, c) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), c);
  };
  for (const [p, c] of Object.entries(files)) write(p, c);
  if (cfg) write(CONFIG_PATH, renderConfig(cfg));
  return { root, write, read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'), exists: (rel) => fs.existsSync(path.join(root, rel)) };
}

const V1 = { 'workflows/issue-worker.md': 'worker v1\n', 'scripts/tool.mjs': 'tool v1\n', 'shared/risk.md': 'risk\n' };
const V2 = { 'workflows/issue-worker.md': 'worker v2\n', 'scripts/tool.mjs': 'tool v2\n', 'shared/risk.md': 'risk\n' };
const pinned = (tag) => ({ source: 'o/concierge', version: tag, sha: 'x'.repeat(40), channel: 'stable' });

// ------------------------------------------------------------------ units

test('config round-trips and rejects an incomplete file', () => {
  const c = { source: 'o/c', version: 'v1.2.0', sha: 'a'.repeat(40), channel: 'stable' };
  assert.deepEqual(parseConfig(renderConfig(c)), c);
  assert.throws(() => parseConfig('# nothing\nchannel: stable\n'), /needs source and version/);
});

test('pickRelease: highest semver for the channel, never a draft', () => {
  const rel = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, ...extra });
  const list = [rel('v1.9.0'), rel('v1.10.0'), rel('v2.0.0-1', { prerelease: true }), rel('v3.0.0', { draft: true }), rel('not-semver')];
  assert.equal(pickRelease(list, 'stable').tag_name, 'v1.10.0');
  assert.equal(pickRelease(list, 'prerelease').tag_name, 'v2.0.0-1');
  assert.equal(pickRelease([rel('v1.0.0'), rel('v1.0.0-2', { prerelease: true })], 'prerelease').tag_name, 'v1.0.0');
  assert.equal(pickRelease([], 'stable'), null);
});

test('cross-repo generation: settings from related-repos.md, or nothing', () => {
  const text = 'a\n  create-issue:\n    max: 1\n    # concierge:cross-repo\n  next:\n';
  const related = { repo: 'o/cli', secret: 'CLI_TOKEN' };
  assert.equal(
    applyCrossRepo(text, related),
    'a\n  create-issue:\n    max: 1\n    github-token: ${{ secrets.CLI_TOKEN }}\n    allowed-repos: ["o/cli"]\n  next:\n'
  );
  assert.equal(applyCrossRepo(text, null), 'a\n  create-issue:\n    max: 1\n  next:\n');
  assert.equal(applyCrossRepo('no marker\n', related), 'no marker\n');
});

test('related repositories: one with a secret, warnings for the rest, an error for two', () => {
  const doc = (...r) => `this: o/me\n\nrelated:\n${r.map(([repo, secret]) => `  - role: x\n    repo: ${repo}\n${secret ? `    secret: ${secret}\n` : ''}    when: |\n      t\n`).join('')}`;
  assert.deepEqual(selectRelated('').related, null);
  assert.equal(selectRelated(doc(['o/a', 'A_TOKEN'])).related.secret, 'A_TOKEN');
  const noSecret = selectRelated(doc(['o/a', null]));
  assert.equal(noSecret.related, null);
  assert.match(noSecret.warnings[0], /o\/a names no secret/);
  assert.throws(() => selectRelated(doc(['o/a', 'A'], ['o/b', 'B'])), /supports one/);
});

test('fetchRelease verifies the tag, the manifest and every digest', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  const rel = (await h.ctx().releases())[0];
  const got = await fetchRelease(h.ctx(), 'o/c', rel);
  assert.equal(got.tag, 'v1.0.0');
  assert.equal(got.contents.size, 2); // reference files are not downloaded
  assert.equal(got.notes, 'Notes for v1.0.0');

  for (const [opts, expected] of [
    [{ tamper: 'scripts/tool.mjs' }, /digest mismatch for scripts\/tool\.mjs/],
    [{ manifestCommit: 'f'.repeat(40) }, /is not the commit of the tag/],
    [{ manifestTag: 'v9.9.9' }, /manifest is for v9\.9\.9/],
    [{ noManifest: true }, /has no release-manifest\.json/],
    [{ schema: 2 }, /unsupported manifest schema 2/],
  ]) {
    const bad = harness();
    bad.add('v1.0.0', V1, opts);
    await assert.rejects(fetchRelease(bad.ctx(), 'o/c', (await bad.ctx().releases())[0]), expected);
  }
});

test('buildDesired installs definitions, workflows and scripts, patches definitions, skips references', async () => {
  const h = harness();
  h.add('v1.0.0', { ...V1, 'workflows/closer.md': 'x\n    # concierge:cross-repo\n', 'workflows/watch.yml': 'yml\n' });
  const fetched = await fetchRelease(h.ctx(), 'o/c', (await h.ctx().releases())[0]);
  const desired = buildDesired({ manifest: fetched.manifest, contents: fetched.contents, related: { repo: 'o/r', secret: 'S' } });
  assert.deepEqual([...desired.keys()].sort(), [
    '.github/scripts/tool.mjs',
    '.github/workflows/closer.md',
    '.github/workflows/issue-worker.md',
    '.github/workflows/watch.yml',
  ]);
  assert.match(desired.get('.github/workflows/closer.md').content.toString(), /allowed-repos: \["o\/r"\]/);
  assert.equal(desired.get('.github/workflows/watch.yml').content.toString(), 'yml\n');
  assert.equal(desired.get('.github/workflows/issue-worker.md').kind, 'definition');
});

test('working tree: plan, write, removal of a dropped definition and its lock, drift', () => {
  const d = deployment({ '.github/workflows/old.md': 'o', '.github/workflows/old.lock.yml': 'l', '.github/workflows/keep.md': 'same', '.github/workflows/chg.md': 'edited locally' });
  const desired = new Map([
    ['.github/workflows/keep.md', { content: Buffer.from('same'), kind: 'definition' }],
    ['.github/workflows/chg.md', { content: Buffer.from('new'), kind: 'definition' }],
    ['.github/workflows/add.md', { content: Buffer.from('a'), kind: 'definition' }],
  ]);
  const previous = new Map([
    ['.github/workflows/old.md', { content: Buffer.from('o'), kind: 'definition' }],
    ['.github/workflows/chg.md', { content: Buffer.from('shipped'), kind: 'definition' }],
    ['.github/workflows/keep.md', { content: Buffer.from('same'), kind: 'definition' }],
  ]);
  assert.deepEqual(detectDrift(d.root, previous), ['.github/workflows/chg.md']);
  const plan = planWrites(d.root, desired, previous);
  assert.deepEqual(plan, {
    added: ['.github/workflows/add.md'],
    changed: ['.github/workflows/chg.md'],
    unchanged: ['.github/workflows/keep.md'],
    removed: ['.github/workflows/old.md'],
  });
  applyWrites(d.root, desired, plan);
  assert.equal(d.read('.github/workflows/chg.md'), 'new');
  assert.equal(d.read('.github/workflows/add.md'), 'a');
  assert.equal(d.exists('.github/workflows/old.md'), false);
  assert.equal(d.exists('.github/workflows/old.lock.yml'), false);
});

// ------------------------------------------------------------------- flow

test('up to date: nothing is touched', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  const d = deployment({}, pinned('v1.0.0'));
  const r = await run({ root: d.root }, h.ctx());
  assert.equal(r.status, 'up-to-date');
  assert.deepEqual(h.calls.git, []);
});

test('no release yet, and a missing target, are reported', async () => {
  const h = harness();
  const d = deployment({}, pinned('v1.0.0'));
  assert.equal((await run({ root: d.root }, h.ctx())).status, 'no-release');
  await assert.rejects(run({ root: d.root, target: 'v9.9.9' }, h.ctx()), /release v9\.9\.9 not found/);
});

test('a newer release: files, pin, compile, one commit, a forced push and one pull request', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  h.add('v1.1.0', V2, { ghAw: 'v0.93.0', notes: 'Shiny things', labels: [{ name: 'new-label', color: 'abcdef', description: 'd' }], secrets: [{ name: 'SIGNAL_TOKEN', purpose: 'labels' }] });
  const d = deployment({ '.github/workflows/issue-worker.md': 'worker v1\n', '.github/scripts/tool.mjs': 'tool v1\n' }, pinned('v1.0.0'));
  const r = await run({ root: d.root }, h.ctx());

  assert.equal(r.status, 'pull-request');
  assert.equal(d.read('.github/workflows/issue-worker.md'), 'worker v2\n');
  assert.equal(d.read('.github/scripts/tool.mjs'), 'tool v2\n');
  const cfg = parseConfig(d.read(CONFIG_PATH));
  assert.equal(cfg.version, 'v1.1.0');
  assert.equal(cfg.sha, createHash('sha1').update('v1.1.0').digest('hex'));
  assert.deepEqual(h.calls.installed, ['v0.93.0']);
  assert.deepEqual(h.calls.compiled, [['issue-worker']]);
  assert.deepEqual(h.calls.git.map((a) => a[0]), ['checkout', 'add', 'commit', 'push']);
  assert.deepEqual(h.calls.git[0], ['checkout', '-B', BRANCH]);
  assert.deepEqual(h.calls.git[3], ['push', '--force', 'origin', `HEAD:refs/heads/${BRANCH}`]);
  assert.deepEqual(h.calls.labels, ['new-label']);
  const pr = h.calls.prs[0];
  assert.equal(pr.title, 'chore: update Repo Concierge v1.0.0 → v1.1.0');
  assert.equal(pr.head, BRANCH);
  assert.match(pr.body, /Shiny things/);
  assert.match(pr.body, /Lock files were regenerated with gh-aw v0\.93\.0 \(was v0\.92\.0\)/);
  assert.match(pr.body, /Created 1 missing label\(s\): `new-label`/);
  assert.match(pr.body, /`SIGNAL_TOKEN`: labels/);
  assert.match(pr.body, /rebuilt from scratch/);
});

test('local edits to managed files are reported as drift', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  h.add('v1.1.0', V2);
  const d = deployment({ '.github/workflows/issue-worker.md': 'my own change\n', '.github/scripts/tool.mjs': 'tool v1\n' }, pinned('v1.0.0'));
  const r = await run({ root: d.root }, h.ctx());
  assert.deepEqual(r.drift, ['.github/workflows/issue-worker.md']);
  assert.match(h.calls.prs[0].body, /Local changes this update overwrites[\s\S]*issue-worker\.md/);
});

test('a dropped definition and its lock file are removed and not compiled', async () => {
  const h = harness();
  h.add('v1.0.0', { ...V1, 'workflows/gone.md': 'g\n' });
  h.add('v1.1.0', V2);
  const d = deployment({ '.github/workflows/gone.md': 'g\n', '.github/workflows/gone.lock.yml': 'lock', '.github/workflows/issue-worker.md': 'worker v1\n', '.github/scripts/tool.mjs': 'tool v1\n' }, pinned('v1.0.0'));
  const r = await run({ root: d.root }, h.ctx());
  assert.deepEqual(r.plan.removed, ['.github/workflows/gone.md']);
  assert.equal(d.exists('.github/workflows/gone.md'), false);
  assert.equal(d.exists('.github/workflows/gone.lock.yml'), false);
  assert.deepEqual(h.calls.compiled, [['issue-worker']]);
});

test('a dry run changes nothing and calls no git', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  h.add('v1.1.0', V2, { labels: [{ name: 'l', color: '000000', description: '' }] });
  const d = deployment({ '.github/workflows/issue-worker.md': 'worker v1\n' }, pinned('v1.0.0'));
  const r = await run({ root: d.root, dryRun: true }, h.ctx());
  assert.equal(r.status, 'update');
  assert.equal(d.read('.github/workflows/issue-worker.md'), 'worker v1\n');
  assert.equal(parseConfig(d.read(CONFIG_PATH)).version, 'v1.0.0');
  assert.deepEqual(h.calls.git, []);
  assert.deepEqual(h.calls.labels, []);
  assert.deepEqual(h.calls.prs, []);
});

test('a tampered file aborts before anything is written', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  h.add('v1.1.0', V2, { tamper: 'scripts/tool.mjs' });
  const d = deployment({ '.github/workflows/issue-worker.md': 'worker v1\n' }, pinned('v1.0.0'));
  await assert.rejects(run({ root: d.root }, h.ctx()), /digest mismatch for scripts\/tool\.mjs/);
  assert.equal(d.read('.github/workflows/issue-worker.md'), 'worker v1\n');
  assert.deepEqual(h.calls.git, []);
  assert.deepEqual(h.calls.prs, []);
});

test('first adoption in local mode: writes the files and the pin, compiles, no git', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  const d = deployment();
  const r = await run({ root: d.root, local: true, source: 'o/concierge', target: 'v1.0.0' }, h.ctx());
  assert.equal(r.status, 'written');
  assert.equal(r.from, null);
  assert.equal(d.read('.github/workflows/issue-worker.md'), 'worker v1\n');
  assert.equal(parseConfig(d.read(CONFIG_PATH)).source, 'o/concierge');
  assert.deepEqual(h.calls.compiled, [['issue-worker']]);
  assert.deepEqual(h.calls.git, []);
});

test('cross-repository settings come from related-repos.md', async () => {
  const h = harness();
  h.add('v1.0.0', { 'workflows/closer.md': 'safe-outputs:\n  close-issue:\n    max: 1\n    # concierge:cross-repo\n' });
  const d = deployment({ '.github/agentic-workflows/related-repos.md': 'this: o/me\n\nrelated:\n  - role: cli\n    repo: o/cli\n    secret: CLI_TOKEN\n    when: |\n      x\n' });
  await run({ root: d.root, local: true, source: 'o/concierge' }, h.ctx());
  assert.equal(d.read('.github/workflows/closer.md'), 'safe-outputs:\n  close-issue:\n    max: 1\n    github-token: ${{ secrets.CLI_TOKEN }}\n    allowed-repos: ["o/cli"]\n');
});

test('an explicit target repairs drift on the pinned release; a prerelease channel sees prereleases', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  h.add('v1.1.0-1', V2, { prerelease: true });
  const d = deployment({ '.github/workflows/issue-worker.md': 'drifted\n', '.github/scripts/tool.mjs': 'tool v1\n' }, pinned('v1.0.0'));
  const repair = await run({ root: d.root, target: 'v1.0.0', dryRun: true }, h.ctx());
  assert.deepEqual(repair.plan.changed, ['.github/workflows/issue-worker.md']);
  assert.equal((await run({ root: d.root, dryRun: true }, h.ctx())).status, 'up-to-date'); // stable channel ignores the prerelease
  d.write(CONFIG_PATH, renderConfig({ ...pinned('v1.0.0'), channel: 'prerelease' }));
  assert.equal((await run({ root: d.root, dryRun: true }, h.ctx())).to, 'v1.1.0-1');
});

test('a pin that is not a semver tag is an error, not a silent no-op', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  const d = deployment({}, pinned('main'));
  await assert.rejects(run({ root: d.root }, h.ctx()), /not a semver tag/);
});
