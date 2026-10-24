// Read-only comparison of Repo Concierge update pull requests across deployments. Changes nothing.
//
//   node compare-update-prs.mjs <owner/repo#N> [<owner/repo#N> ...]
//
// For each pull request: title, branch, state and check results. Then the diffs are normalised
// (the lines that legitimately differ per repository are masked: gh-aw's frontmatter hash and
// secret list, git index lines, hunk line numbers) and grouped. Pull requests in one group
// changed exactly the same things. A second group is a difference to read before merging.
// Also prints the `permissions:` of every workflow file an update adds, since a new workflow
// brings new token scopes into the repository.
// Needs the `gh` CLI, logged in.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

/** Mask what differs between repositories by design, so equal updates compare equal. */
export function normalizeDiff(diff) {
  return diff
    .split('\n')
    .filter((line) => !line.startsWith('index '))
    .map((line) => {
      if (line.startsWith('@@')) return line.replace(/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/, '@@');
      if (/^[ +-]# gh-aw-metadata: /.test(line)) return line.replace(/"frontmatter_hash":"[0-9a-f]+"/, '"frontmatter_hash":"*"');
      if (/^[ +-]# gh-aw-manifest: /.test(line)) return line.replace(/"secrets":\[[^\]]*\]/, '"secrets":[*]');
      return line;
    })
    .join('\n');
}

/** Files in a diff with their status: added, removed, renamed or modified. */
export function listFiles(diff) {
  const files = [];
  let current;
  for (const line of diff.split('\n')) {
    const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (m) {
      current = { path: m[2], status: 'modified' };
      files.push(current);
    } else if (current && line.startsWith('new file mode')) current.status = 'added';
    else if (current && line.startsWith('deleted file mode')) current.status = 'removed';
    else if (current && line.startsWith('rename from')) current.status = 'renamed';
  }
  return files;
}

/** Group names whose normalised diffs are identical: [{ names, diff }] in first-seen order. */
export function groupByDiff(entries) {
  const groups = new Map();
  for (const [name, diff] of entries) {
    const key = normalizeDiff(diff);
    if (!groups.has(key)) groups.set(key, { names: [], diff: key });
    groups.get(key).names.push(name);
  }
  return [...groups.values()];
}

/** The `permissions:` blocks an update adds in plain workflow files (not lock files). */
export function addedPermissions(diff) {
  const out = [];
  let file;
  let isNew = false;
  let lines = [];
  const flush = () => {
    if (!file || !isNew || !/^\.github\/workflows\/[^/]+\.yml$/.test(file) || /\.lock\.yml$/.test(file)) return;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)permissions:\s*(.*)$/);
      if (!m) continue;
      const block = [lines[i].trim()];
      if (!m[2]) {
        for (let j = i + 1; j < lines.length && (/^\s*$/.test(lines[j]) || lines[j].match(/^\s*/)[0].length > m[1].length); j++) {
          if (lines[j].trim()) block.push(lines[j].trim());
        }
      }
      out.push({ file, block });
    }
  };
  for (const line of diff.split('\n')) {
    const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (m) {
      flush();
      file = m[2];
      isNew = false;
      lines = [];
    } else if (line.startsWith('new file mode')) isNew = true;
    else if (line.startsWith('+') && !line.startsWith('+++')) lines.push(line.slice(1));
  }
  flush();
  return out;
}

function checkSummary(rollup) {
  const states = rollup.map((c) => c.conclusion || c.status || c.state || '');
  const failed = states.filter((s) => ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ERROR'].includes(s)).length;
  const pending = states.filter((s) => ['', 'IN_PROGRESS', 'QUEUED', 'PENDING', 'WAITING', 'EXPECTED'].includes(s)).length;
  return `${states.length} checks, ${failed} failed, ${pending} pending`;
}

function main(argv) {
  const targets = argv.slice(2);
  if (!targets.length || targets.some((t) => !/^[^/\s]+\/[^#\s]+#\d+$/.test(t))) {
    console.error('usage: node compare-update-prs.mjs <owner/repo#N> [<owner/repo#N> ...]');
    return 2;
  }
  const entries = [];
  let problems = 0;
  for (const target of targets) {
    const [repo, number] = target.split('#');
    const pr = JSON.parse(gh(['pr', 'view', number, '-R', repo, '--json', 'title,headRefName,state,isDraft,statusCheckRollup']));
    const ok = /^chore: update Repo Concierge /.test(pr.title) && pr.headRefName === 'concierge/update';
    if (!ok) problems++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${target}: "${pr.title}" (${pr.headRefName}, ${pr.state}; ${checkSummary(pr.statusCheckRollup)})`);
    entries.push([target, gh(['pr', 'diff', number, '-R', repo])]);
  }

  const groups = groupByDiff(entries);
  console.log(`\n${groups.length === 1 ? 'All' : groups.length + ' different kinds of'} update${groups.length === 1 ? 's are identical' : ''} after masking per-repository lines.`);
  groups.forEach((group, i) => {
    console.log(`\nGroup ${i + 1}: ${group.names.join(', ')}`);
    for (const f of listFiles(group.diff)) console.log(`  ${f.status.padEnd(8)} ${f.path}`);
    if (i > 0) {
      const base = new Set(groups[0].diff.split('\n'));
      const mine = new Set(group.diff.split('\n'));
      console.log('  lines only in this group (+) or only in group 1 (-):');
      for (const l of group.diff.split('\n')) if (!base.has(l)) console.log(`   + ${l.slice(0, 200)}`);
      for (const l of groups[0].diff.split('\n')) if (!mine.has(l)) console.log(`   - ${l.slice(0, 200)}`);
      problems++;
    }
  });

  const perms = addedPermissions(entries[0][1]);
  if (perms.length) {
    console.log(`\nWorkflow files this update adds, with their permissions (from ${entries[0][0]}):`);
    for (const p of perms) console.log(`  ${p.file}: ${p.block.join(' | ')}`);
  }
  return problems ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv));
  } catch (e) {
    console.error(`compare-update-prs: ${String(e.stderr || e.message).trim()}`);
    process.exit(1);
  }
}
