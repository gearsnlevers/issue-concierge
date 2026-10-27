#!/usr/bin/env node
// Renders the end-to-end sandbox template (tools/e2e/sandbox/<role>) into a directory, so a sandbox repository can be
// seeded, or reseeded, from the Repo Concierge itself. The template holds one half of a split project: `lib` computes,
// `app` calls it and prints. Placeholders are {{name}}, {{this}}, {{other}}, {{other_name}} and {{secret}}.
// Files that are in the directory but not in the template are left alone; files that are in both are overwritten.
// No dependencies. Usage:
//   node tools/e2e/seed-sandbox.mjs --role lib --this owner/e2e-lib --other owner/e2e-app --secret E2E_APP_ISSUES_TOKEN --out DIR
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sandbox');
export const ROLES = ['lib', 'app'];
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;
const SECRET = /^[A-Z][A-Z0-9_]*$/;

/** Lists the files of a template folder, as paths relative to it, in a stable order. */
function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

/** The values for the placeholders, checked: the repositories are `owner/name` and the secret is an Actions secret name. */
export function placeholderValues({ this: thisRepo, other, secret }) {
  if (!REPO.test(thisRepo || '')) throw new Error(`--this must be owner/name, got "${thisRepo ?? ''}"`);
  if (!REPO.test(other || '')) throw new Error(`--other must be owner/name, got "${other ?? ''}"`);
  if (thisRepo === other) throw new Error('--this and --other name the same repository');
  if (!SECRET.test(secret || '')) throw new Error(`--secret must be an Actions secret name such as E2E_APP_ISSUES_TOKEN, got "${secret ?? ''}"`);
  return { name: thisRepo.split('/')[1], this: thisRepo, other, other_name: other.split('/')[1], secret };
}

/** Renders one role into a map of relative path to content. An unknown or unfilled placeholder is an error. */
export function renderTemplate(role, values, templateRoot = TEMPLATE_ROOT) {
  if (!ROLES.includes(role)) throw new Error(`--role must be one of ${ROLES.join(', ')}, got "${role ?? ''}"`);
  const dir = path.join(templateRoot, role);
  const rendered = new Map();
  for (const file of listFiles(dir)) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\{\{([a-z_]+)\}\}/g, (match, key) => {
      if (!(key in values)) throw new Error(`${role}/${file}: unknown placeholder ${match}`);
      return values[key];
    });
    if (text.includes('{{')) throw new Error(`${role}/${file}: an unfilled placeholder is left`);
    rendered.set(file, text);
  }
  return rendered;
}

/** Writes the rendered files under `out` and returns their relative paths. */
export function seed({ role, out, ...repos }) {
  const rendered = renderTemplate(role, placeholderValues(repos));
  for (const [file, text] of rendered) {
    const target = path.join(out, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return [...rendered.keys()];
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith('--') || argv[i + 1] === undefined) throw new Error(`cannot read the arguments at "${key}"`);
    opts[key.slice(2)] = argv[i + 1];
  }
  return opts;
}

export function main(argv = process.argv.slice(2)) {
  try {
    const opts = parseArgs(argv);
    if (!opts.out) throw new Error('--out DIR is required');
    const files = seed({ role: opts.role, out: opts.out, this: opts.this, other: opts.other, secret: opts.secret });
    console.log(`Seeded ${files.length} files into ${opts.out} (${opts.role}, ${opts.this}).`);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = main();
}
