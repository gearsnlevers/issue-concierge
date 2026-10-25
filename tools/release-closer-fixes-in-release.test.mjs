import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// frodo-lib#762 was fixed in #775 and #775 is part of v5.0.0-13, but the Release closer left the issue on
// `waiting-for-release`: it decided from the release notes, and the notes name only the changes they describe
// (#775 guards a policy with a test, so it has no entry). What a release contains is a question for git. The
// `included_fixes` step of the closer runs in the pre-activation job, with no model, and moves every issue whose
// `Fixed in #N.` comment (written by the Waiting for Release gate) names a pull request whose merge commit is an
// ancestor of the tag (docs/multi-phase-design.md, "Which fixes a release contains"; record 0024).
// The prompt is the second layer: it only checks what is left, by the notes.

const REPO = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, REPO), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const md = read('workflows/release-closer.md');
const frontmatter = md.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
const body = md.slice(md.indexOf('\n---\n', 4) + 5);

// ---- The workflow ------------------------------------------------------------------------------------------

test('the step is deterministic, never blocks the agent and has the permissions it needs, nothing more', () => {
  assert.match(frontmatter, /id: included_fixes\n\s+continue-on-error: true\n\s+uses: actions\/github-script@v9\n/);
  assert.match(frontmatter, /^ {2}permissions:\n {4}issues: write\n {4}pull-requests: read\n {4}contents: read\n/m);
  assert.doesNotMatch(frontmatter, /^ {4}(pull-requests|contents): write/m);
});

test('the closer still runs for published releases and prereleases', () => {
  assert.match(frontmatter, /release:\n\s+types: \[published, prereleased\]/);
});

test('the step never fails the job: it only warns', () => {
  assert.doesNotMatch(step, /setFailed/);
});

test('the prompt tells the agent that the pull-request-based moves were already made', () => {
  const s = flat(body.slice(body.indexOf('## This repository owns the fix')));
  assert.match(s, /A step before this run has already moved the issues whose fix pull request is part of this release/);
  assert.match(s, /Find the issues that still have `waiting-for-release`/);
});

// ---- The step, run against stubbed GitHub objects ----------------------------------------------------------

const scriptOf = (fm) => {
  const lines = fm.split('\n');
  const at = lines.findIndex((l) => /^ {8}script: \|$/.test(l));
  assert.ok(at >= 0, 'script block of the included_fixes step not found');
  const out = [];
  for (const l of lines.slice(at + 1)) {
    if (l !== '' && !l.startsWith(' '.repeat(10))) break;
    out.push(l.slice(10));
  }
  return out.join('\n');
};
const step = scriptOf(frontmatter);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const closer = new AsyncFunction('github', 'context', 'core', step);

const bot = (body) => ({ user: { login: 'github-actions[bot]', type: 'Bot' }, body });
const person = (body) => ({ user: { login: 'someone', type: 'User' }, body });
const WAIT = 'Fixed in #775. Waiting for a release that includes this.';

async function run({ tag = 'v5.0.0-13', issues = [], comments = {}, pulls = {}, compare = {}, listError, failPull, removeError } = {}) {
  const calls = [];
  const seen = { warnings: [], infos: [], failed: [] };
  const core = { warning: (m) => seen.warnings.push(m), info: (m) => seen.infos.push(m), setFailed: (m) => seen.failed.push(m) };
  const listForRepo = () => {};
  const listComments = () => {};
  const github = {
    paginate: async (fn, params) => {
      if (fn === listForRepo) {
        calls.push(['list', params.labels, params.state]);
        if (listError) throw listError;
        return issues;
      }
      if (fn === listComments) return comments[params.issue_number] ?? [];
      throw new Error('unexpected paginate');
    },
    rest: {
      issues: {
        listForRepo,
        listComments,
        addLabels: async (p) => calls.push(['add', p.issue_number, p.labels]),
        removeLabel: async (p) => {
          calls.push(['remove', p.issue_number, p.name]);
          if (removeError) throw removeError;
        },
        createComment: async (p) => calls.push(['comment', p.issue_number, p.body]),
      },
      pulls: {
        get: async (p) => {
          if (failPull === p.pull_number) throw Object.assign(new Error('boom'), { status: 500 });
          if (!pulls[p.pull_number]) throw Object.assign(new Error('Not Found'), { status: 404 });
          return { data: pulls[p.pull_number] };
        },
      },
      repos: {
        compareCommitsWithBasehead: async (p) => {
          calls.push(['compare', p.basehead]);
          if (!(p.basehead in compare)) throw Object.assign(new Error('Not Found'), { status: 404 });
          return { data: { status: compare[p.basehead] } };
        },
      },
    },
  };
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { release: { tag_name: tag } } };
  await closer(github, context, core);
  return { calls: calls.filter((c) => c[0] !== 'compare' && c[0] !== 'list'), all: calls, ...seen };
}

const waiting = (number, extra = []) => ({ number, state: 'closed', labels: [{ name: 'waiting-for-release' }, ...extra.map((name) => ({ name }))] });

test('a fix that is part of the release: released added, waiting removed, one comment, in that order', async () => {
  const r = await run({
    issues: [waiting(762)],
    comments: { 762: [bot(WAIT)] },
    pulls: { 775: { merged: true, merge_commit_sha: 'aaa111' } },
    compare: { 'aaa111...v5.0.0-13': 'ahead' },
  });
  assert.deepEqual(r.calls, [
    ['add', 762, ['released']],
    ['remove', 762, 'waiting-for-release'],
    ['comment', 762, 'Included in v5.0.0-13.'],
  ]);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.warnings, []);
});

test('it lists the issues with the waiting label in every state, and compares the merge commit with the tag', async () => {
  const r = await run({ issues: [waiting(762)], comments: { 762: [bot(WAIT)] }, pulls: { 775: { merged: true, merge_commit_sha: 'aaa111' } }, compare: { 'aaa111...v5.0.0-13': 'identical' } });
  assert.deepEqual(r.all.find((c) => c[0] === 'list'), ['list', 'waiting-for-release', 'all']);
  assert.deepEqual(r.all.find((c) => c[0] === 'compare'), ['compare', 'aaa111...v5.0.0-13']);
  assert.equal(r.calls.length, 3, 'identical counts as included');
});

test('a merge commit that is not in the release, or only diverged from it, changes nothing', async () => {
  for (const status of ['behind', 'diverged']) {
    const r = await run({ issues: [waiting(762)], comments: { 762: [bot(WAIT)] }, pulls: { 775: { merged: true, merge_commit_sha: 'aaa111' } }, compare: { 'aaa111...v5.0.0-13': status } });
    assert.deepEqual(r.calls, [], status);
  }
});

test('a fix pull request that is not merged changes nothing', async () => {
  const r = await run({ issues: [waiting(762)], comments: { 762: [bot(WAIT)] }, pulls: { 775: { merged: false, merge_commit_sha: null } } });
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.all.filter((c) => c[0] === 'compare'), []);
});

test('only the comment the Waiting for Release gate wrote counts, not one a person typed', async () => {
  const r = await run({ issues: [waiting(762)], comments: { 762: [person(WAIT)] }, pulls: { 775: { merged: true, merge_commit_sha: 'aaa111' } }, compare: { 'aaa111...v5.0.0-13': 'ahead' } });
  assert.deepEqual(r.calls, []);
});

test('an issue without a "Fixed in #N." comment is left to the agent', async () => {
  const r = await run({ issues: [waiting(762)], comments: { 762: [bot('Waiting for a release that includes this.')] } });
  assert.deepEqual(r.calls, []);
});

test('an issue linked to a related repository is left to the agent, and a pull request in the list is skipped', async () => {
  const r = await run({
    issues: [waiting(762, ['related-repo']), { ...waiting(900), pull_request: {} }],
    comments: { 762: [bot(WAIT)], 900: [bot(WAIT)] },
    pulls: { 775: { merged: true, merge_commit_sha: 'aaa111' } },
    compare: { 'aaa111...v5.0.0-13': 'ahead' },
  });
  assert.deepEqual(r.calls, []);
});

test('the latest "Fixed in" comment decides when an issue was fixed more than once', async () => {
  const pulls = { 10: { merged: true, merge_commit_sha: 'old' }, 11: { merged: true, merge_commit_sha: 'new' } };
  const first = await run({ issues: [waiting(5)], comments: { 5: [bot('Fixed in #10. Waiting.'), bot('Fixed in #11. Waiting.')] }, pulls, compare: { 'old...v5.0.0-13': 'ahead', 'new...v5.0.0-13': 'behind' } });
  assert.deepEqual(first.calls, [], 'the second fix is not in the release yet');
  const second = await run({ issues: [waiting(5)], comments: { 5: [bot('Fixed in #10. Waiting.'), bot('Fixed in #11. Waiting.')] }, pulls, compare: { 'old...v5.0.0-13': 'behind', 'new...v5.0.0-13': 'ahead' } });
  assert.equal(second.calls.length, 3);
});

test('an issue that already has released only loses the waiting label, with no second comment', async () => {
  const r = await run({ issues: [waiting(762, ['released'])], comments: { 762: [bot(WAIT)] }, pulls: { 775: { merged: true, merge_commit_sha: 'aaa111' } }, compare: { 'aaa111...v5.0.0-13': 'ahead' } });
  assert.deepEqual(r.calls, [['remove', 762, 'waiting-for-release']]);
});

test('a waiting label that is already gone (404) is fine; any other failure is a warning after released was added', async () => {
  const ok = await run({ issues: [waiting(762)], comments: { 762: [bot(WAIT)] }, pulls: { 775: { merged: true, merge_commit_sha: 'aaa111' } }, compare: { 'aaa111...v5.0.0-13': 'ahead' }, removeError: Object.assign(new Error('gone'), { status: 404 }) });
  assert.deepEqual(ok.warnings, []);
  assert.equal(ok.calls.at(-1)[0], 'comment');
  const bad = await run({ issues: [waiting(762)], comments: { 762: [bot(WAIT)] }, pulls: { 775: { merged: true, merge_commit_sha: 'aaa111' } }, compare: { 'aaa111...v5.0.0-13': 'ahead' }, removeError: Object.assign(new Error('nope'), { status: 500 }) });
  assert.equal(bad.warnings.length, 1);
  assert.deepEqual(bad.calls.map((c) => c[0]), ['add', 'remove'], 'no comment when the waiting label could not be removed: the next release finishes the job');
});

test('one issue that cannot be read is a warning and the others are still moved', async () => {
  const r = await run({
    issues: [waiting(1), waiting(2)],
    comments: { 1: [bot('Fixed in #50. Waiting.')], 2: [bot('Fixed in #51. Waiting.')] },
    pulls: { 51: { merged: true, merge_commit_sha: 'bbb222' } },
    compare: { 'bbb222...v5.0.0-13': 'ahead' },
    failPull: 50,
  });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^#1: boom/);
  assert.deepEqual(r.calls, [['add', 2, ['released']], ['remove', 2, 'waiting-for-release'], ['comment', 2, 'Included in v5.0.0-13.']]);
  assert.deepEqual(r.failed, []);
});

test('a listing that fails is a warning, not a failure, and nothing is written', async () => {
  const r = await run({ listError: Object.assign(new Error('rate limited'), { status: 403 }) });
  assert.deepEqual(r.calls, []);
  assert.equal(r.warnings.length, 1);
  assert.deepEqual(r.failed, []);
});

test('an open issue is moved the same way and is never closed or reopened', async () => {
  const open = { ...waiting(762), state: 'open' };
  const r = await run({ issues: [open], comments: { 762: [bot(WAIT)] }, pulls: { 775: { merged: true, merge_commit_sha: 'aaa111' } }, compare: { 'aaa111...v5.0.0-13': 'ahead' } });
  assert.deepEqual(r.calls.map((c) => c[0]), ['add', 'remove', 'comment']);
  assert.deepEqual(r.warnings, [], 'the stub has no way to close an issue: any attempt would have thrown a warning');
});

// ---- The compile smoke and the docs ------------------------------------------------------------------------

test('the compile smoke checks that the step survives into the compiled closer', () => {
  const smoke = read('tools/ci-compile-smoke.sh');
  assert.ok(
    smoke.includes('grep -q "id: included_fixes" "$tmp/.github/workflows/release-closer.lock.yml"'),
    'the smoke must grep the compiled release-closer lock for the exact step id',
  );
});

test('the design doc explains the rule and names the incident', () => {
  const design = flat(read('docs/multi-phase-design.md'));
  assert.match(design, /\*\*Which fixes a release contains\.\*\*/);
  assert.match(design, /`included_fixes`/);
  assert.match(design, /frodo-lib#762/);
});
