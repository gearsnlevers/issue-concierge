// Read-only check that deployments are on a Repo Concierge release. Changes nothing.
//
//   node verify-rollout.mjs <tag> <owner/repo> [<owner/repo> ...] [--source <owner/name>]
//
// For each deployment's default branch:
//   - .github/concierge.yml pins the tag and the tag's commit;
//   - every file the manifest installs is there and byte-identical to the release (files with a
//     `# concierge:cross-repo` or `# concierge:cross-repo-env` marker are compared without the generated token, allowed-repos and CROSS_REPO lines);
//   - files the previous release installed and this one dropped are gone;
//   - every gh-aw lock file was compiled with the manifest's gh-aw version, and the role gate holds
//     (docs/deployment.md, "Who can start a gate"): `issue-worker` has no membership check, every
//     other gate keeps the default roles.
// What a particular release changed (a budget, a condition in a lock file) is not checked here:
// read the release comparison and check those by hand (see SKILL.md).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { compareManifests, fetchManifest, previousStableTag } from './verify-release.mjs';

const run = promisify(execFile);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** The file's text on the default branch (or at `ref`), or null when it does not exist. */
async function readFile(repo, file, ref) {
  try {
    const { stdout } = await run('gh', ['api', '-H', 'Accept: application/vnd.github.raw+json', `repos/${repo}/contents/${file}${ref ? `?ref=${ref}` : ''}`], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    if (/Not Found|404/.test(String(e.stderr))) return null;
    throw e;
  }
}

const GENERATED = /^\s*(github-token|allowed-repos|CROSS_REPO|CROSS_REPO_TOKEN):/;
const MARKER = /^\s*# concierge:cross-repo(-env)?\s*$/;
/** A definition or plain workflow with the cross-repository settings left out, to compare source and deployed copy. */
export const withoutCrossRepo = (text) => text.split('\n').filter((l) => !GENERATED.test(l) && !MARKER.test(l)).join('\n');

/** Problems with one lock file: compiler version and the role gate. Empty when it is right. */
export function lockProblems(name, lock, ghAwVersion) {
  const problems = [];
  const compiler = lock.match(/"compiler_version":"([^"]+)"/)?.[1];
  if (compiler !== ghAwVersion) problems.push(`${name}.lock.yml was compiled with ${compiler ?? 'an unknown gh-aw'}, expected ${ghAwVersion}`);
  const hasMembership = lock.includes('id: check_membership');
  if (name === 'issue-worker') {
    if (hasMembership) problems.push('issue-worker.lock.yml still checks team membership (roles: all not in effect)');
  } else if (!hasMembership || !lock.includes('GH_AW_REQUIRED_ROLES: "admin,maintainer,write"')) {
    problems.push(`${name}.lock.yml does not keep the default roles (admin,maintainer,write)`);
  }
  return problems;
}

async function verifyRepo(repo, tag, manifest, previous) {
  const results = [];
  const note = (ok, text) => results.push({ ok, text });
  const pin = (await readFile(repo, '.github/concierge.yml')) ?? '';
  const version = pin.match(/^version:\s*(\S+)/m)?.[1];
  const sha = pin.match(/^sha:\s*(\S+)/m)?.[1];
  note(version === tag && sha === manifest.commit, `pin is ${version ?? 'missing'} ${sha?.slice(0, 7) ?? ''}, expected ${tag} ${manifest.commit.slice(0, 7)}`);

  const installed = manifest.files.filter((f) => f.dest);
  await Promise.all(
    installed.map(async (f) => {
      const text = await readFile(repo, f.dest);
      if (text === null) return note(false, `${f.dest} is missing`);
      if (sha256(text) === f.sha256) return;
      if (f.kind === 'definition' || f.kind === 'workflow') {
        const source = await readFile(manifest.source ?? 'vscheuber/repo-concierge', f.path, manifest.commit);
        if (source !== null && withoutCrossRepo(source) === withoutCrossRepo(text)) return;
      }
      note(false, `${f.dest} differs from the release`);
    }),
  );
  for (const gone of previous ? compareManifests(previous, manifest).removed : []) {
    const dest = previous.files.find((f) => f.path === gone)?.dest;
    if (dest && (await readFile(repo, dest)) !== null) note(false, `${dest} was dropped by this release but is still there`);
  }
  await Promise.all(
    installed
      .filter((f) => f.kind === 'definition')
      .map(async (f) => {
        const name = path.basename(f.dest, '.md');
        const lock = await readFile(repo, f.dest.replace(/\.md$/, '.lock.yml'));
        if (lock === null) return note(false, `${name}.lock.yml is missing`);
        for (const problem of lockProblems(name, lock, manifest.ghAw.version)) note(false, problem);
      }),
  );
  return { repo, ok: results.every((r) => r.ok), results, checked: installed.length };
}

export function parseArgs(args) {
  const out = { repos: [], source: 'vscheuber/repo-concierge' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source') out.source = args[++i];
    else if (args[i].startsWith('--')) return { ...out, error: `unexpected option ${args[i]}` };
    else if (!out.tag) out.tag = args[i];
    else out.repos.push(args[i]);
  }
  return out;
}

async function main(argv) {
  const { tag, repos, source, error } = parseArgs(argv.slice(2));
  if (!tag || !repos.length || error || repos.some((r) => !/^[^/\s]+\/[^/\s]+$/.test(r))) {
    console.error(`${error ? error + '\n' : ''}usage: node verify-rollout.mjs <tag> <owner/repo> [<owner/repo> ...] [--source <owner/name>]`);
    return 2;
  }
  const manifest = { ...fetchManifest(source, tag), source };
  const previousTag = previousStableTag(source, tag);
  const previous = previousTag ? fetchManifest(source, previousTag) : undefined;
  console.log(`${tag} (${manifest.commit.slice(0, 7)}), gh-aw ${manifest.ghAw.version}${previousTag ? `, previous ${previousTag}` : ''}\n`);
  const outcomes = await Promise.all(repos.map((r) => verifyRepo(r, tag, manifest, previous)));
  for (const o of outcomes) {
    console.log(`${o.ok ? 'ok  ' : 'FAIL'} ${o.repo} (${o.checked} installed files checked)`);
    for (const r of o.results.filter((x) => !x.ok).sort((a, b) => a.text.localeCompare(b.text))) console.log(`       ${r.text}`);
  }
  const bad = outcomes.filter((o) => !o.ok).length;
  console.log(bad ? `\n${bad} of ${outcomes.length} deployments are not on ${tag}.` : `\nAll ${outcomes.length} deployments are on ${tag}.`);
  return bad ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`verify-rollout: ${String(e.stderr || e.message).trim()}`);
      process.exit(1);
    },
  );
}
