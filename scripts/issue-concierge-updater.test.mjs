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
  LEGACY_BRANCH,
  LEGACY_CONFIG_PATH,
  MOVE_TITLE,
  RELATED_PATH,
  applyMoves,
  bothWarnings,
  main,
  realContext,
  renderMoved,
  renderPrBody,
} from './issue-concierge-updater.mjs';
import { LEGACY_DIR, plannedMoves } from './issue-concierge-paths.mjs';

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
  const calls = { git: [], compiled: [], installed: [], labels: [], prs: [], retired: [] };
  const state = { existingLabels: [] };
  return {
    calls,
    state,
    add(tag, files, opts = {}) {
      const commit = createHash('sha1').update(tag).digest('hex');
      const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
      manifests.set(tag, {
        schema: 1,
        name: 'issue-concierge',
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
        retireLegacyBranch: async (legacy, pr) => {
          if (state.retireFails) throw new Error('HTTP 403');
          calls.retired.push([legacy, pr.number]);
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

test('both spellings of the markers are the same marker: a file with the older one and a file with the newer give the same result', () => {
  const related = { repo: 'o/cli', secret: 'CLI_TOKEN' };
  const fileWith = (a, b) => `a\n  create-issue:\n    max: 1\n    # ${a}\n  env:\n    GH_TOKEN: x\n  # ${b}\nrun: y\n`;
  const older = fileWith('concierge:cross-repo', 'concierge:cross-repo-env');
  const newer = fileWith('issue-concierge:cross-repo', 'issue-concierge:cross-repo-env');
  const mixed = fileWith('issue-concierge:cross-repo', 'concierge:cross-repo-env');
  for (const r of [related, null]) {
    assert.equal(applyCrossRepo(newer, r), applyCrossRepo(older, r));
    assert.equal(applyCrossRepo(mixed, r), applyCrossRepo(older, r));
  }
  assert.ok(!applyCrossRepo(newer, related).includes('concierge:cross-repo'), 'no marker is left behind');
  // the markers are told apart by their end: the longer one is not eaten by the shorter
  assert.equal(applyCrossRepo('    # issue-concierge:cross-repo-env\n', related), '    CROSS_REPO: o/cli\n    CROSS_REPO_TOKEN: ${{ secrets.CLI_TOKEN }}\n');
  assert.equal(applyCrossRepo('x # concierge:cross-repo\n', related), 'x # concierge:cross-repo\n', 'a marker is a line of its own');
});

test('a deployment generated from a release with the older marker shows no local changes when the next release has either spelling', async () => {
  const oldSource = 'safe-outputs:\n  close-issue:\n    max: 1\n    # concierge:cross-repo\n';
  const related = '.github/issue-concierge/related-repos.md';
  const relatedText = 'this: o/me\n\nrelated:\n  - role: cli\n    repo: o/cli\n    secret: CLI_TOKEN\n    when: |\n      x\n';
  const generated = applyCrossRepo(oldSource, { repo: 'o/cli', secret: 'CLI_TOKEN' });
  for (const next of [oldSource, oldSource.replace('# concierge:', '# issue-concierge:')]) {
    const h = harness();
    h.add('v1.0.0', { 'workflows/closer.md': oldSource });
    h.add('v1.1.0', { 'workflows/closer.md': next.replace('max: 1', 'max: 2') });
    const d = deployment({ '.github/workflows/closer.md': generated, [related]: relatedText }, pinned('v1.0.0'));
    const out = await run({ root: d.root, local: true, source: 'o/concierge' }, h.ctx());
    assert.deepEqual(out.drift, [], 'the previous release is read with the same rules, so nothing looks edited');
    assert.equal(d.read('.github/workflows/closer.md'), 'safe-outputs:\n  close-issue:\n    max: 2\n    github-token: ${{ secrets.CLI_TOKEN }}\n    allowed-repos: ["o/cli"]\n');
  }
});

test('cross-repo generation in a plain workflow: the environment from related-repos.md, or nothing', () => {
  const text = 'env:\n  GH_TOKEN: x\n  # concierge:cross-repo-env\nrun: y\n';
  const related = { repo: 'o/cli', secret: 'CLI_TOKEN' };
  assert.equal(
    applyCrossRepo(text, related),
    'env:\n  GH_TOKEN: x\n  CROSS_REPO: o/cli\n  CROSS_REPO_TOKEN: ${{ secrets.CLI_TOKEN }}\nrun: y\n'
  );
  assert.equal(applyCrossRepo(text, null), 'env:\n  GH_TOKEN: x\nrun: y\n');
  // the two markers are independent: a definition keeps using the safe-output form
  const both = '    # concierge:cross-repo\n  # concierge:cross-repo-env\n';
  assert.equal(
    applyCrossRepo(both, related),
    '    github-token: ${{ secrets.CLI_TOKEN }}\n    allowed-repos: ["o/cli"]\n  CROSS_REPO: o/cli\n  CROSS_REPO_TOKEN: ${{ secrets.CLI_TOKEN }}\n'
  );
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

test('no release yet is reported on a first adoption; a missing target fails', async () => {
  const h = harness();
  const first = deployment({});
  assert.equal((await run({ root: first.root, source: 'o/concierge' }, h.ctx())).status, 'no-release');
  const d = deployment({}, pinned('v1.0.0'));
  await assert.rejects(run({ root: d.root, target: 'v9.9.9' }, h.ctx()), /release v9\.9\.9 not found/);
});

test('a pinned deployment that finds no usable release fails instead of reporting success', async () => {
  // An empty release list (a bad read during an API incident) must not look like "nothing to do".
  const empty = harness();
  const d = deployment({}, pinned('v1.0.0'));
  await assert.rejects(run({ root: d.root }, empty.ctx()), /no stable release of o\/concierge found, but v1\.0\.0 is pinned/);
  assert.deepEqual(empty.calls.git, []);

  // Only prereleases and drafts on the stable channel: also nothing usable.
  const odd = harness();
  odd.add('v2.0.0-1', V1, { prerelease: true });
  odd.add('v2.0.0', V2, { draft: true });
  await assert.rejects(run({ root: d.root }, odd.ctx()), /is pinned/);
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
  assert.equal(pr.title, 'chore: update Issue Concierge v1.0.0 → v1.1.0');
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
  const d = deployment({ '.github/issue-concierge/related-repos.md': 'this: o/me\n\nrelated:\n  - role: cli\n    repo: o/cli\n    secret: CLI_TOKEN\n    when: |\n      x\n' });
  await run({ root: d.root, local: true, source: 'o/concierge' }, h.ctx());
  assert.equal(d.read('.github/workflows/closer.md'), 'safe-outputs:\n  close-issue:\n    max: 1\n    github-token: ${{ secrets.CLI_TOKEN }}\n    allowed-repos: ["o/cli"]\n');
});

test('the environment of a plain workflow comes from related-repos.md, and the marker goes where there is none', async () => {
  const closer = 'jobs:\n  close:\n    steps:\n      - env:\n          GH_TOKEN: x\n          # concierge:cross-repo-env\n';
  const h = harness();
  h.add('v1.0.0', { 'workflows/closer.yml': closer });
  const withRelated = deployment({ '.github/issue-concierge/related-repos.md': 'this: o/me\n\nrelated:\n  - role: cli\n    repo: o/cli\n    secret: CLI_TOKEN\n    when: |\n      x\n' });
  await run({ root: withRelated.root, local: true, source: 'o/concierge' }, h.ctx());
  assert.equal(
    withRelated.read('.github/workflows/closer.yml'),
    'jobs:\n  close:\n    steps:\n      - env:\n          GH_TOKEN: x\n          CROSS_REPO: o/cli\n          CROSS_REPO_TOKEN: ${{ secrets.CLI_TOKEN }}\n'
  );
  const without = deployment({});
  await run({ root: without.root, local: true, source: 'o/concierge' }, h.ctx());
  assert.equal(without.read('.github/workflows/closer.yml'), 'jobs:\n  close:\n    steps:\n      - env:\n          GH_TOKEN: x\n');
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

// ------------------------------------------------------------------ the names the product used to have

const RELATED = '# related\nrepo: o/other\nsecret: OTHER_TOKEN\n';
const SCOPE = '# scope\nnot this\n';
const OLD_FILES = { [`${LEGACY_DIR}/scope.md`]: SCOPE, [`${LEGACY_DIR}/related-repos.md`]: RELATED };

test('the pin, the branch and the secret are named for the product, and the old branch and pin are known', () => {
  assert.equal(CONFIG_PATH, '.github/issue-concierge.yml');
  assert.equal(LEGACY_CONFIG_PATH, '.github/concierge.yml');
  assert.equal(BRANCH, 'issue-concierge/update');
  assert.equal(LEGACY_BRANCH, 'concierge/update');
  assert.equal(RELATED_PATH, '.github/issue-concierge/related-repos.md');
  assert.equal(MOVE_TITLE, "chore: move the Issue Concierge's files to their new places");
  assert.match(renderConfig({ source: 'o/c', version: 'v1.0.0', sha: 'x' }), /^# Issue Concierge pin\./);
});

test('an update from a legacy pin writes the pin in its new place and removes the old one', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  h.add('v1.1.0', V2);
  const d = deployment({ '.github/workflows/issue-worker.md': 'worker v1\n' });
  d.write(LEGACY_CONFIG_PATH, renderConfig(pinned('v1.0.0')));
  const r = await run({ root: d.root }, h.ctx());
  assert.equal(r.status, 'pull-request');
  assert.equal(parseConfig(d.read(CONFIG_PATH)).version, 'v1.1.0');
  assert.equal(d.exists(LEGACY_CONFIG_PATH), false);
  assert.match(h.calls.prs[0].body, /## Moved[\s\S]*`\.github\/concierge\.yml` → `\.github\/issue-concierge\.yml`/);
});

test('an update moves the files of the old folder, with their content, and the pull request lists them', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  h.add('v1.1.0', V2);
  const d = deployment({ '.github/workflows/issue-worker.md': 'worker v1\n', ...OLD_FILES }, pinned('v1.0.0'));
  const r = await run({ root: d.root }, h.ctx());
  assert.equal(r.status, 'pull-request');
  assert.equal(d.read('.github/issue-concierge/scope.md'), SCOPE);
  assert.equal(d.read('.github/issue-concierge/related-repos.md'), RELATED);
  assert.equal(d.exists(`${LEGACY_DIR}/scope.md`), false);
  assert.equal(d.exists(LEGACY_DIR), false, 'the old folder is removed when it is left empty');
  const body = h.calls.prs[0].body;
  assert.match(body, /- `\.github\/agentic-workflows\/scope\.md` → `\.github\/issue-concierge\/scope\.md`/);
  assert.match(body, /- `\.github\/agentic-workflows\/related-repos\.md` → `\.github\/issue-concierge\/related-repos\.md`/);
  assert.match(body, /Nothing is asked of you\./);
  assert.deepEqual(h.calls.git.map((a) => a[0]), ['checkout', 'add', 'commit', 'push']);
});

test('related-repos.md is read from the old place before it moves, so the cross-repository settings do not change', async () => {
  const text = 'safe-outputs:\n  close-issue:\n    max: 1\n    # concierge:cross-repo\n';
  const related = 'this: o/me\n\nrelated:\n  - role: cli\n    repo: o/cli\n    secret: CLI_TOKEN\n    when: |\n      x\n';
  const generated = 'safe-outputs:\n  close-issue:\n    max: 1\n    github-token: ${{ secrets.CLI_TOKEN }}\n    allowed-repos: ["o/cli"]\n';
  for (const [where, place] of [['the new place', '.github/issue-concierge/related-repos.md'], ['the old place', `${LEGACY_DIR}/related-repos.md`]]) {
    const h = harness();
    h.add('v1.0.0', { 'workflows/closer.md': text });
    const d = deployment({ [place]: related });
    await run({ root: d.root, local: true, source: 'o/concierge' }, h.ctx());
    assert.equal(d.read('.github/workflows/closer.md'), generated, `read from ${where}`);
    assert.equal(d.read('.github/issue-concierge/related-repos.md'), related, 'and it is in the new place afterwards');
  }
});

test('a current version with files still in their old places gets a pull request of its own that only moves them', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  const d = deployment({ ...OLD_FILES }, null);
  d.write(LEGACY_CONFIG_PATH, renderConfig(pinned('v1.0.0')));
  const pinText = d.read(LEGACY_CONFIG_PATH);
  const r = await run({ root: d.root }, h.ctx());
  assert.equal(r.status, 'pull-request');
  assert.equal(d.read(CONFIG_PATH), pinText, 'the pin keeps its content and its version');
  assert.equal(d.exists(LEGACY_CONFIG_PATH), false);
  assert.equal(d.read('.github/issue-concierge/scope.md'), SCOPE);
  assert.deepEqual(h.calls.git.map((a) => a[0]), ['checkout', 'add', 'commit', 'push']);
  assert.deepEqual(h.calls.git[0], ['checkout', '-B', BRANCH]);
  assert.deepEqual(h.calls.git[2], ['commit', '-m', MOVE_TITLE]);
  assert.deepEqual(h.calls.compiled, [], 'no release, nothing to compile');
  assert.deepEqual(h.calls.labels, []);
  const pr = h.calls.prs[0];
  assert.equal(pr.title, MOVE_TITLE);
  assert.equal(pr.head, BRANCH);
  assert.match(pr.body, /The pinned version stays \*\*v1\.0\.0\*\*/);
  assert.match(pr.body, /## Moved/);
  assert.match(pr.body, /rebuilt from scratch on every run of the Issue Concierge updater/);
});

test('a legacy pin alone is enough to open that pull request, and a repository that has moved gets nothing', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  const onlyPin = deployment({}, null);
  onlyPin.write(LEGACY_CONFIG_PATH, renderConfig(pinned('v1.0.0')));
  assert.equal((await run({ root: onlyPin.root }, h.ctx())).status, 'pull-request');
  const moved = deployment({ '.github/issue-concierge/scope.md': SCOPE }, pinned('v1.0.0'));
  const before = h.calls.git.length;
  assert.equal((await run({ root: moved.root }, h.ctx())).status, 'up-to-date');
  assert.equal(h.calls.git.length, before, 'nothing is touched in a repository that has moved');
});

test('a dry run reports what would move and moves nothing', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  const d = deployment({ ...OLD_FILES }, null);
  d.write(LEGACY_CONFIG_PATH, renderConfig(pinned('v1.0.0')));
  const r = await run({ root: d.root, dryRun: true }, h.ctx());
  assert.equal(r.status, 'moves');
  assert.deepEqual(r.moves.map((m) => m.to).sort(), ['.github/issue-concierge/related-repos.md', '.github/issue-concierge/scope.md']);
  assert.equal(r.pinMoved, true);
  assert.equal(d.exists(`${LEGACY_DIR}/scope.md`), true);
  assert.equal(d.exists(LEGACY_CONFIG_PATH), true);
  assert.deepEqual(h.calls.git, []);
  assert.deepEqual(h.calls.prs, []);
});

test('a dry run of an update lists the moves too', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  h.add('v1.1.0', V2);
  const d = deployment({ ...OLD_FILES }, pinned('v1.0.0'));
  const r = await run({ root: d.root, dryRun: true }, h.ctx());
  assert.equal(r.status, 'update');
  assert.equal(r.moves.length, 2);
  assert.equal(d.exists(`${LEGACY_DIR}/scope.md`), true);
});

test('local mode moves the files and the pin without git', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  const d = deployment({ ...OLD_FILES }, null);
  d.write(LEGACY_CONFIG_PATH, renderConfig(pinned('v1.0.0')));
  const r = await run({ root: d.root, local: true }, h.ctx());
  assert.equal(r.status, 'written');
  assert.equal(d.read('.github/issue-concierge/scope.md'), SCOPE);
  assert.equal(d.exists(CONFIG_PATH), true);
  assert.deepEqual(h.calls.git, []);
});

test('a file in both places is left alone and reported; the new one is the one that is read', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  h.add('v1.1.0', V2);
  const d = deployment({ [`${LEGACY_DIR}/scope.md`]: 'old scope\n', '.github/issue-concierge/scope.md': 'new scope\n', [`${LEGACY_DIR}/risk.md`]: 'risk\n' }, pinned('v1.0.0'));
  const r = await run({ root: d.root }, h.ctx());
  assert.equal(r.status, 'pull-request');
  assert.equal(d.read(`${LEGACY_DIR}/scope.md`), 'old scope\n');
  assert.equal(d.read('.github/issue-concierge/scope.md'), 'new scope\n');
  assert.equal(d.read('.github/issue-concierge/risk.md'), 'risk\n', 'what is only in the old place still moves');
  assert.match(h.calls.prs[0].body, /## Warnings[\s\S]*`\.github\/agentic-workflows\/scope\.md` and `\.github\/issue-concierge\/scope\.md` both exist/);
  assert.equal(d.exists(LEGACY_DIR), true, 'the old folder stays while it holds a file');
});

test('both pin files: the new one is read, the old one is reported and an update removes it', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  h.add('v1.1.0', V2);
  const d = deployment({}, pinned('v1.0.0'));
  d.write(LEGACY_CONFIG_PATH, renderConfig(pinned('v0.9.0')));
  const r = await run({ root: d.root, dryRun: true }, h.ctx());
  assert.equal(r.from, 'v1.0.0', 'the pin in the new place wins');
  assert.match(r.warnings.join('\n'), /`\.github\/concierge\.yml` and `\.github\/issue-concierge\.yml` both exist/);
});

test('a folder file the Concierge does not know is not touched', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  const d = deployment({ [`${LEGACY_DIR}/notes.txt`]: 'mine\n' }, pinned('v1.0.0'));
  assert.equal((await run({ root: d.root }, h.ctx())).status, 'up-to-date');
  assert.equal(d.read(`${LEGACY_DIR}/notes.txt`), 'mine\n');
});

test('after its pull request the updater retires a pull request open from the old branch, and a failure does not fail the update', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  h.add('v1.1.0', V2);
  const d = deployment({}, pinned('v1.0.0'));
  assert.equal((await run({ root: d.root }, h.ctx())).status, 'pull-request');
  assert.deepEqual(h.calls.retired, [[LEGACY_BRANCH, 7]]);

  const failing = harness();
  failing.add('v1.0.0', V1);
  failing.add('v1.1.0', V2);
  failing.state.retireFails = true;
  const d2 = deployment({}, pinned('v1.0.0'));
  assert.equal((await run({ root: d2.root }, failing.ctx())).status, 'pull-request');
  assert.deepEqual(failing.calls.retired, []);
});

test('the move pull request retires the old branch too', async () => {
  const h = harness();
  h.add('v1.0.0', V1);
  const d = deployment({ ...OLD_FILES }, pinned('v1.0.0'));
  await run({ root: d.root }, h.ctx());
  assert.deepEqual(h.calls.retired, [[LEGACY_BRANCH, 7]]);
});

test('applyMoves, bothWarnings and renderMoved on their own', () => {
  const d = deployment({ ...OLD_FILES, [`${LEGACY_DIR}/keep.txt`]: 'k\n' });
  const { moves } = plannedMoves((p) => d.exists(p));
  applyMoves(d.root, moves);
  assert.equal(d.exists('.github/issue-concierge/scope.md'), true);
  assert.equal(d.exists(LEGACY_DIR), true, 'a folder that still holds a file stays');
  assert.deepEqual(renderMoved([], false), []);
  assert.match(renderMoved([], true).join('\n'), /`\.github\/concierge\.yml` → `\.github\/issue-concierge\.yml`/);
  assert.deepEqual(bothWarnings([]), []);
});

test('a pull request body has no Moved section when nothing moved, and one when something did', () => {
  const base = { from: 'v1', to: 'v2', notes: '', plan: { added: [], changed: [], removed: [] }, drift: [], labels: { created: [], missing: [] }, requires: null, warnings: [] };
  assert.doesNotMatch(renderPrBody(base), /## Moved/);
  assert.match(renderPrBody({ ...base, moves: [{ from: 'a', to: 'b' }] }), /## Moved[\s\S]*`a` → `b`/);
  assert.match(renderPrBody(base), /^Updates Issue Concierge from v1 to \*\*v2\*\*\./);
});

test('the updater workflow uses ISSUE_CONCIERGE_TOKEN and still accepts the old secret name', () => {
  const wf = fs.readFileSync(new URL('../workflows/issue-concierge-updater.yml', import.meta.url), 'utf8');
  assert.match(wf, /token: \$\{\{ secrets\.ISSUE_CONCIERGE_TOKEN \|\| secrets\.CONCIERGE_TOKEN \|\| github\.token \}\}/);
  assert.match(wf, /ISSUE_CONCIERGE_TOKEN: \$\{\{ secrets\.ISSUE_CONCIERGE_TOKEN \|\| secrets\.CONCIERGE_TOKEN \}\}/);
  assert.doesNotMatch(wf, /^\s+CONCIERGE_TOKEN:/m, 'the script gets one variable, not two');
  assert.match(wf, /issue-concierge\/update/);
});

test('without a token the updater says which secret to create and that the old name still works', async () => {
  const lines = [];
  const log = console.log;
  console.log = (m) => lines.push(String(m));
  try {
    await main([], {});
    await main([], { CONCIERGE_TOKEN: 'x' });
    await main([], { ISSUE_CONCIERGE_TOKEN: 'x' });
  } finally {
    console.log = log;
  }
  const said = lines.filter((l) => /is not set/.test(l));
  assert.equal(said.length, 1, 'only a run with neither secret says so');
  assert.match(said[0], /ISSUE_CONCIERGE_TOKEN is not set \(the old name, CONCIERGE_TOKEN, still works\)/);
});

/** The real context over a stubbed fetch: answers by URL, and records every call with its method and token. */
async function withFetch(answers, fn) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    seen.push({ url: String(url), method, auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : undefined });
    const answer = answers(String(url), method);
    if (answer === null) return { ok: false, status: 422, text: async () => 'no such ref', json: async () => ({}) };
    return { ok: true, status: 200, json: async () => answer, text: async () => '' };
  };
  try {
    await fn(seen);
  } finally {
    globalThis.fetch = real;
  }
}

test('retiring the old branch closes the pull requests open from it with a pointer to the new one, deletes the branch, and uses the new secret first', async () => {
  const answers = (url, method) => (method === 'GET' && url.includes('/pulls?state=open&head=o:concierge/update') ? [{ number: 3 }, { number: 4 }] : method === 'DELETE' ? {} : {});
  await withFetch(answers, async (seen) => {
    const ctx = realContext({ GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'read', ISSUE_CONCIERGE_TOKEN: 'new', CONCIERGE_TOKEN: 'old' }, '/tmp');
    await ctx.retireLegacyBranch(LEGACY_BRANCH, { number: 9 });
    const writes = seen.filter((c) => c.method !== 'GET');
    assert.deepEqual(writes.map((c) => `${c.method} ${c.url.replace('https://api.github.com/', '')}`), [
      'POST repos/o/r/issues/3/comments',
      'PATCH repos/o/r/pulls/3',
      'POST repos/o/r/issues/4/comments',
      'PATCH repos/o/r/pulls/4',
      'DELETE repos/o/r/git/refs/heads/concierge/update',
    ]);
    assert.match(writes[0].body.body, /Replaced by #9: the updater now builds its pull request on `issue-concierge\/update`\. Closing this one\./);
    assert.deepEqual(writes[1].body, { state: 'closed' });
    assert.ok(writes.every((c) => c.auth === 'Bearer new'), 'the new secret is used when both exist');
  });
});

test('the old secret still writes when it is the only one, and a branch that is already gone is no error', async () => {
  const answers = (url, method) => (method === 'DELETE' ? null : []);
  await withFetch(answers, async (seen) => {
    const ctx = realContext({ GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'read', CONCIERGE_TOKEN: 'old' }, '/tmp');
    await ctx.retireLegacyBranch(LEGACY_BRANCH, { number: 9 });
    const del = seen.find((c) => c.method === 'DELETE');
    assert.ok(del, 'the deletion was tried');
    assert.equal(del.auth, 'Bearer old');
    assert.equal(seen.filter((c) => c.method === 'PATCH').length, 0, 'nothing open, nothing closed');
  });
});
