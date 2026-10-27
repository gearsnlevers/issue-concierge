// Release manifest for Repo Concierge (harness-only release tooling, not deployed).
//
// Deterministic: no network, no LLM. Builds release-manifest.json from aw.yml
// (the list of files a deployment installs) and requirements.json (labels,
// secrets and the gh-aw version the files were compiled and tested with). The
// manifest carries a SHA-256 digest for every file, so a deployment can verify
// that what it downloaded for a release is what the release contains.
//
//   node tools/build-release-manifest.mjs --version 1.2.0 [--tag v1.2.0] [--commit <sha>] [--out release-manifest.json]
//   node tools/build-release-manifest.mjs --verify release-manifest.json [--root <dir>]
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Directories whose every file (except tests) must be listed in aw.yml. */
export const COMPLETE_DIRS = ['workflows', 'scripts', 'shared'];

/** Files listed under `files:` in aw.yml. */
export function parseManifestFiles(awYml) {
  const out = [];
  let inFiles = false;
  for (const raw of String(awYml).split('\n')) {
    if (/^files:\s*$/.test(raw)) {
      inFiles = true;
      continue;
    }
    if (inFiles) {
      const m = raw.match(/^\s+-\s+(\S+)\s*$/);
      if (m) out.push(m[1]);
      else if (/^\S/.test(raw)) inFiles = false;
    }
  }
  return out;
}

const isTest = (f) => /\.test\.mjs$/.test(f);

/** Files in COMPLETE_DIRS that exist but are not listed (tests excluded). */
export function findUnlisted(root, listed) {
  const known = new Set(listed);
  const missing = [];
  for (const dir of COMPLETE_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs).sort()) {
      const rel = `${dir}/${name}`;
      if (fs.statSync(path.join(root, rel)).isFile() && !isTest(rel) && !known.has(rel)) missing.push(rel);
    }
  }
  return missing;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Where a file goes in a deployment and what it is:
 * `definition` (gh-aw markdown, must be compiled), `workflow` (plain Actions
 * YAML), `script`, or `reference` (shared templates and docs, not installed).
 */
export function classify(file, install) {
  const rule = (install || []).find((r) => file.startsWith(r.from));
  if (!rule) return { kind: 'reference', dest: null };
  const dest = rule.to + file.slice(rule.from.length);
  if (file.startsWith('workflows/')) return { kind: file.endsWith('.md') ? 'definition' : 'workflow', dest };
  return { kind: 'script', dest };
}

/**
 * Problems that would make GitHub reject a label (or the updater's create call):
 * names up to 50 characters, descriptions up to 100, a six-digit hex color, no duplicates.
 */
export function validateLabels(labels) {
  const problems = [];
  const seen = new Set();
  for (const l of labels || []) {
    const name = String(l.name ?? '');
    if (!name) problems.push('a label has no name');
    if (name.length > 50) problems.push(`${name}: name is ${name.length} characters (maximum 50)`);
    if (seen.has(name)) problems.push(`${name}: listed twice`);
    seen.add(name);
    const description = String(l.description ?? '');
    if (description.length > 100) problems.push(`${name}: description is ${description.length} characters (maximum 100)`);
    if (!/^[0-9a-fA-F]{6}$/.test(String(l.color ?? ''))) problems.push(`${name}: color must be six hex digits`);
  }
  return problems;
}

export function buildManifest({ root, version, tag, commit }) {
  const listed = parseManifestFiles(fs.readFileSync(path.join(root, 'aw.yml'), 'utf8'));
  const unlisted = findUnlisted(root, listed);
  if (unlisted.length) throw new Error(`not listed in aw.yml: ${unlisted.join(', ')}`);
  const gone = listed.filter((f) => !fs.existsSync(path.join(root, f)));
  if (gone.length) throw new Error(`listed in aw.yml but missing: ${gone.join(', ')}`);
  const req = JSON.parse(fs.readFileSync(path.join(root, 'requirements.json'), 'utf8'));
  const labelProblems = validateLabels(req.labels);
  if (labelProblems.length) throw new Error(`requirements.json labels: ${labelProblems.join('; ')}`);
  const files = [...new Set(listed)].sort().map((p) => {
    const buf = fs.readFileSync(path.join(root, p));
    return { path: p, ...classify(p, req.install), sha256: sha256(buf), bytes: buf.length };
  });
  return {
    schema: 1,
    name: 'issue-concierge',
    version,
    tag: tag || `v${version}`,
    commit: commit || null,
    ghAw: req.ghAw,
    install: req.install,
    files,
    requires: { labels: req.labels, secrets: req.secrets, perRelatedRepository: req.perRelatedRepository },
  };
}

/** Compare a manifest with the files under root. Returns a list of problems. */
export function verifyManifest(manifest, root) {
  const problems = validateLabels(manifest.requires?.labels).map((p) => `label ${p}`);
  for (const f of manifest.files || []) {
    const p = path.join(root, f.path);
    if (!fs.existsSync(p)) {
      problems.push(`missing: ${f.path}`);
      continue;
    }
    const buf = fs.readFileSync(p);
    if (sha256(buf) !== f.sha256) problems.push(`digest mismatch: ${f.path}`);
    else if (buf.length !== f.bytes) problems.push(`size mismatch: ${f.path}`);
  }
  return problems;
}

export function main(argv = process.argv.slice(2)) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const root = path.resolve(arg('--root') || '.');
  if (argv.includes('--verify')) {
    const manifest = JSON.parse(fs.readFileSync(arg('--verify'), 'utf8'));
    const problems = verifyManifest(manifest, root);
    for (const p of problems) console.error(`::error::${p}`);
    console.log(problems.length ? `${problems.length} problem(s)` : `verified ${manifest.files.length} files`);
    return problems.length ? 1 : 0;
  }
  const version = arg('--version');
  if (!version) {
    console.error('--version is required');
    return 2;
  }
  let manifest;
  try {
    manifest = buildManifest({ root, version, tag: arg('--tag'), commit: arg('--commit') || process.env.GITHUB_SHA });
  } catch (e) {
    console.error(`::error::${e.message}`);
    return 1;
  }
  const out = arg('--out') || 'release-manifest.json';
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${out}: ${manifest.files.length} files, ${manifest.requires.labels.length} labels`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
