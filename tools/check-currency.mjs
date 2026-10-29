#!/usr/bin/env node
// Weekly currency check for Issue Concierge itself (this file is not delivered to deployments).
//
// Dependabot cannot see two things that decide what every deployment runs: the workflow files the
// Concierge delivers (they live in workflows/, and Dependabot only reads .github/workflows/), and the
// gh-aw version in requirements.json. A deployment that runs Dependabot then finds the stale pins
// first and proposes edits to files the Concierge owns. This check compares what the Concierge pins
// with the latest releases and keeps ONE open issue listing what is behind (it closes it again when
// nothing is). It changes nothing else: a maintainer bumps, tests and releases.
//
//   node tools/check-currency.mjs            report, and open/update/close the issue (needs gh and issues: write)
//   node tools/check-currency.mjs --dry-run  report only
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ISSUE_TITLE = 'Issue Concierge currency: actions and gh-aw are behind their latest release';
export const MARKER = '<!-- issue-concierge-currency -->';
// What a version before the product was named for its kind opened the issue with. An open issue under the old title is the
// one issue, and it is renamed when it is updated.
export const LEGACY_ISSUE_TITLE = 'Concierge currency: actions and gh-aw are behind their latest release';
export const LEGACY_MARKER = '<!-- concierge-currency -->';

/** Every `uses:` of a workflow file, with the version comment gh-aw and Dependabot put after a SHA. */
export function parseUses(text, file = '') {
  const found = [];
  text.split('\n').forEach((line, index) => {
    const m = line.match(/^\s*(?:-\s+)?uses:\s*(\S+?)(?:\s+#\s*(\S+))?\s*$/);
    if (!m) return;
    const spec = m[1].replace(/^["']|["']$/g, '');
    if (spec.startsWith('./') || spec.startsWith('docker://')) return;
    const at = spec.lastIndexOf('@');
    if (at < 0) return;
    const parts = spec.slice(0, at).split('/');
    if (parts.length < 2) return;
    found.push({ file, line: index + 1, repo: `${parts[0]}/${parts[1]}`, action: spec.slice(0, at), ref: spec.slice(at + 1), comment: m[2] });
  });
  return found;
}

const VERSION = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const parts = (v) => {
  const m = VERSION.exec(v);
  return m && [Number(m[1]), m[2] === undefined ? null : Number(m[2]), m[3] === undefined ? null : Number(m[3])];
};

/** The version a pin stands for: a tag, or the version comment behind a SHA. Null when it cannot be told. */
export function pinnedVersion({ ref, comment }) {
  if (parts(ref)) return ref;
  if (comment && parts(comment)) return comment;
  return null;
}

/**
 * How far `current` is behind `latest`: 'current', 'patch', 'minor' or 'major'. A pin that names only
 * a major (v7) is behind only when a newer major exists; one that names major.minor only compares
 * those two.
 */
export function levelBehind(current, latest) {
  const c = parts(current);
  const l = parts(latest);
  if (!c || !l) return 'current';
  if (l[0] > c[0]) return 'major';
  if (l[0] < c[0]) return 'current';
  if (c[1] === null) return 'current';
  if ((l[1] ?? 0) > c[1]) return 'minor';
  if ((l[1] ?? 0) < c[1]) return 'current';
  if (c[2] === null) return 'current';
  return (l[2] ?? 0) > c[2] ? 'patch' : 'current';
}

/** Everything the Concierge pins: actions in the delivered workflows and its own, and the gh-aw version. */
export function collectPins(root) {
  const pins = [];
  for (const dir of ['workflows', '.github/workflows']) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs).sort()) {
      if (!/\.ya?ml$/.test(name)) continue;
      const file = `${dir}/${name}`;
      for (const use of parseUses(fs.readFileSync(path.join(abs, name), 'utf8'), file)) {
        pins.push({ kind: 'action', name: use.action, repo: use.repo, current: pinnedVersion(use), file: `${file}:${use.line}`, ref: use.ref });
      }
    }
  }
  const req = JSON.parse(fs.readFileSync(path.join(root, 'requirements.json'), 'utf8'));
  pins.push({ kind: 'gh-aw', name: 'gh-aw (requirements.json)', repo: 'github/gh-aw', current: req.ghAw.version, file: 'requirements.json', ref: req.ghAw.version });
  return pins;
}

/** Compares the pins with `latestOf(repo)` and returns what is behind, grouped by action and version. */
export function findBehind(pins, latestOf) {
  const latest = new Map();
  const unknown = [];
  const groups = new Map();
  for (const pin of pins) {
    if (!pin.current) {
      unknown.push(pin);
      continue;
    }
    if (!latest.has(pin.repo)) latest.set(pin.repo, latestOf(pin.repo));
    const tag = latest.get(pin.repo);
    if (!tag) continue;
    const level = levelBehind(pin.current, tag);
    if (level === 'current') continue;
    const key = `${pin.name}@${pin.current}`;
    const group = groups.get(key) ?? { name: pin.name, current: pin.current, latest: tag, level, files: [] };
    group.files.push(pin.file);
    groups.set(key, group);
  }
  const order = { major: 0, minor: 1, patch: 2 };
  const behind = [...groups.values()].sort((a, b) => order[a.level] - order[b.level] || a.name.localeCompare(b.name));
  return { behind, unknown };
}

export function renderIssue({ behind, unknown }) {
  const rows = behind.map((b) => `| ${b.name} | ${b.current} | ${b.latest} | ${b.level} | ${b.files.map((f) => `\`${f}\``).join(', ')} |`);
  const lines = [
    MARKER,
    'These pins in Issue Concierge are behind the latest release. The workflows in `workflows/` are delivered to every deployment, so a deployment that runs Dependabot will find the stale pins first and propose edits to files the Concierge owns. Bumping them here, testing and releasing is how they reach the deployments. A deployment decides for itself what to do with Dependabot; this repository does not configure it.',
    '',
    '| Pin | Current | Latest | Behind | Where |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    'For an action: bump the pin in the files listed, run `npm test`, release. For gh-aw: change `ghAw.version` in `requirements.json`, run `bash tools/ci-compile-smoke.sh`, compare the compiled lock files with the previous version (secrets, permissions, the set of actions), read the gh-aw release notes for breaking changes, release.',
  ];
  if (unknown.length) {
    lines.push('', 'Not checked (no version can be read from the pin):', ...unknown.map((u) => `- \`${u.name}@${u.ref}\` in \`${u.file}\``));
  }
  lines.push('', '_This issue is kept by `tools/check-currency.mjs` (weekly) and closes itself when nothing is behind._');
  return lines.join('\n');
}

/** Opens, updates or closes the one currency issue. `gh(args)` runs the GitHub CLI and returns its output. */
export function syncIssue(result, gh, title = ISSUE_TITLE) {
  const titles = title === ISSUE_TITLE ? [ISSUE_TITLE, LEGACY_ISSUE_TITLE] : [title];
  const open = JSON.parse(gh(['issue', 'list', '--state', 'open', '--search', 'Concierge currency in:title', '--json', 'number,title', '--limit', '20'])).find((i) => titles.includes(i.title));
  if (result.behind.length === 0) {
    if (!open) return 'nothing is behind and no issue is open';
    gh(['issue', 'close', String(open.number), '--comment', 'Everything the Concierge pins is current again.']);
    return `closed #${open.number}`;
  }
  const body = renderIssue(result);
  if (open) {
    gh(['issue', 'edit', String(open.number), ...(open.title !== title ? ['--title', title] : []), '--body', body]);
    return `updated #${open.number}`;
  }
  gh(['issue', 'create', '--title', title, '--body', body]);
  return 'created the issue';
}

const ghCli = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** The latest non-prerelease tag of a repository: its latest release, else its newest tag. */
export function latestTag(repo, gh = ghCli) {
  try {
    return gh(['api', `repos/${repo}/releases/latest`, '--jq', '.tag_name']).trim() || null;
  } catch {
    try {
      return gh(['api', `repos/${repo}/tags`, '--jq', '.[0].name']).trim() || null;
    } catch {
      return null;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = findBehind(collectPins(root), (repo) => latestTag(repo));
  console.log(result.behind.length ? renderIssue(result) : 'Everything the Concierge pins is current.');
  if (!process.argv.includes('--dry-run')) console.log(`\nIssue: ${syncIssue(result, ghCli)}`);
}
