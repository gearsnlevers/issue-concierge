import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { plainComment, resolutionComment } from '../scripts/resolution.mjs';

// Waiting for Release is a plain workflow with a script, not a gh-aw definition and not a model run (record 0029).
// Two incidents shaped it. On frodo-cli#923 (2026-10-24) a maintainer closed an issue by hand as already fixed and the model
// gate started, made twelve calls about nothing and was cut off by the engine's rate limit; the gate had to
// spend a pre-activation step on stopping itself. And on every issue a pull request closed, the model wrote one fixed
// sentence, because its prompt forbade it to read the pull request, where the explanation for the reporter was.
// What the script decides is pinned in scripts/resolution.test.mjs; this pins the workflow around it: when it
// starts, what it may do with the workflow's own token, and that everything it imports is installed with it.

const REPO = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, REPO), 'utf8');
const exists = (p) => fs.existsSync(new URL(p, REPO));
const workflow = read('workflows/waiting-for-release.yml');
const manifest = read('aw.yml');
const flat = (s) => s.replace(/\s+/g, ' ');

test('it is a plain workflow: no gh-aw definition, no engine, no model', () => {
  assert.equal(exists('workflows/waiting-for-release.md'), false, 'the model-based gate is gone');
  assert.doesNotMatch(workflow, /^engine:|^safe-outputs:|^tools:|max-ai-credits|copilot|pre_activation/m);
  assert.match(workflow, /^# Waiting for Release\. Plain GitHub Actions, no LLM\./);
});

test('it starts on a closed issue, or by hand for one issue with an optional dry run', () => {
  assert.match(workflow, /^on:\n {2}issues:\n {4}types: \[closed\]\n {2}workflow_dispatch:\n {4}inputs:\n {6}issue_number:\n(?: {8}.*\n)*? {8}required: true\n/m);
  assert.match(workflow, / {6}dry_run:\n(?: {8}.*\n)*? {8}type: boolean\n {8}default: false\n/);
  assert.match(workflow, /^name: "Issue Concierge 4c ▸ Waiting for Release"$/m, 'the marker is on the workflows that can be run by hand, and the code keeps its place');
});

test('the workflow token may write labels and comments, read pull requests and releases, and nothing more', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read\n {2}issues: write\n {2}pull-requests: read\n\n/m);
  assert.deepEqual([...workflow.matchAll(/^ {2}([a-z-]+): write$/gm)].map((m) => m[1]), ['issues'], 'only issues are written');
  assert.doesNotMatch(workflow, /secrets\./, 'it needs no secret: nothing it writes starts another workflow');
});

test('an issue a bot opened and an issue that opts out start nothing; a manual run always starts', () => {
  const condition = workflow.match(/^ {4}if: (.*)$/m)?.[1] ?? '';
  assert.match(condition, /github\.event_name == 'workflow_dispatch'/);
  assert.match(condition, /github\.event\.issue\.user\.type != 'Bot'/);
  assert.match(condition, /!contains\(github\.event\.issue\.labels\.\*\.name, 'no-auto-processing'\)/);
});

test('one run per issue at a time, and a run is never cancelled half way through its writes', () => {
  assert.match(workflow, /^concurrency:\n {2}group: waiting-for-release-\$\{\{ github\.event\.issue\.number \|\| inputs\.issue_number \}\}\n {2}cancel-in-progress: false$/m);
});

test('it runs the installed script, and a dry run is passed on', () => {
  assert.match(workflow, /run: node \.github\/scripts\/resolution\.mjs \$\(\[ "\$DRY_RUN" = "true" \] && echo --dry-run\)/);
  assert.match(workflow, /DRY_RUN: \$\{\{ inputs\.dry_run \}\}/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
});

test('the checkout is pinned like the other plain workflows', () => {
  const pinned = (file) => read(file).match(/uses: (actions\/checkout@[0-9a-f]{40}) # v[\d.]+/)?.[1];
  assert.ok(pinned('workflows/waiting-for-release.yml'));
  assert.equal(pinned('workflows/waiting-for-release.yml'), pinned('workflows/related-repo-closer.yml'));
});

test('the workflow, its script and everything the script imports are installed together', () => {
  const script = read('scripts/resolution.mjs');
  for (const f of ['workflows/waiting-for-release.yml', 'scripts/resolution.mjs']) {
    assert.match(manifest, new RegExp(`^  - ${f.replace(/[.]/g, '\\.')}$`, 'm'), `${f} is not in aw.yml`);
  }
  assert.doesNotMatch(manifest, /waiting-for-release\.md/);
  for (const [, dep] of script.matchAll(/from '\.\/([\w-]+\.mjs)'/g)) {
    assert.match(manifest, new RegExp(`^  - scripts/${dep.replace(/[.]/g, '\\.')}$`, 'm'), `${dep} is imported by the script but not installed`);
  }
  assert.match(flat(workflow.replace(/^#\s?/gm, '')), /scripts\/resolution\.mjs to \.github\/scripts\/resolution\.mjs \(it imports opt-out\.mjs: install that too\)/);
  // the related-repo closer imports it as well, and says so
  assert.match(read('scripts/related-repo-closer.mjs'), /from '\.\/resolution\.mjs'/);
});

test('the script never decides by a model: no network call but the GitHub API, no process but gh', () => {
  for (const file of ['scripts/resolution.mjs', 'scripts/related-repo-closer.mjs']) {
    const script = read(file);
    assert.doesNotMatch(script, /\bfetch\(|https?:\/\/(?!github\.com\/gearsnlevers\/issue-concierge)|copilot|openai|anthropic/i, file);
    assert.deepEqual([...new Set([...script.matchAll(/execFileSync\('([^']+)'/g)].map((m) => m[1]))], ['gh'], file);
  }
});

test('the release closer reads the line this workflow writes, and only when the harness wrote it', () => {
  const closer = read('workflows/release-closer.md');
  const regex = new RegExp(closer.match(/\.match\(\/(\^Fixed in #\(\\d\+\)\\\.)\/m\)/)[1], 'm');
  const pull = { number: 45, repo: 'o/r', url: 'u' };
  for (const body of [
    resolutionComment(pull, { text: 'It works now.', cut: false }, 'o/r', ''),
    resolutionComment(pull, { text: 'It works now.', cut: true }, 'o/r', 'v1.0.0'),
    `${plainComment(pull, 'o/r', '')}\n\n<!-- concierge:resolution #45 -->`,
  ]) {
    assert.equal(regex.exec(body)?.[1], '45', body);
  }
  assert.match(closer, /comment\.user\?\.login !== 'github-actions\[bot\]'/);
});

test('no gh-aw gate of the pipeline is named Waiting for Release any more, and the docs say who writes the comment', () => {
  const design = read('docs/multi-phase-design.md');
  assert.match(design, /`Issue Concierge 4c ▸ Waiting for Release`/);
  assert.doesNotMatch(design, /`Issue Concierge 4c Waiting for Release`/);
  assert.match(design, /## The resolution/);
});
