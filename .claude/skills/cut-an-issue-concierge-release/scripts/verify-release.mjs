// Read-only check of a published Issue Concierge release. Changes nothing.
//
//   node verify-release.mjs <tag> [--previous <tag>] [--repo <owner/name>]
//
// Checks: the release is published (not a draft) and immutable, `gh release verify` and
// `gh release verify-asset` pass, the tag resolves to the commit the manifest names, and the
// manifest is for this tag. Then prints what the manifest adds, removes and changes compared
// with the previous release (the previous stable release unless --previous is given).
// Needs the `gh` CLI, logged in, in a version that has `gh release verify`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gh = (args, opts = {}) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const ghJson = (args) => JSON.parse(gh(args));

/** Files added, removed and changed between two manifests (by SHA-256). */
export function compareManifests(previous, current) {
  const before = new Map((previous?.files ?? []).map((f) => [f.path, f.sha256]));
  const after = new Map((current?.files ?? []).map((f) => [f.path, f.sha256]));
  const added = [...after.keys()].filter((p) => !before.has(p)).sort();
  const removed = [...before.keys()].filter((p) => !after.has(p)).sort();
  const changed = [...after.keys()].filter((p) => before.has(p) && before.get(p) !== after.get(p)).sort();
  return { added, removed, changed };
}

/** Problems with a manifest for `tag` whose tag resolves to `tagCommit`; empty when it is right. */
export function manifestProblems(manifest, tag, tagCommit) {
  const problems = [];
  if (manifest.tag !== tag) problems.push(`manifest tag is ${manifest.tag}, expected ${tag}`);
  if (manifest.version !== tag.replace(/^v/, '')) problems.push(`manifest version is ${manifest.version}, expected ${tag.replace(/^v/, '')}`);
  if (manifest.commit !== tagCommit) problems.push(`manifest commit ${manifest.commit} is not the tag's commit ${tagCommit}`);
  return problems;
}

/** The commit a tag points at, following an annotated tag object once. */
function tagCommit(repo, tag) {
  const ref = ghJson(['api', `repos/${repo}/git/ref/tags/${tag}`]);
  if (ref.object.type === 'commit') return ref.object.sha;
  return ghJson(['api', `repos/${repo}/git/tags/${ref.object.sha}`]).object.sha;
}

/** Downloads a release's manifest into `dir` and returns the file's path. */
export function downloadManifest(repo, tag, dir) {
  gh(['release', 'download', tag, '-R', repo, '-p', 'release-manifest.json', '-D', dir, '--clobber']);
  return path.join(dir, 'release-manifest.json');
}

/** The parsed manifest of a release. */
export function fetchManifest(repo, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-'));
  try {
    return JSON.parse(fs.readFileSync(downloadManifest(repo, tag, dir), 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The stable release before `tag` (undefined when there is none). */
export function previousStableTag(repo, tag) {
  const releases = ghJson(['release', 'list', '-R', repo, '--exclude-drafts', '--json', 'tagName,isPrerelease', '--limit', '30']);
  const tags = releases.filter((r) => !r.isPrerelease).map((r) => r.tagName);
  return tags[tags.indexOf(tag) + 1];
}

/** `<tag> [--previous <tag>] [--repo <owner/name>]` */
export function parseArgs(args) {
  const out = { repo: 'gearsnlevers/issue-concierge' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--previous') out.previous = args[++i];
    else if (args[i] === '--repo') out.repo = args[++i];
    else if (!args[i].startsWith('--') && !out.tag) out.tag = args[i];
    else return { ...out, error: `unexpected argument ${args[i]}` };
  }
  return out;
}

function main(argv) {
  const { tag, previous: previousOption, repo, error } = parseArgs(argv.slice(2));
  if (!tag || error) {
    console.error(`${error ? error + '\n' : ''}usage: node verify-release.mjs <tag> [--previous <tag>] [--repo <owner/name>]`);
    return 2;
  }
  const failures = [];
  const check = (ok, text) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
    if (!ok) failures.push(text);
  };

  const release = ghJson(['release', 'view', tag, '-R', repo, '--json', 'tagName,isDraft,isPrerelease,isImmutable,assets']);
  check(!release.isDraft, `${tag} is published (not a draft)`);
  check(release.isImmutable, `${tag} is immutable`);
  check(release.assets.some((a) => a.name === 'release-manifest.json'), 'release-manifest.json is attached');

  try {
    gh(['release', 'verify', tag, '-R', repo]);
    check(true, 'gh release verify passes (attestation)');
  } catch (e) {
    check(false, `gh release verify failed: ${String(e.stderr || e.message).trim()}`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-'));
  const manifestPath = downloadManifest(repo, tag, tmp);
  try {
    gh(['release', 'verify-asset', tag, manifestPath, '-R', repo]);
    check(true, 'gh release verify-asset passes for release-manifest.json');
  } catch (e) {
    check(false, `gh release verify-asset failed: ${String(e.stderr || e.message).trim()}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const commit = tagCommit(repo, tag);
  const problems = manifestProblems(manifest, tag, commit);
  check(problems.length === 0, problems.length ? problems.join('; ') : `manifest is for ${tag} and its commit ${commit.slice(0, 7)} is the tag's commit`);
  console.log(`     ${manifest.files.length} files, gh-aw ${manifest.ghAw.version}`);

  const previousTag = previousOption ?? previousStableTag(repo, tag);
  if (previousTag) {
    const previous = fetchManifest(repo, previousTag);
    const { added, removed, changed } = compareManifests(previous, manifest);
    console.log(`\nCompared with ${previousTag}${previous.ghAw.version !== manifest.ghAw.version ? ` (gh-aw ${previous.ghAw.version} -> ${manifest.ghAw.version}: lock files will change everywhere)` : ''}:`);
    for (const [label, list] of [['added', added], ['removed', removed], ['changed', changed]]) {
      console.log(`  ${label} (${list.length})${list.length ? ': ' + list.join(', ') : ''}`);
    }
    console.log('  Read this against what the merged pull requests were meant to change; anything else is a surprise.');
  } else {
    console.log('\nNo previous release to compare with.');
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed. Do not roll this release out.`);
    return 1;
  }
  console.log('\nAll checks passed.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv));
  } catch (e) {
    console.error(`verify-release: ${String(e.stderr || e.message).trim()}`);
    process.exit(1);
  }
}
