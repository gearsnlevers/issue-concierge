import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectPins, findBehind, ISSUE_TITLE, latestTag, levelBehind, MARKER, parseUses, pinnedVersion, renderIssue, syncIssue } from './check-currency.mjs';

test('parseUses reads tags, SHAs with a version comment and nested action paths, and skips local and docker uses', () => {
  const uses = parseUses(
    [
      'steps:',
      '  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
      '  - uses: actions/setup-node@v7',
      '    with:',
      '      node-version: 24',
      '      - uses: github/gh-aw-actions/setup@e7519e6442ef74dda80a1627315ad827f402309c # v0.93.0',
      '  - uses: ./.github/actions/local',
      '  - uses: docker://ghcr.io/x/y@sha256:0123456789abcdef',
      '  - run: echo "uses: not/anaction@v1"',
    ].join('\n'),
    'f.yml'
  );
  assert.deepEqual(
    uses.map((u) => [u.action, u.repo, u.ref.slice(0, 7), u.comment]),
    [
      ['actions/checkout', 'actions/checkout', '3d3c42e', 'v7.0.1'],
      ['actions/setup-node', 'actions/setup-node', 'v7', undefined],
      ['github/gh-aw-actions/setup', 'github/gh-aw-actions', 'e7519e6', 'v0.93.0'],
    ]
  );
});

test('a pin stands for its tag, or for the version comment behind a SHA, and for nothing else', () => {
  assert.equal(pinnedVersion({ ref: 'v7', comment: undefined }), 'v7');
  assert.equal(pinnedVersion({ ref: 'v0.93.0' }), 'v0.93.0');
  assert.equal(pinnedVersion({ ref: '3d3c42e5aac5ba805825da76410c181273ba90b1', comment: 'v7.0.1' }), 'v7.0.1');
  assert.equal(pinnedVersion({ ref: '3d3c42e5aac5ba805825da76410c181273ba90b1', comment: 'checkout' }), null);
  assert.equal(pinnedVersion({ ref: 'main' }), null);
});

test('levelBehind: a major pin is behind only by a newer major, a full pin by any newer part', () => {
  const cases = [
    ['v6', 'v7.1.0', 'major'],
    ['v7', 'v7.1.0', 'current'],
    ['v7.0', 'v7.1.0', 'minor'],
    ['v7.0.1', 'v7.1.0', 'minor'],
    ['v7.0.1', 'v7.0.3', 'patch'],
    ['v0.93.0', 'v0.93.3', 'patch'],
    ['v0.92.0', 'v0.93.3', 'minor'],
    ['v7.0.1', 'v7.0.1', 'current'],
    ['v8.0.0', 'v7.9.9', 'current'],
    ['v7.2.0', 'v7.1.9', 'current'],
  ];
  for (const [current, latest, level] of cases) assert.equal(levelBehind(current, latest), level, `${current} against ${latest}`);
});

const pin = (name, current, file, kind = 'action') => ({ kind, name, repo: name.split('/').slice(0, 2).join('/'), current, file, ref: current });

test('findBehind orders by how far behind first, then by name', () => {
  const pins = [pin('a/patch', 'v1.0.0', 'f:1'), pin('m/minor', 'v1.0.0', 'f:2'), pin('z/major', 'v1.0.0', 'f:3'), pin('b/major', 'v1.0.0', 'f:4')];
  const latest = { 'a/patch': 'v1.0.1', 'm/minor': 'v1.1.0', 'z/major': 'v2.0.0', 'b/major': 'v2.0.0' };
  assert.deepEqual(findBehind(pins, (repo) => latest[repo]).behind.map((b) => b.name), ['b/major', 'z/major', 'm/minor', 'a/patch']);
});

test('findBehind groups the files of one pin and lists pins it cannot read', () => {
  const pins = [
    pin('actions/setup-node', 'v6', 'a.yml:1'),
    pin('actions/setup-node', 'v6', 'b.yml:2'),
    pin('actions/checkout', 'v7.0.1', 'a.yml:3'),
    pin('gh-aw (requirements.json)', 'v0.93.0', 'requirements.json', 'gh-aw'),
    { ...pin('actions/cache', null, 'c.yml:4'), ref: 'main' },
  ];
  pins[3].repo = 'github/gh-aw';
  const latest = { 'actions/setup-node': 'v7.1.0', 'actions/checkout': 'v7.0.1', 'github/gh-aw': 'v0.93.3' };
  const { behind, unknown } = findBehind(pins, (repo) => latest[repo]);
  assert.deepEqual(
    behind.map((b) => [b.name, b.level, b.files]),
    [
      ['actions/setup-node', 'major', ['a.yml:1', 'b.yml:2']],
      ['gh-aw (requirements.json)', 'patch', ['requirements.json']],
    ]
  );
  assert.deepEqual(unknown.map((u) => u.name), ['actions/cache']);
});

test('a repository whose latest release cannot be found is skipped, not reported', () => {
  assert.deepEqual(findBehind([pin('x/y', 'v1', 'f.yml:1')], () => null).behind, []);
});

test('collectPins reads the delivered and the own workflows and the gh-aw pin', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'currency-'));
  fs.mkdirSync(path.join(root, 'workflows'));
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflows/updater.yml'), 'steps:\n  - uses: actions/setup-node@v6\n');
  fs.writeFileSync(path.join(root, 'workflows/gate.md'), 'steps:\n  - uses: not/read@v1\n');
  fs.writeFileSync(path.join(root, '.github/workflows/ci.yml'), 'steps:\n  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n');
  fs.writeFileSync(path.join(root, 'requirements.json'), JSON.stringify({ ghAw: { version: 'v0.93.0' } }));
  const pins = collectPins(root);
  assert.deepEqual(
    pins.map((p) => [p.kind, p.name, p.current, p.file]),
    [
      ['action', 'actions/setup-node', 'v6', 'workflows/updater.yml:2'],
      ['action', 'actions/checkout', 'v7.0.1', '.github/workflows/ci.yml:2'],
      ['gh-aw', 'gh-aw (requirements.json)', 'v0.93.0', 'requirements.json'],
    ]
  );
});

test('the real repository pins are all readable', () => {
  const pins = collectPins(new URL('..', import.meta.url).pathname);
  assert.ok(pins.some((p) => p.kind === 'gh-aw' && p.current));
  assert.ok(pins.filter((p) => p.kind === 'action').length >= 5);
  assert.deepEqual(pins.filter((p) => !p.current).map((p) => p.file), [], 'every pin should name a version a check can read');
});

test('the issue body carries the marker, one row per pin and the files', () => {
  const body = renderIssue({ behind: [{ name: 'actions/setup-node', current: 'v6', latest: 'v7.1.0', level: 'major', files: ['a.yml:1', 'b.yml:2'] }], unknown: [{ name: 'x/y', ref: 'main', file: 'c.yml:3' }] });
  assert.ok(body.startsWith(MARKER));
  assert.match(body, /\| actions\/setup-node \| v6 \| v7\.1\.0 \| major \| `a\.yml:1`, `b\.yml:2` \|/);
  assert.match(body, /`x\/y@main` in `c\.yml:3`/);
});

const fakeGh = (open) => {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    return args[0] === 'issue' && args[1] === 'list' ? JSON.stringify(open) : '';
  };
  return { gh, calls };
};
const behind = { behind: [{ name: 'a/b', current: 'v1', latest: 'v2', level: 'major', files: ['f:1'] }], unknown: [] };

test('syncIssue creates the issue when something is behind and none is open', () => {
  const { gh, calls } = fakeGh([]);
  assert.equal(syncIssue(behind, gh), 'created the issue');
  assert.deepEqual(calls.at(-1).slice(0, 4), ['issue', 'create', '--title', ISSUE_TITLE]);
});

test('syncIssue updates the open issue instead of opening another, and ignores other issues', () => {
  const { gh, calls } = fakeGh([{ number: 7, title: 'something else' }, { number: 9, title: ISSUE_TITLE }]);
  assert.equal(syncIssue(behind, gh), 'updated #9');
  assert.deepEqual(calls.at(-1).slice(0, 3), ['issue', 'edit', '9']);
});

test('syncIssue closes the open issue when nothing is behind, and does nothing when none is open', () => {
  const clean = { behind: [], unknown: [] };
  const open = fakeGh([{ number: 9, title: ISSUE_TITLE }]);
  assert.equal(syncIssue(clean, open.gh), 'closed #9');
  assert.deepEqual(open.calls.at(-1).slice(0, 3), ['issue', 'close', '9']);
  const none = fakeGh([]);
  assert.equal(syncIssue(clean, none.gh), 'nothing is behind and no issue is open');
  assert.equal(none.calls.length, 1, 'only the lookup ran');
});

test('latestTag uses the latest release, falls back to the newest tag, and gives up quietly', () => {
  assert.equal(latestTag('a/b', () => 'v2.0.0\n'), 'v2.0.0');
  let n = 0;
  assert.equal(latestTag('a/b', () => { if (n++ === 0) throw new Error('404'); return 'v1.9.0\n'; }), 'v1.9.0');
  assert.equal(latestTag('a/b', () => { throw new Error('404'); }), null);
});
