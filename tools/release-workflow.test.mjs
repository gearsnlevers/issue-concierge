import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The workflow `Release` (docs/releases.md, "Cutting a release") writes NOTHING to the default branch. It used to commit CHANGELOG.md and the
// version in package.json as github-actions[bot] and push that commit to main; a default branch that requires a pull request refuses such a
// push, and the token of the workflow has no bypass. What it may write to the repository now is the tag, on the commit the run started from,
// and then the release. The workflow is run for real only by a maintainer, so what cannot be tried here is stated here: the file is read line
// by line (no YAML library), `lint` returns what is wrong with a text, and the tests check the real file and damaged copies of it, so that a
// rule cannot silently stop saying anything. The two steps that the decision changed are also run, in a repository of their own.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const workflow = read('.github/workflows/release.yml');

const GUARD = "env.DRY_RUN != 'true'";
const WRITES = /\bgit (?:push|commit|tag)\b|\bgh release (?:create|upload|edit|delete)\b|\bargs=\(release create\b/;
const TAG_PUSH = 'git push origin "refs/tags/${TAG}"';
const TAG_COMMAND = 'git tag -a "${TAG}" -m "Release ${TAG}" "${current}"';
const GENERATE_NOTES = 'repos/${GITHUB_REPOSITORY}/releases/generate-notes';
/** The only actions the release uses. An action that commits, opens a pull request or edits a file is not among them. */
const USED = ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact', 'gearsnlevers/ai-changelog-action', 'gearsnlevers/release-preflight-action', 'gearsnlevers/version-bump-action'];
const ORDER = [
  'Require the default branch for a real release',
  'Unit tests',
  'Compile every workflow definition with gh-aw',
  'Compute next version',
  'Release preflight checks',
  'The files are the files of the commit',
  'Build and verify the release manifest',
  'Create and push tag',
  'Publish GitHub release',
];

const indentOf = (line) => line.length - line.trimStart().length;
/** The lines that are not comments or blank, without the comment at the end of a line. */
const codeOf = (text) => text.split('\n').filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#')).map((line) => line.replace(/\s+#.*$/, ''));
/** The commands of a script, one to a line: a line that ends with a backslash goes on in the next one. */
const commandsOf = (run) => run.replace(/\\\n\s*/g, ' ').split('\n').map((line) => line.trim()).filter((line) => line !== '');

/** The steps of the one job: { name, if, uses, run, lines }. A step starts at `      - ` and runs to the next one. */
function stepsOf(text) {
  const code = codeOf(text);
  const at = code.findIndex((line) => line === '    steps:');
  if (at < 0) return [];
  const steps = [];
  for (let i = at + 1; i < code.length; i++) {
    if (code[i].startsWith('      - ')) steps.push({ lines: [] });
    if (steps.length === 0 || indentOf(code[i]) < 6) continue;
    steps.at(-1).lines.push(code[i]);
  }
  return steps.map(({ lines }) => {
    const own = (line) => line.replace(/^ {6}- /, '        ');
    const field = (key) => {
      const line = lines.find((l) => own(l).startsWith(`        ${key}: `));
      return line === undefined ? undefined : own(line).slice(`        ${key}: `.length);
    };
    const run = lines.findIndex((l) => own(l).startsWith('        run:'));
    const body = run < 0 ? '' : [own(lines[run]).replace(/^ {8}run:\s*\|?/, ''), ...lines.slice(run + 1).filter((l) => indentOf(l) > 8)].join('\n');
    return { name: field('name'), if: field('if'), uses: field('uses'), run: run < 0 ? undefined : body, lines };
  });
}

/**
 * What a script does that a release that writes nothing to the default branch does not do. A step may read the repository, make the tag and
 * push the tag: `git` is held to a list of subcommands and the two that write to the remote are held to one form each; `gh` may list, delete
 * and edit a release, make the release from the one `args` array, and ask the API for the notes that GitHub generates (a POST that writes
 * nothing); nothing else reaches the API.
 */
function writesOf(run, name) {
  const found = [];
  const of = (message) => found.push(`${message}: ${name}`);
  for (const line of commandsOf(run)) {
    for (const call of line.matchAll(/(?<![\w./-])git\s+((?:-c\s+\S+\s+|-C\s+\S+\s+|--[\w-]+(?:=\S+)?\s+)*)([a-z][\w-]*)([^;|&)\n]*)/g)) {
      const [, , sub, rest] = call;
      if (!['rev-parse', 'rev-list', 'diff', 'status', 'fetch', 'tag', 'push', 'config'].includes(sub)) of(`a step runs git ${sub}, which a release does not`);
      else if (sub === 'push' && `git push${rest}`.trim() !== TAG_PUSH) of(`a step pushes something that is not the tag (${`git push${rest}`.trim()})`);
      else if (sub === 'tag' && `git tag${rest}`.trim() !== TAG_COMMAND) of(`a step makes a tag that is not the tag of the release (${`git tag${rest}`.trim()})`);
      else if (sub === 'config' && !/^ user\.(?:name|email) "[^"]+"$/.test(rest)) of(`a step sets git configuration that is not the name or the e-mail of the tagger (${`git config${rest}`.trim()})`);
    }
    for (const call of line.matchAll(/(?<![\w./-])gh\s+(\w+)(?:\s+(\w+))?/g)) {
      if (call[1] === 'release' && !['list', 'delete', 'edit'].includes(call[2])) of(`a step runs gh release ${call[2]}, which is made by the args array`);
      else if (call[1] !== 'release' && call[1] !== 'api') of(`a step runs gh ${call[1]}, which a release does not`);
    }
    const api = line.indexOf('gh api');
    if (api >= 0 && !new RegExp(`^gh api "${GENERATE_NOTES.replace(/[$.{}]/g, '\\$&')}" `).test(line.slice(api))) of(`an API call that is not the notes that GitHub generates (${line.slice(api)})`);
    if (/(?<![\w./-])(?:curl|wget)\s/.test(line)) of('a step calls the network with something that is not gh, so that no write can be read from it');
    if (/(?<![\w./-])(?:sed|perl)\s+(?:-\S+\s+)*-[a-zA-Z]*i/.test(line)) of('a step edits a file in place');
    for (const program of line.matchAll(/(?<![\w./-])node\s+(?:-\S+\s+)*(\S+)/g)) if (program[1] !== 'tools/build-release-manifest.mjs') of(`a step runs a program that is not one of the release: node ${program[1]}`);
    for (const program of line.matchAll(/(?<![\w./-])bash\s+(\S+)/g)) if (program[1] !== 'tools/ci-compile-smoke.sh') of(`a step runs a program that is not one of the release: bash ${program[1]}`);
    for (const program of line.matchAll(/(?<![\w./-])npm\s+(\S+)/g)) if (program[1] !== 'test') of(`a step runs npm ${program[1]}`);
    for (const target of line.matchAll(/(?<![\d&<>-])>{1,2}(?!&)\s*"?([^\s"&;|)]+)/g)) {
      if (!['RELEASE_NOTES.md', '/dev/null', '$GITHUB_STEP_SUMMARY'].includes(target[1])) of(`a step writes to a file that is not the notes or the summary (${target[1]})`);
    }
  }
  return found;
}

/** What is wrong with the text of the workflow file, by the rules of docs/releases.md. Empty when nothing is. */
function lint(text) {
  const code = codeOf(text);
  const found = [];
  const under = (key, indent, within = code) => {
    const at = within.findIndex((line) => line === `${' '.repeat(indent)}${key}:` || line.startsWith(`${' '.repeat(indent)}${key}: `));
    if (at < 0) return [];
    const block = [];
    for (let i = at + 1; i < within.length && indentOf(within[i]) > indent; i++) block.push(within[i]);
    return block;
  };
  const on = under('on', 0);
  const events = on.filter((line) => indentOf(line) === 2).map((line) => line.trim().split(':')[0]);
  if (JSON.stringify(events) !== JSON.stringify(['workflow_dispatch'])) found.push(`triggers: ${events.join(',') || 'none'}`);
  const inputs = under('inputs', 4, on);
  const input = (name) => under(name, 6, inputs).map((line) => line.trim());
  const type = input('release-type');
  const options = under('options', 8, inputs).map((line) => line.trim());
  if (!type.includes('type: choice') || !type.includes("default: 'prerelease'") || JSON.stringify(options) !== JSON.stringify(['- prerelease', '- premajor', '- patch', '- minor', '- major'])) found.push('the input release-type');
  const dry = input('dry-run');
  if (!dry.includes('type: boolean') || !dry.includes('default: false')) found.push('the input dry-run');
  if (JSON.stringify(under('permissions', 0)) !== JSON.stringify(['  contents: write'])) found.push(`permissions: ${under('permissions', 0).map((line) => line.trim()).join(',') || 'none'}`);
  if (code.some((line) => /^ {4,}permissions:/.test(line))) found.push('permissions of a job');
  if (JSON.stringify(under('concurrency', 0).map((line) => line.trim())) !== JSON.stringify(['group: release', 'cancel-in-progress: false'])) found.push('concurrency');
  const jobs = under('jobs', 0).filter((line) => indentOf(line) === 2).map((line) => line.trim().replace(/:$/, ''));
  if (jobs.length !== 1) found.push(`jobs: ${jobs.length}`);
  if (!code.includes('      DRY_RUN: ${{ inputs.dry-run }}')) found.push('the dry run is not in the environment');
  for (const line of code) {
    const key = line.trim().replace(/^- /, '').split(':')[0];
    if (key === 'continue-on-error') found.push('continue-on-error');
    if (key === 'persist-credentials') found.push('the credentials of the checkout must stay, the release pushes the tag with them');
    // An input that makes an action commit, push or open a pull request.
    if (/^(?:commit|push|auto-commit|create-pull-request|force|force-push)$/.test(key) && /:\s*['"]?true['"]?$/.test(line)) found.push(`an action is told to write to the repository: ${line.trim()}`);
    // The decision: nothing commits, so nothing changes the version or the changelog of the repository.
    for (const name of line.matchAll(/\bpackage(?:-lock)?\.json\b|\bCHANGELOG\.md\b|update-changelog|manifest-version-update|chore: release/g)) found.push(`a step names ${name[0]}, and a release changes neither the version nor the changelog of the repository: ${line.trim()}`);
  }
  for (const line of text.split('\n').filter((l) => /^\s*(- )?uses:/.test(l))) {
    const used = /^\s*(?:- )?uses: ([\w.-]+\/[\w.-]+)@\S+/.exec(line);
    if (used === null || !USED.includes(used[1])) found.push(`an action that is not one of the release: ${line.trim()}`);
  }
  const steps = stepsOf(text);
  const index = (name) => steps.findIndex((step) => step.name === name);
  const named = (name) => steps[index(name)];
  for (const name of ORDER) if (index(name) < 0) found.push(`no step ${name}`);
  const at = ORDER.map(index);
  if (at.every((i) => i >= 0) && at.some((i, k) => k > 0 && i <= at[k - 1])) found.push('the steps are not in the order of the page');
  const between = (name) => index(name) > index('Release preflight checks') && index(name) < index('The files are the files of the commit');
  if (at.every((i) => i >= 0) && !(between('Release notes (AI)') && between('Release notes (GitHub generated)'))) found.push('the notes are not between the preflight and the check of the files');
  const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  if (checkout === undefined) found.push('no checkout');
  else {
    if (!checkout.lines.some((line) => line.trim() === 'fetch-depth: 0')) found.push('checkout without the whole history');
    if (!checkout.lines.some((line) => line.trim() === 'fetch-tags: true')) found.push('checkout without the tags');
  }
  for (const step of steps) {
    if (step.run !== undefined && WRITES.test(step.run) && step.if !== GUARD) found.push(`a step that writes is not guarded by the dry run: ${step.name}`);
    if (step.run !== undefined) found.push(...writesOf(step.run, step.name ?? '(a step without a name)'));
  }
  const must = (name, pattern, message) => {
    const step = named(name);
    if (step !== undefined && !pattern.test(step.run ?? '')) found.push(message);
  };
  const guard = named('Require the default branch for a real release');
  if (guard !== undefined && guard.if !== "env.DRY_RUN != 'true' && github.ref_name != github.event.repository.default_branch") found.push('the default branch is not required for a real release');
  for (const name of ['Unit tests', 'Compute next version', 'Release preflight checks', 'The files are the files of the commit', 'Build and verify the release manifest']) {
    if (named(name)?.if !== undefined) found.push(`a step that must always run has a condition: ${name}`);
  }
  must('The files are the files of the commit', /^\s*if ! git diff --quiet HEAD; then$/m, 'the files are not checked against the commit');
  if (steps.filter((step) => /build-release-manifest\.mjs/.test(step.run ?? '')).length !== 1) found.push('the manifest is not built by one step, which is also the check of the install set');
  must('Unit tests', /^\s*npm test$/, 'the tests are not npm test');
  must('Build and verify the release manifest', /build-release-manifest\.mjs --version "\$\{VERSION\}" --tag "\$\{TAG\}" --commit "\$\(git rev-parse HEAD\)" --out release-manifest\.json/, 'the manifest is not built for the commit that is released');
  must('Build and verify the release manifest', /build-release-manifest\.mjs --verify release-manifest\.json/, 'the manifest is not verified');
  must('Create and push tag', /^\s*current="\$\(git rev-parse HEAD\)"$/m, 'the tag is not of the commit that the run started from');
  must('Create and push tag', /grep -qxF "  \\"commit\\": \\"\$\{current\}\\"," release-manifest\.json/, 'the manifest is not checked for the commit that is tagged');
  must('Create and push tag', /git config user\.name "github-actions\[bot\]"\n\s*git config user\.email "[^"]+"\n(?:.*\n)*?\s*git tag -a/, 'the tagger has no name before the tag is made');
  must('Create and push tag', /^\s*git tag -a "\$\{TAG\}" -m "Release \$\{TAG\}" "\$\{current\}"$/m, 'the tag is not an annotated tag on the commit that is released');
  must('Create and push tag', /^\s*git push origin "refs\/tags\/\$\{TAG\}"$/m, 'the tag is not pushed by its full name');
  must('Create and push tag', /already exists on the current commit; skipping/, 'the tag is not idempotent for the same commit');
  must('Create and push tag', /already exists on a different commit"\n\s*exit 1/, 'a tag on another commit is not refused');
  must('Publish GitHub release', /select\(\.isDraft\)[^\n]*\| grep -xF "\$\{TAG\}" >\/dev\/null; then\n\s*gh release delete "\$\{TAG\}" --yes/, 'a release is deleted without being a draft');
  must('Publish GitHub release', /args=\(release create "\$\{TAG\}" release-manifest\.json --draft --verify-tag --title "Issue Concierge \$\{TAG\}" --notes-file RELEASE_NOTES\.md\)\n(?:.*\n)*?\s*gh "\$\{args\[@\]\}"\n\s*gh release edit "\$\{TAG\}" --draft=false$/, 'the release is not a draft of the existing tag with the manifest, published last');
  const published = steps.flatMap((step, i) => (step.run !== undefined && /--draft=false/.test(step.run) ? [i] : []));
  const lastWrite = steps.map((step) => step.run !== undefined && WRITES.test(step.run)).lastIndexOf(true);
  if (published.length !== 1 || published[0] !== lastWrite) found.push('the release is not published by the last step that writes');
  const artifact = steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
  if (artifact === undefined || artifact.if !== "env.DRY_RUN == 'true'" || !artifact.lines.some((line) => line.trim() === 'release-manifest.json') || !artifact.lines.some((line) => line.trim() === 'RELEASE_NOTES.md')) found.push('the dry run does not upload the manifest and the notes');
  const summary = named('Summary');
  if (summary === undefined || summary.if !== 'always()' || !summary.run.includes('GITHUB_STEP_SUMMARY')) found.push('no summary that always runs');
  const ai = named('Release notes (AI)');
  if (ai !== undefined) {
    if (ai.if !== "env.HAS_LLM_KEY == 'true'") found.push('the AI changelog does not wait for its key');
    if (!ai.lines.some((line) => line.trim() === 'commit: false')) found.push('the AI changelog does not say that it does not commit');
    if (!ai.lines.some((line) => line.trim() === 'changelog-path: release-changelog-work.md')) found.push('the AI changelog does not work on a file of its own');
    if (!ai.lines.some((line) => line.trim() === 'release-notes-path: RELEASE_NOTES.md')) found.push('the AI changelog does not write the notes of the release');
  }
  const plain = named('Release notes (GitHub generated)');
  if (plain !== undefined && (plain.if !== "env.HAS_LLM_KEY != 'true'" || !/--jq \.body > RELEASE_NOTES\.md$/m.test(plain.run))) found.push('the generated notes are not the notes of the release');
  return found;
}

// A damaged copy is made when its test runs, not when the file is loaded: a workflow that has lost the text that a copy damages then fails the tests
// of that copy, and the others, with the text that is missing, and not the whole file with one error.
const damage = (from, to) => () => {
  assert.ok(workflow.includes(from), from);
  return workflow.replace(from, to);
};
/** The text of a step, with the comment lines that stand in front of it, and where it starts and ends in the workflow. */
const spanOf = (name) => {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, name);
  const next = workflow.indexOf('\n      - ', start + 1);
  const comment = workflow.indexOf('\n      #', start + 1);
  const end = [next, comment, workflow.length - 1].filter((i) => i >= 0).reduce((a, b) => Math.min(a, b));
  return { start, end: end + 1 };
};
const withoutStep = (name) => () => {
  const { start, end } = spanOf(name);
  return workflow.slice(0, start) + workflow.slice(end);
};
/** The text with a step taken from where it is and put in front of another one. */
const moved = (name, ahead) => () => {
  const { start, end } = spanOf(name);
  const rest = workflow.slice(0, start) + workflow.slice(end);
  assert.ok(rest.includes(`      - name: ${ahead}\n`), ahead);
  return rest.replace(`      - name: ${ahead}\n`, `${workflow.slice(start, end)}\n      - name: ${ahead}\n`);
};
/** A step put in front of the manifest, after the check of the files. */
const before = (step) => damage('      - name: Build and verify the release manifest\n', `${step}\n      - name: Build and verify the release manifest\n`);
/** The two steps that the workflow had before the decision: the version in package.json, and the commit that was pushed to the default branch. */
const versionStep = '      - name: Update package.json\n        uses: gearsnlevers/manifest-version-update-action@v1\n        with:\n          version: ${{ steps.version.outputs.newVersion }}\n          update-package-lock: false\n';
const commitStep = [
  '      - name: Commit changelog and version',
  "        if: env.DRY_RUN != 'true'",
  '        env:',
  '          TAG: ${{ steps.version.outputs.newTag }}',
  '        run: |',
  '          set -euo pipefail',
  '          git config user.name "github-actions[bot]"',
  '          git config user.email "github-actions[bot]@users.noreply.github.com"',
  '          git add CHANGELOG.md package.json',
  '          git commit -m "chore: release ${TAG}"',
  '          git push origin "HEAD:${GITHUB_REF_NAME}"',
  '',
].join('\n');
/** The script of a step, as it is run. */
const scriptOf = (name) => stepsOf(workflow).find((step) => step.name === name)?.run ?? assert.fail(`no step ${name}`);

test('the workflow file follows every rule of the page', () => {
  assert.deepEqual(lint(workflow), []);
});

test('it is named Release, runs by hand only, and every script is valid bash', () => {
  assert.match(workflow, /^name: Release$/m);
  assert.match(workflow, /^on:\n {2}workflow_dispatch:\n/m);
  for (const step of stepsOf(workflow).filter((one) => one.run !== undefined)) {
    const got = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
    assert.equal(got.status, 0, `${step.name}: ${got.stderr}`);
  }
});

test('the steps that write are exactly the tag and the release, and each is guarded by the dry run', () => {
  const writes = stepsOf(workflow).filter((step) => step.run !== undefined && WRITES.test(step.run));
  assert.deepEqual(writes.map((step) => step.name), ['Create and push tag', 'Publish GitHub release']);
  for (const step of writes) assert.equal(step.if, GUARD, step.name);
});

test('no step commits, and none pushes anything but the tag', () => {
  const calls = stepsOf(workflow).flatMap((step) => commandsOf(step.run ?? '').flatMap((line) => [...line.matchAll(/(?<![\w./-])git\s+([a-z][\w-]*)([^;|&)\n]*)/g)].map((m) => `${m[1]}${m[2]}`.trim())));
  assert.ok(calls.length > 0);
  assert.deepEqual(calls.filter((call) => /^(?:commit|add|merge|rebase|cherry-pick|am|apply|mv|rm|restore|checkout|switch|branch|reset|stash|update-ref|commit-tree|write-tree|revert|pull)\b/.test(call)), []);
  assert.deepEqual(calls.filter((call) => call.startsWith('push')), ['push origin "refs/tags/${TAG}"']);
});

test('the only call to the API is the one that asks GitHub for the notes', () => {
  const calls = stepsOf(workflow).flatMap((step) => commandsOf(step.run ?? '').filter((line) => line.includes('gh api')).map((line) => line.slice(line.indexOf('gh api'))));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^gh api "repos\/\$\{GITHUB_REPOSITORY\}\/releases\/generate-notes" /);
  assert.doesNotMatch(workflow, /\/contents\/|\/git\/(?:refs|commits|trees|blobs|tags)|\/merges|\/branches|\/pulls/);
});

test('the steps that wrote the commit are gone, and so is the tool that wrote the changelog', () => {
  const names = stepsOf(workflow).map((step) => step.name);
  assert.ok(!names.includes('Update package.json') && !names.includes('Commit changelog and version'));
  assert.doesNotMatch(codeOf(workflow).join('\n'), /package(?:-lock)?\.json|CHANGELOG\.md|update-changelog|manifest-version-update|chore: release|npm version|npm pkg/);
  for (const gone of ['tools/update-changelog.mjs', 'tools/update-changelog.test.mjs']) assert.equal(fs.existsSync(path.join(ROOT, gone)), false, gone);
});

test('the files are checked after the notes and before the manifest, the manifest is made before the tag, and the release is made after it', () => {
  const steps = stepsOf(workflow);
  const at = (name) => steps.findIndex((step) => step.name === name);
  assert.ok(at('Release notes (AI)') < at('The files are the files of the commit'));
  assert.ok(at('Release notes (GitHub generated)') < at('The files are the files of the commit'));
  assert.ok(at('The files are the files of the commit') < at('Build and verify the release manifest'));
  assert.ok(at('Build and verify the release manifest') < at('Create and push tag'));
  assert.ok(at('Create and push tag') < at('Publish GitHub release'));
});

test('the release is a draft of the tag that exists, made from the manifest, and published by the last write', () => {
  const script = scriptOf('Publish GitHub release');
  assert.ok(script.indexOf('args=(release create') < script.indexOf('gh "${args[@]}"'));
  assert.ok(script.indexOf('gh "${args[@]}"') < script.indexOf('gh release edit "${TAG}" --draft=false'));
  assert.equal(script.match(/--draft(?!=)/g).length, 1, 'one draft, made by the args array');
  assert.match(script, /--draft --verify-tag/, 'a release never makes the tag: --verify-tag refuses a tag that is not there');
});

test('the page, the changelog and the version of the repository say the same as the workflow', () => {
  const page = read('docs/releases.md');
  assert.match(page, /\*\*It writes nothing to the default branch\.\*\*/);
  assert.doesNotMatch(page, /Commit `CHANGELOG\.md`|manifest-version-update-action|update-changelog|changelog commit|can bypass it/);
  for (const [file, text] of [['AGENTS.md', read('AGENTS.md')], ['change-a-gate-workflow', read('.claude/skills/change-a-gate-workflow/SKILL.md')]]) {
    assert.doesNotMatch(text, /release workflow writes (?:both|it)/, file);
  }
  const changelog = read('CHANGELOG.md');
  assert.match(changelog, /^# Changelog\n\nFrom the release after v2\.4\.0 on, the changelog is the notes of the releases: https:\/\/github\.com\/gearsnlevers\/issue-concierge\/releases\./);
  assert.equal(changelog.match(/^## /m)?.[0] && changelog.match(/^## .*/m)[0], '## [v2.4.0] - 2026-11-24', 'no release writes a section to CHANGELOG.md: the newest section is the last one a release wrote');
  assert.equal(JSON.parse(read('package.json')).version, '2.4.0', 'no release changes the version in package.json: it is the version of the last release that wrote it');
});

const cases = [
  ['a trigger on push', damage('\non:\n  workflow_dispatch:', '\non:\n  push:\n    branches: [main]\n  workflow_dispatch:'), /triggers: /],
  ['a schedule', damage('\non:\n  workflow_dispatch:', '\non:\n  schedule:\n    - cron: "0 0 * * 0"\n  workflow_dispatch:'), /triggers: /],
  ['a release type that is not one', damage('          - premajor\n', ''), /release-type/],
  ['a dry run that is on by default', damage('        default: false', '        default: true'), /dry-run/],
  ['no permissions', damage('permissions:\n  contents: write\n\n', ''), /permissions: none/],
  ['more permissions', damage('  contents: write\n', '  contents: write\n  pull-requests: write\n'), /permissions: /],
  ['read permission only', damage('  contents: write', '  contents: read'), /permissions: /],
  ['permissions of the job', damage('    timeout-minutes: 20\n', '    timeout-minutes: 20\n    permissions:\n      contents: write\n'), /permissions of a job/],
  ['a release that is cancelled', damage('cancel-in-progress: false', 'cancel-in-progress: true'), /concurrency/],
  ['no concurrency', damage('concurrency:\n  group: release\n  cancel-in-progress: false\n', ''), /concurrency/],
  ['a second job', `${workflow}  other:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`, /jobs: 2/],
  ['no dry run in the environment', damage('      DRY_RUN: ${{ inputs.dry-run }}\n', ''), /dry run is not in the environment/],
  ['continue-on-error', damage('    runs-on:', '    continue-on-error: true\n    runs-on:'), /continue-on-error/],
  ['a checkout that drops the credentials', damage('          fetch-tags: true\n', '          fetch-tags: true\n          persist-credentials: false\n'), /credentials/],
  ['a shallow checkout', damage('          fetch-depth: 0\n', ''), /whole history/],
  ['a real release from any branch', damage("if: env.DRY_RUN != 'true' && github.ref_name != github.event.repository.default_branch", "if: github.ref_name != github.event.repository.default_branch"), /default branch is not required/],
  ['no default branch required', withoutStep('Require the default branch for a real release'), /no step Require the default branch/],
  ['tests that are skipped in a dry run', damage('      - name: Unit tests\n', "      - name: Unit tests\n        if: env.DRY_RUN != 'true'\n"), /must always run has a condition: Unit tests/],
  ['a version that is skipped in a dry run', damage('      - name: Compute next version\n', "      - name: Compute next version\n        if: env.DRY_RUN != 'true'\n"), /must always run has a condition: Compute/],
  ['no preflight', withoutStep('Release preflight checks'), /no step Release preflight/],

  // The files of the commit are the files of the release.
  ['no check that the files are the files of the commit', withoutStep('The files are the files of the commit'), /no step The files are the files of the commit/],
  ['a check of the files that is skipped in a dry run', damage('      - name: The files are the files of the commit\n', "      - name: The files are the files of the commit\n        if: env.DRY_RUN != 'true'\n"), /must always run has a condition: The files/],
  ['a check of the files that checks nothing', damage('if ! git diff --quiet HEAD; then', 'if false; then'), /files are not checked against the commit/],
  ['a check of the files after the manifest', moved('The files are the files of the commit', 'Create and push tag'), /order of the page/],
  ['notes after the check of the files', moved('Release notes (AI)', 'Build and verify the release manifest'), /notes are not between/],
  ['notes before the preflight', moved('Release notes (GitHub generated)', 'Release preflight checks'), /notes are not between/],

  // The manifest names the commit that is tagged.
  ['no step that builds the manifest', withoutStep('Build and verify the release manifest'), /no step Build and verify the release manifest/],
  ['a manifest that is skipped in a dry run', damage('      - name: Build and verify the release manifest\n', "      - name: Build and verify the release manifest\n        if: env.DRY_RUN != 'true'\n"), /must always run has a condition: Build and verify/],
  ['a manifest built for another commit', damage('--commit "$(git rev-parse HEAD)" --out release-manifest.json', '--commit "${GITHUB_SHA}" --out release-manifest.json'), /not built for the commit/],
  ['a manifest that is not verified', damage('node tools/build-release-manifest.mjs --verify release-manifest.json', 'true'), /manifest is not verified/],
  ['a second step that builds the manifest', before('      - name: Build it again\n        run: node tools/build-release-manifest.mjs --version 1.2.3 --out "${RUNNER_TEMP}/again.json"\n'), /not built by one step/],

  // The tag is the only thing pushed, and it is on the commit that the run started from.
  ['the tag before the manifest', moved('Create and push tag', 'Build and verify the release manifest'), /order of the page/],
  ['a tag that is not guarded', damage("      - name: Create and push tag\n        if: env.DRY_RUN != 'true'\n", '      - name: Create and push tag\n'), /not guarded by the dry run: Create and push tag/],
  ['a tag that is guarded by the other value', damage("      - name: Create and push tag\n        if: env.DRY_RUN != 'true'\n", "      - name: Create and push tag\n        if: env.DRY_RUN == 'true'\n"), /not guarded by the dry run: Create and push tag/],
  ['a tag that is not annotated', damage('git tag -a "${TAG}" -m "Release ${TAG}" "${current}"', 'git tag "${TAG}" "${current}"'), [/not an annotated tag/, /not the tag of the release/]],
  ['a tag on the commit that is checked out, not named', damage('git tag -a "${TAG}" -m "Release ${TAG}" "${current}"', 'git tag -a "${TAG}" -m "Release ${TAG}"'), [/not an annotated tag/, /not the tag of the release/]],
  ['a tag on the commit of the event', damage('git tag -a "${TAG}" -m "Release ${TAG}" "${current}"', 'git tag -a "${TAG}" -m "Release ${TAG}" "${GITHUB_SHA}"'), [/not an annotated tag/, /not the tag of the release/]],
  ['a tag on the default branch, not on the commit', damage('git tag -a "${TAG}" -m "Release ${TAG}" "${current}"', 'git tag -a "${TAG}" -m "Release ${TAG}" origin/main'), [/not an annotated tag/, /not the tag of the release/]],
  ['a tag of a commit that is not the one that the run started from', damage('current="$(git rev-parse HEAD)"\n', 'current="$(git rev-parse origin/main)"\n'), /not of the commit that the run started from/],
  ['a tag that does not check the manifest', damage('if ! grep -qxF', 'if ! true'), /manifest is not checked for the commit that is tagged/],
  ['a tag with no name for the tagger', damage('          git config user.name "github-actions[bot]"\n          git config user.email "github-actions[bot]@users.noreply.github.com"\n          git fetch --tags', '          git fetch --tags'), /tagger has no name/],
  ['a tag with a configuration that is not the tagger', damage('          git fetch --tags\n', '          git config push.default current\n          git fetch --tags\n'), /not the name or the e-mail of the tagger/],
  ['a tag that moves', damage('echo "::error::Tag ${TAG} already exists on a different commit"\n            exit 1', 'echo "::error::Tag ${TAG} already exists on a different commit"'), /another commit is not refused/],
  ['a tag that is not idempotent', damage('already exists on the current commit; skipping', 'already exists'), /not idempotent/],
  ['a push of the branch in place of the tag', damage(TAG_PUSH, 'git push origin "HEAD:${GITHUB_REF_NAME}"'), [/pushes something that is not the tag/, /not pushed by its full name/]],
  ['a push of the tag and the branch', damage(TAG_PUSH, `${TAG_PUSH} "HEAD:main"`), /pushes something that is not the tag/],
  ['a force push of the tag', damage(TAG_PUSH, 'git push --force origin "refs/tags/${TAG}"'), /pushes something that is not the tag/],
  ['a push of everything', damage(TAG_PUSH, 'git push origin --all'), /pushes something that is not the tag/],
  ['a push of the tag by its short name, which may be a branch', damage(TAG_PUSH, 'git push origin "${TAG}"'), [/pushes something that is not the tag/, /not pushed by its full name/]],
  ['a push by a second line', damage('          git fetch --tags\n', '          git push origin HEAD:main\n          git fetch --tags\n'), /pushes something that is not the tag/],

  // Nothing commits, whatever the way.
  ['the commit of the changelog and the version put back', before(commitStep), [/runs git add/, /runs git commit/, /pushes something that is not the tag/, /names package\.json/, /names CHANGELOG\.md/, /names chore: release/]],
  ['the same commit with no guard of the dry run', before(commitStep.replace("        if: env.DRY_RUN != 'true'\n", '')), [/not guarded by the dry run: Commit/, /runs git commit/]],
  ['the step that updates package.json put back', before(versionStep), [/not one of the release/, /names package\.json/, /names manifest-version-update/]],
  ['a commit with no changes in the tag step', damage('          git fetch --tags\n', '          git commit --allow-empty -m "release"\n          git fetch --tags\n'), /runs git commit/],
  ['a commit that is made by another form of the command', damage('          git fetch --tags\n', '          git -c user.name=x -c user.email=y commit -m "release"\n          git fetch --tags\n'), /runs git commit/],
  ['a merge', damage('          git fetch --tags\n', '          git merge origin/main\n          git fetch --tags\n'), /runs git merge/],
  ['a file that is staged', damage('          git fetch --tags\n', '          git add -A\n          git fetch --tags\n'), /runs git add/],
  ['a reference that is updated by hand', damage('          git fetch --tags\n', '          git update-ref refs/heads/main HEAD\n          git fetch --tags\n'), /runs git update-ref/],
  ['a file that is created through the contents API', before('      - name: Put the changelog\n        if: env.DRY_RUN != \'true\'\n        run: gh api -X PUT "repos/${GITHUB_REPOSITORY}/contents/CHANGELOG.md" -f message=release -f content=eA==\n'), [/not the notes that GitHub generates/, /names CHANGELOG\.md/]],
  ['a reference that is created through the API', before('      - name: Make a reference\n        run: gh api "repos/${GITHUB_REPOSITORY}/git/refs" -f ref=refs/heads/release -f sha=0000000000000000000000000000000000000000\n'), /not the notes that GitHub generates/],
  ['a pull request', before('      - name: Open a pull request\n        run: gh pr create --fill\n'), /runs gh pr/],
  ['a write by curl', before('      - name: Write\n        run: curl -X PUT -H "Authorization: Bearer ${GH_TOKEN}" "https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/x"\n'), /not gh/],
  ['an action that commits for the workflow', before('      - uses: stefanzweifel/git-auto-commit-action@' + 'b'.repeat(40) + ' # v5.0.0\n'), /not one of the release/],
  ['an action that opens a pull request', before('      - uses: peter-evans/create-pull-request@' + 'c'.repeat(40) + ' # v7.0.0\n'), /not one of the release/],
  ['npm version', before('      - name: Version\n        run: npm version "${VERSION}" --no-git-tag-version\n'), /runs npm version/],
  ['a version written by sed', before('      - name: Version\n        run: sed -i "s/2.4.0/2.5.0/" package.json\n'), [/edits a file in place/, /names package\.json/]],
  ['a file written by a redirect', before('      - name: Write a file\n        run: echo "x" > aw.yml\n'), /writes to a file that is not the notes/],
  ['a file appended by a redirect', before('      - name: Write a file\n        run: echo "x" >> docs/releases.md\n'), /writes to a file that is not the notes/],
  ['the tool that wrote the changelog put back', damage("          if ! grep -q '[^[:space:]]' RELEASE_NOTES.md;", '          node tools/update-changelog.mjs --tag "${TAG}" --notes RELEASE_NOTES.md\n          if ! grep -q \'[^[:space:]]\' RELEASE_NOTES.md;'), [/not one of the release: node tools\/update-changelog/, /names update-changelog/]],
  ['the dry run that uploads the changelog', damage('            RELEASE_NOTES.md\n', '            RELEASE_NOTES.md\n            CHANGELOG.md\n'), /names CHANGELOG\.md/],

  // The notes are the changelog, and nothing is committed.
  ['an AI changelog that commits', damage('          commit: false\n', '          commit: true\n'), [/told to write to the repository/, /does not say that it does not commit/]],
  ['an AI changelog that is not told whether it commits', damage('          commit: false\n', ''), /does not say that it does not commit/],
  ['an AI changelog on the changelog of the repository', damage('          changelog-path: release-changelog-work.md\n', ''), /does not work on a file of its own/],
  ['an AI changelog on CHANGELOG.md by name', damage('changelog-path: release-changelog-work.md', 'changelog-path: CHANGELOG.md'), [/names CHANGELOG\.md/, /does not work on a file of its own/]],
  ['an AI changelog that does not write the notes of the release', damage('          release-notes-path: RELEASE_NOTES.md\n', ''), /does not write the notes of the release/],
  ['an AI changelog without its key', damage("        if: env.HAS_LLM_KEY == 'true'\n", ''), /AI changelog does not wait/],
  ['generated notes that are not the notes', damage('--jq .body > RELEASE_NOTES.md', '--jq .body > notes.md'), [/not the notes of the release/, /not the notes or the summary/]],
  ['a dry run that uploads nothing', damage("        if: env.DRY_RUN == 'true'\n        uses: actions/upload-artifact", "        if: env.DRY_RUN != 'true'\n        uses: actions/upload-artifact"), /dry run does not upload/],
  ['a dry run that loses the notes', damage('            RELEASE_NOTES.md\n', ''), /dry run does not upload/],

  // The release is a draft, made after the tag, and published last.
  ['a release that is not guarded', damage("      - name: Publish GitHub release\n        if: env.DRY_RUN != 'true'\n", '      - name: Publish GitHub release\n'), /not guarded by the dry run: Publish GitHub release/],
  ['a release that is not a draft', damage(' --draft --verify-tag', ' --verify-tag'), /not a draft of the existing tag/],
  ['a release that may make the tag', damage(' --draft --verify-tag', ' --draft'), /not a draft of the existing tag/],
  ['a release without the manifest', damage('"${TAG}" release-manifest.json --draft', '"${TAG}" --draft'), /not a draft of the existing tag/],
  ['a release that is made by a command of its own', damage('          gh "${args[@]}"\n', '          gh release create "${TAG}" --notes-file RELEASE_NOTES.md\n'), [/made by the args array/, /not a draft of the existing tag/]],
  ['a release that is published before it is made', damage('          gh "${args[@]}"\n          gh release edit "${TAG}" --draft=false', '          gh release edit "${TAG}" --draft=false\n          gh "${args[@]}"'), /not a draft of the existing tag/],
  ['a release that is deleted without being a draft', damage('if gh release list --json tagName,isDraft --jq \'.[] | select(.isDraft) | .tagName\' | grep -xF "${TAG}" >/dev/null; then', 'if true; then'), /deleted without being a draft/],
  ['a write after the publication', damage('      - name: Upload dry-run artifacts\n', '      - name: Tag again\n        if: env.DRY_RUN != \'true\'\n        run: git push origin "refs/tags/${TAG}"\n\n      - name: Upload dry-run artifacts\n'), /not published by the last step that writes/],
  ['no summary', withoutStep('Summary'), /no summary/],
  ['a summary that waits for success', damage('      - name: Summary\n        if: always()', '      - name: Summary'), /no summary/],
];

for (const [name, make, expected] of cases) {
  test(`the rules find ${name}`, () => {
    const found = lint(typeof make === 'function' ? make() : make);
    assert.ok(found.length > 0, 'nothing found');
    for (const pattern of [expected].flat()) assert.ok(found.some((message) => pattern.test(message)), `${pattern}: ${found.join(' | ')}`);
  });
}

test('a comment does not count as a line of the file', () => {
  assert.deepEqual(lint(`# if: x\n# push:\n${workflow}`), []);
  assert.deepEqual(lint(workflow.replace('    runs-on:', '    # continue-on-error: true\n    runs-on:')), []);
  assert.deepEqual(lint(workflow.replace('    runs-on:', '    # git commit -m x; package.json; CHANGELOG.md\n    runs-on:')), []);
});

// The two steps that the decision changed, run in a repository of their own: a bare origin, and no identity for git at all, so that what the
// tag step needs is what it sets. The builder of the manifest makes the manifest, so that the line the tag step looks for is the one it writes.
const git = (cwd, env, ...args) => {
  const got = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  assert.equal(got.status, 0, `git ${args.join(' ')}: ${got.stderr}`);
  return got.stdout.trim();
};

function world() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'concierge-release-'));
  const home = path.join(base, 'home');
  fs.mkdirSync(home);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(home, 'none'),
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'user.useConfigOnly',
    GIT_CONFIG_VALUE_0: 'true',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
  };
  const origin = path.join(base, 'origin.git');
  const work = path.join(base, 'work');
  fs.mkdirSync(work);
  git(base, env, 'init', '-q', '--bare', origin);
  git(work, env, 'init', '-q', '-b', 'main');
  git(work, env, 'remote', 'add', 'origin', origin);
  const commit = (file, text) => {
    fs.writeFileSync(path.join(work, file), text);
    git(work, env, 'add', file);
    git(work, env, '-c', 'user.name=someone', '-c', 'user.email=someone@example.com', 'commit', '-q', '-m', `change ${file}`);
    return git(work, env, 'rev-parse', 'HEAD');
  };
  const manifestFor = (sha) => {
    const built = spawnSync(process.execPath, [path.join(ROOT, 'tools/build-release-manifest.mjs'), '--version', '1.0.0', '--tag', 'v1.0.0', '--commit', sha, '--out', path.join(work, 'release-manifest.json'), '--root', ROOT], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
  };
  const first = commit('a.txt', 'one\n');
  git(work, env, 'push', '-q', 'origin', 'main');
  const run = (name) => spawnSync('bash', ['-e', '-c', scriptOf(name)], { cwd: work, env: { ...env, TAG: 'v1.0.0' }, encoding: 'utf8' });
  return { base, work, first, commit, manifestFor, run, git: (...args) => git(work, env, ...args), remote: (...args) => git(origin, env, ...args) };
}

test('run for real: the tag is annotated, is on the commit of the manifest, is made by the bot, and is the only thing pushed', () => {
  const w = world();
  try {
    w.manifestFor(w.first);
    const before = w.remote('for-each-ref', '--format=%(refname) %(objectname)');
    const got = w.run('Create and push tag');
    assert.equal(got.status, 0, got.stderr + got.stdout);
    assert.equal(w.remote('cat-file', '-t', 'refs/tags/v1.0.0'), 'tag');
    assert.equal(w.remote('rev-parse', 'refs/tags/v1.0.0^{commit}'), w.first);
    assert.equal(w.remote('for-each-ref', '--format=%(taggername)', 'refs/tags/v1.0.0'), 'github-actions[bot]');
    assert.match(w.remote('for-each-ref', '--format=%(contents:subject)', 'refs/tags/v1.0.0'), /^Release v1\.0\.0$/);
    const after = w.remote('for-each-ref', '--format=%(refname) %(objectname)').split('\n').filter((line) => !line.startsWith('refs/tags/v1.0.0 '));
    assert.deepEqual(after, before.split('\n'), 'no branch moved, and no other reference was made');
    assert.equal(w.remote('rev-list', '--all', '--count'), '1', 'no commit was made');
  } finally {
    fs.rmSync(w.base, { recursive: true, force: true });
  }
});

test('run for real: a run again for the same commit leaves the tag alone, and a tag on another commit stops the run', () => {
  const w = world();
  try {
    w.manifestFor(w.first);
    assert.equal(w.run('Create and push tag').status, 0);
    const again = w.run('Create and push tag');
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already exists on the current commit; skipping/);
    const second = w.commit('b.txt', 'two\n');
    w.manifestFor(second);
    const other = w.run('Create and push tag');
    assert.equal(other.status, 1);
    assert.match(other.stdout, /already exists on a different commit/);
    assert.equal(w.remote('rev-parse', 'refs/tags/v1.0.0^{commit}'), w.first, 'the tag did not move');
  } finally {
    fs.rmSync(w.base, { recursive: true, force: true });
  }
});

test('run for real: a manifest of another commit stops the run before anything is made', () => {
  const w = world();
  try {
    w.manifestFor('a'.repeat(40));
    const got = w.run('Create and push tag');
    assert.equal(got.status, 1);
    assert.match(got.stdout, /The manifest does not name the commit that is to be tagged/);
    assert.equal(w.remote('for-each-ref', 'refs/tags'), '');
    assert.equal(w.git('tag', '--list'), '');
  } finally {
    fs.rmSync(w.base, { recursive: true, force: true });
  }
});

test('run for real: the check of the files passes on a clean tree and on files that are not tracked, and stops on a tracked file that a step changed', () => {
  const w = world();
  try {
    assert.equal(w.run('The files are the files of the commit').status, 0);
    fs.writeFileSync(path.join(w.work, 'RELEASE_NOTES.md'), 'notes\n');
    fs.writeFileSync(path.join(w.work, 'release-changelog-work.md'), 'work\n');
    assert.equal(w.run('The files are the files of the commit').status, 0, 'files that are not tracked are not the commit');
    fs.writeFileSync(path.join(w.work, 'a.txt'), 'changed by a step\n');
    const got = w.run('The files are the files of the commit');
    assert.equal(got.status, 1);
    assert.match(got.stdout, /a\.txt/);
    assert.match(got.stdout, /::error::A step has changed a file of the commit that is released/);
    w.git('checkout', '-q', '--', 'a.txt');
    fs.appendFileSync(path.join(w.work, 'a.txt'), 'staged\n');
    w.git('add', 'a.txt');
    assert.equal(w.run('The files are the files of the commit').status, 1, 'a staged change is not the commit either');
  } finally {
    fs.rmSync(w.base, { recursive: true, force: true });
  }
});
