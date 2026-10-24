// Checks the agent skills in .claude/skills (release tooling, not deployed).
//
// A skill is a folder `.claude/skills/<name>/` with a `SKILL.md`: front matter (`name`, `description`)
// and Markdown steps that Claude Code and GitHub's Copilot coding agent load on demand. The checks keep
// a skill loadable and honest: it cannot name a file, an npm script, a workflow or a workflow input that
// does not exist, because an agent follows what it says literally.
//
//   node tools/validate-skills.mjs [repo root]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILLS_DIR = '.claude/skills';
export const MAX_BODY_LINES = 500;
export const MAX_DESCRIPTION = 1000;
/** Front matter keys a skill may use. `allowed-tools` is not one of them: a skill must not pre-approve tools. */
export const ALLOWED_KEYS = ['name', 'description', 'disable-model-invocation', 'license'];
export const MAINTAINER_LINE = '**Only run when a maintainer asks. If you are a coding agent without the needed access, stop and say so in the issue or pull request.**';

/** Top-level repository paths a skill may mention in code spans and that must then exist. */
const REPO_PATH = /^(?:\.claude\/|\.github\/|docs\/|tools\/|scripts\/|workflows\/|shared\/|aw\.yml$|requirements\.json$|package\.json$|README\.md$)/;
const SECRET_LOOKING = /(?:ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b/;

/** `{ meta, body, error }` from a SKILL.md: single-line `key: value` front matter only. */
export function parseSkill(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { error: 'no front matter (the file must start with --- and a closing ---)' };
  const meta = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const kv = line.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/);
    if (!kv) return { error: `front matter line is not a single-line "key: value": ${line.slice(0, 60)}` };
    meta[kv[1]] = kv[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return { meta, body: m[2] };
}

/** The command lines of every fenced code block, with `\` continuations joined. */
export function commandLines(body) {
  const out = [];
  for (const block of body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    out.push(...block[1].replace(/\s*\\\n\s*/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean));
  }
  return out;
}

const exists = (root, rel) => fs.existsSync(path.join(root, rel));

/** Inputs a workflow file declares under `workflow_dispatch`. */
function dispatchInputs(root, file) {
  for (const dir of ['.github/workflows', 'workflows']) {
    if (!exists(root, `${dir}/${file}`)) continue;
    const text = fs.readFileSync(path.join(root, dir, file), 'utf8');
    const lines = text.split('\n');
    const at = lines.findIndex((l) => /^\s*workflow_dispatch:/.test(l));
    if (at < 0) return { found: true, inputs: new Set(), dispatchable: false };
    const indent = lines[at].match(/^\s*/)[0].length;
    const inputs = new Set();
    let inInputs = false;
    for (const line of lines.slice(at + 1)) {
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const depth = line.match(/^\s*/)[0].length;
      if (depth <= indent) break;
      if (depth === indent + 2) inInputs = /^\s*inputs:\s*$/.test(line);
      else if (inInputs && depth === indent + 4) {
        const key = line.match(/^\s*([A-Za-z0-9_-]+):\s*$/);
        if (key) inputs.add(key[1]);
      }
    }
    return { found: true, inputs, dispatchable: true };
  }
  return { found: false };
}

/** Problems in one skill folder (`dir` is relative to `root`); empty when it is right. */
export function validateSkill(root, dir) {
  const problems = [];
  const name = path.basename(dir);
  const problem = (text) => problems.push(`${dir}: ${text}`);
  const file = path.join(root, dir, 'SKILL.md');
  if (!fs.existsSync(file)) return [`${dir}: no SKILL.md`];
  const text = fs.readFileSync(file, 'utf8');
  const { meta, body, error } = parseSkill(text);
  if (error) return [`${dir}/SKILL.md: ${error}`];

  for (const key of Object.keys(meta)) if (!ALLOWED_KEYS.includes(key)) problem(`front matter key "${key}" is not allowed (${ALLOWED_KEYS.join(', ')})`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.name ?? '') || meta.name.length > 64) problem(`name "${meta.name}" must be lowercase letters, digits and hyphens, up to 64 characters`);
  if (meta.name !== name) problem(`name "${meta.name}" must equal the directory name "${name}"`);
  if (!meta.description) problem('description is empty: it decides when the skill is used');
  else if (meta.description.length >= MAX_DESCRIPTION) problem(`description is ${meta.description.length} characters (limit ${MAX_DESCRIPTION - 1})`);
  const lines = body.split('\n').length;
  if (lines >= MAX_BODY_LINES) problem(`body is ${lines} lines (limit ${MAX_BODY_LINES - 1}); move detail into a file next to SKILL.md`);
  if (SECRET_LOOKING.test(text)) problem('contains something that looks like a credential');

  if (meta['disable-model-invocation'] !== undefined && !['true', 'false'].includes(meta['disable-model-invocation'])) problem('disable-model-invocation must be true or false');
  if (meta['disable-model-invocation'] === 'true') {
    const first = body.split('\n').find((l) => l.trim());
    if (first?.trim() !== MAINTAINER_LINE) problem(`a skill with side effects must open with: ${MAINTAINER_LINE}`);
  }

  // Relative Markdown links resolve from the skill's folder.
  for (const link of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = link[1].split('#')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (!fs.existsSync(path.resolve(root, dir, target))) problem(`link ${link[1]} does not resolve`);
  }
  // Repository paths in code spans.
  for (const span of body.matchAll(/`([^`\n]+)`/g)) {
    const token = span[1].trim();
    if (!REPO_PATH.test(token) || /[*<>{}$\s]/.test(token)) continue;
    if (!exists(root, token.replace(/[:,.]+$/, ''))) problem(`\`${token}\` does not exist in the repository`);
  }

  // Commands in code blocks.
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {};
  for (const cmd of commandLines(body)) {
    const npm = cmd.match(/^npm (?:run )?([a-z][\w:-]*)/);
    if (npm && !(npm[1] in scripts) && npm[1] !== 'ci' && npm[1] !== 'install') problem(`\`${cmd}\`: package.json has no script "${npm[1]}"`);
    for (const run of cmd.matchAll(/\b(?:node|bash)\s+(\.?[\w./-]+\.(?:mjs|js|sh))/g)) {
      if (!exists(root, run[1])) problem(`\`${cmd}\`: ${run[1]} does not exist`);
    }
    const dispatch = cmd.match(/^gh workflow run (\S+\.ya?ml)\b(.*)$/);
    if (dispatch) {
      const wf = dispatchInputs(root, dispatch[1]);
      if (!wf.found) problem(`\`${cmd}\`: workflow ${dispatch[1]} not found in .github/workflows or workflows`);
      else {
        if (!wf.dispatchable) problem(`\`${cmd}\`: ${dispatch[1]} has no workflow_dispatch trigger`);
        for (const input of dispatch[2].matchAll(/\s-[fF]\s+([A-Za-z0-9_-]+)=/g)) {
          if (wf.dispatchable && !wf.inputs.has(input[1])) problem(`\`${cmd}\`: ${dispatch[1]} has no input "${input[1]}"`);
        }
      }
    }
  }

  // Files next to SKILL.md are there to be used: every one is named in the body.
  const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(dir)) {
    const rel = path.relative(dir, f);
    if (rel === 'SKILL.md' || /\.test\.mjs$/.test(rel)) continue;
    if (!body.includes(rel) && !body.includes(path.basename(rel))) problem(`${rel} is not mentioned in SKILL.md`);
  }
  return problems;
}

/** Problems in every skill under `root`/.claude/skills; empty when there are none or all are right. */
export function validateSkills(root) {
  const base = path.join(root, SKILLS_DIR);
  if (!fs.existsSync(base)) return [];
  const dirs = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `${SKILLS_DIR}/${e.name}`);
  return dirs.flatMap((d) => validateSkill(root, d));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const problems = validateSkills(root);
  for (const p of problems) console.error(`error: ${p}`);
  console.log(problems.length ? `${problems.length} problem(s)` : 'skills ok');
  process.exit(problems.length ? 1 : 0);
}
