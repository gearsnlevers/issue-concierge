import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { holds, frontmatterIf, read } from './workflow-condition.mjs';
import { ACCEPT_MARKER, COMMAND_NAMES, LEGACY_ACCEPT_MARKER } from '../scripts/commands.mjs';

// The soak of v2.0.0-1 (docs/e2e.md, command-accepts-a-held-request) found a race, and the proof of v2.0.0 found why the first fix
// did not hold. A reporter asks a question on a held request, a maintainer writes `/accept` a minute later, and the issue worker run
// the question had started finishes after the hand-over and gives issue triage its label again. Issue triage then reads an issue with
// no gate label (they are removed as an issue moves on, and the plan worker is still writing the plan) and applied `needs-decision`
// again. The first fix told the model to count a comment that starts with `/accept` from OWNER, MEMBER or COLLABORATOR. The model read
// the maintainer as a CONTRIBUTOR, because GitHub shows a member with private membership as one to the workflow token: the same
// comment is MEMBER to an organisation member and CONTRIBUTOR to the token of a workflow. So the decision is recorded by the Concierge
// itself, in a comment of the bot, after it checked the role in code; a pre-activation step without a model reads that record and
// stands issue triage down, and the prompt has the same rule for the case that the step could not read the comments.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'workflows/issue-triage.md'), 'utf8');
const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/)[1];
const prompt = source.replace(/<!--[\s\S]*?-->/g, '');
const labels = prompt.split('\n## Internal labels (never mentioned to the reporter)\n')[1].split('\n## ')[0];
const bullet = labels.split('\n').find((l) => l.startsWith('- If a comment of the bot'));

// ------------------------------------------------------------------ the prompt, the second layer

test('the rule exists in the section that decides the outcomes, and comes before the outcomes it overrides', () => {
  assert.ok(bullet, 'the bullet about the record of /accept is missing');
  const lines = labels.split('\n');
  const at = lines.indexOf(bullet);
  for (const outcome of ['- Valid but not urgent:', '- Complete, actionable, and worth doing now']) {
    assert.ok(at < lines.findIndex((l) => l.startsWith(outcome)), `before "${outcome}"`);
  }
  assert.ok(at > lines.findIndex((l) => l.startsWith('- A change to what exists:')), 'after the hold it overrides is described');
});

test('only the record of the bot counts: not the words of a person, and not the author association', () => {
  assert.match(bullet, /If a comment of the bot \(the author `github-actions\[bot\]`\) on the issue contains the text `issue-concierge:accepted` \(a record that an earlier version wrote says `concierge:accepted`, which counts as well\)/);
  assert.match(bullet, /the Concierge checked who gave the command and wrote that comment/);
  assert.match(bullet, /Do not look at the author association of any comment to decide this: it is not reliable for the workflow token\./);
  assert.match(bullet, /The same words in a comment of anyone else are not a record\./);
  assert.doesNotMatch(bullet, /OWNER, MEMBER or COLLABORATOR/, 'the first fix keyed on a value the workflow token does not see');
});

test('the prompt names the marker by its text: gh-aw removes an HTML comment from a prompt, so the agent would never see one', () => {
  assert.ok(ACCEPT_MARKER.includes('issue-concierge:accepted') && LEGACY_ACCEPT_MARKER.includes('concierge:accepted'));
  assert.doesNotMatch(source.split(/\n---\n/)[1], /<!--\s*(issue-)?concierge:accepted/, 'a marker written as an HTML comment in the prompt is removed before the agent reads it');
});

test('it says why no label shows the decision, so the model does not wait for one', () => {
  assert.match(bullet, /No label has to show that: the gate labels are removed as an issue moves on/);
  assert.match(bullet, /your own run may have started before the command was given/);
});

test('what it forbids is every outcome that would stop or start the issue again', () => {
  assert.match(bullet, /Do not apply `needs-decision`, `scope-review`, `out-of-scope`, `backlog` or `low-hanging-fruit`, and do not emit `issue-triage-handoff` a second time\./);
});

test('the bullets next to it are as they were: the hold that stays and the later-phase list', () => {
  assert.match(labels, /- If the issue already has `out-of-scope`, `needs-decision` or `declined`, do nothing: it was declined or is waiting for a maintainer, and a reporter's reply does not change that\. If it already shows later-phase progress \(`issue-triage-handoff`, `plan-worker-ready`, `plan-triage-handoff`, a `complexity\/\*` or `risk\/\*` label, or the coding agent as an assignee\)/);
});

test('the command is one the commands workflow really has, and /accept hands the issue to the plan worker', () => {
  assert.ok(COMMAND_NAMES.includes('accept'));
  const commands = fs.readFileSync(path.join(ROOT, 'scripts/commands.mjs'), 'utf8');
  assert.match(commands, /LABEL_HANDOFF = 'issue-triage-handoff'/);
});

// ------------------------------------------------------------------ the step, the guarantee

const condition = frontmatterIf(read('workflows/issue-triage.md'));

test('the gate stands down when the accepted step failed, and only then: the other conditions are as they were', () => {
  assert.match(condition, /needs\.pre_activation\.outputs\.accepted_result != 'failure'/);
  const issue = { state: 'open', labels: [{ name: 'enhancement' }], user: { type: 'User' } };
  const label = { name: 'issue-worker-ready' };
  const ctx = (extra = {}, needs = {}, vars = {}) => ({ vars, github: { event_name: 'issues', event: { action: 'labeled', label, issue: { ...issue, ...extra } } }, needs: { pre_activation: { outputs: needs } } });
  assert.equal(holds(condition, ctx({}, { accepted_result: 'success' })), true);
  assert.equal(holds(condition, ctx({}, { accepted_result: 'skipped' })), true, 'a step that was skipped (another label) stands nothing down');
  assert.equal(holds(condition, ctx({}, {})), true, 'a step that exported nothing stands nothing down');
  assert.equal(holds(condition, ctx({}, { accepted_result: 'failure' })), false);
  assert.equal(holds(condition, ctx({ state: 'closed' }, { accepted_result: 'success' })), false);
  assert.equal(holds(condition, ctx({ user: { type: 'Bot' } }, { accepted_result: 'success' })), false);
  assert.equal(holds(condition, ctx({ labels: [{ name: 'no-auto-processing' }] }, { accepted_result: 'success' })), false);
  assert.equal(holds(condition, ctx({}, { accepted_result: 'success' }, { ISSUE_CONCIERGE_PAUSED: 'true' })), false);
  assert.equal(holds(condition, ctx({}, { accepted_result: 'success' }, { CONCIERGE_PAUSED: 'true' })), false, 'the name it had in v2.0.x pauses too');
});

test('the step runs in pre-activation, never fails the job itself, and only for its own label, while the Concierge runs and the issue is open', () => {
  assert.match(frontmatter, /^ {2}steps:\n/m, 'on.steps');
  assert.match(frontmatter, /id: accepted\n/);
  assert.match(frontmatter, /id: accepted\n\s+if: \(vars\.ISSUE_CONCIERGE_PAUSED != 'true' && vars\.CONCIERGE_PAUSED != 'true' \|\| github\.event_name == 'workflow_dispatch'\) && github\.event\.label\.name == 'issue-worker-ready' && github\.event\.issue\.state == 'open' && github\.event\.issue\.user\.type != 'Bot' && !contains\(github\.event\.issue\.labels\.\*\.name, 'no-auto-processing'\)\n\s+continue-on-error: true\n\s+uses: actions\/github-script@v9/);
  // it removes the label that started the run, and reads comments
  assert.match(frontmatter, /^ {2}permissions:\n {4}issues: write\n/m);
});

const MARKERS_IN_STEP = frontmatter.match(/const MARKERS = \[([^\]]+)\];/);
test('the step looks for the line /accept writes, and for the one an earlier version wrote', () => {
  assert.ok(MARKERS_IN_STEP, 'the step names its markers');
  assert.deepEqual([...MARKERS_IN_STEP[1].matchAll(/'([^']+)'/g)].map((m) => m[1]), [ACCEPT_MARKER, LEGACY_ACCEPT_MARKER]);
});

const scriptOf = (fm) => {
  const lines = fm.split('\n');
  const at = lines.findIndex((l) => /^ {8}script: \|$/.test(l));
  assert.ok(at >= 0, 'script block of the accepted step not found');
  const out = [];
  for (const l of lines.slice(at + 1)) {
    if (l !== '' && !l.startsWith(' '.repeat(10))) break;
    out.push(l.slice(10));
  }
  return out.join('\n');
};
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const step = new AsyncFunction('github', 'context', 'core', scriptOf(frontmatter));

const BOT = { login: 'github-actions[bot]', type: 'Bot' };
const MAINTAINER = { login: 'volker', type: 'User' };
const comment = (user, body, extra = {}) => ({ user, body, html_url: 'https://github.com/octo/app/issues/887#issuecomment-1', ...extra });
const RECORD = comment(BOT, `${ACCEPT_MARKER}\nAccepted by @volker with /accept. The request goes to planning now.`);

async function run({ comments = [], list, remove, number = 887 } = {}) {
  const seen = { failed: [], warnings: [], removed: [], listed: [] };
  const core = { setFailed: (m) => seen.failed.push(m), warning: (m) => seen.warnings.push(m) };
  const listComments = Symbol('listComments');
  const github = {
    paginate: async (fn, args) => {
      assert.equal(fn, listComments, 'the comments are read with the paginated list of the issue');
      seen.listed.push(args);
      if (list) return list(args);
      return comments;
    },
    rest: {
      issues: {
        listComments,
        removeLabel: async (a) => {
          seen.removed.push(a.name);
          if (remove) return remove(a);
        },
      },
    },
  };
  const context = { repo: { owner: 'octo', repo: 'app' }, payload: { issue: { number } } };
  try {
    await step(github, context, core);
  } catch (error) {
    seen.thrown = error;
  }
  return seen;
}

test('step: the record of the bot stands the gate down, takes the void label away, and says which comment it found', async () => {
  const seen = await run({ comments: [comment({ login: 'reporter', type: 'User' }, 'what depends on it?'), RECORD, comment(BOT, 'You asked what depends on it.')] });
  assert.equal(seen.failed.length, 1);
  assert.match(seen.failed[0], /^A maintainer has already accepted #887 \(https:\/\/github\.com\/octo\/app\/issues\/887#issuecomment-1\)/);
  assert.deepEqual(seen.removed, ['issue-worker-ready']);
  assert.deepEqual(seen.listed, [{ owner: 'octo', repo: 'app', issue_number: 887, per_page: 100 }]);
  assert.equal(seen.thrown, undefined);
});

test('step: a record from an earlier version stands the gate down as well, and so does one with the new line', async () => {
  for (const marker of [ACCEPT_MARKER, LEGACY_ACCEPT_MARKER]) {
    const seen = await run({ comments: [comment(BOT, `${marker}\nAccepted by @volker with /accept. The request goes to planning now.`)] });
    assert.equal(seen.failed.length, 1, marker);
    assert.deepEqual(seen.removed, ['issue-worker-ready'], marker);
  }
  const near = await run({ comments: [comment(BOT, '<!-- concierge:accept -->'), comment(BOT, '<!-- issue-concierge:acceptable -->')] });
  assert.deepEqual(near.failed, [], 'a line that only resembles the record is not one');
});

test('step: the older line in a person\'s comment is only words, too', async () => {
  for (const user of [MAINTAINER, { login: 'reporter', type: 'User' }]) {
    const seen = await run({ comments: [comment(user, `${LEGACY_ACCEPT_MARKER}\nAccepted by @volker with /accept.`)] });
    assert.deepEqual(seen.failed, [], user.login);
  }
});

test('step: the words of a person are not a record, whoever the person is', async () => {
  for (const user of [MAINTAINER, { login: 'reporter', type: 'User' }, { login: 'someone-else', type: 'User' }, { login: 'github-actions', type: 'User' }]) {
    const seen = await run({ comments: [comment(user, `${ACCEPT_MARKER}\nAccepted by @volker with /accept.`)] });
    assert.deepEqual(seen.failed, [], user.login);
    assert.deepEqual(seen.removed, [], user.login);
  }
});

test('step: the maintainer\'s own /accept is not the record either, whatever the author association says', async () => {
  const seen = await run({ comments: [comment(MAINTAINER, '/accept', { author_association: 'MEMBER' }), comment(MAINTAINER, '/accept', { author_association: 'CONTRIBUTOR' })] });
  assert.deepEqual(seen.failed, []);
});

test('step: another comment of the bot is not the record (the options comment, an answer)', async () => {
  const seen = await run({ comments: [comment(BOT, '<!-- concierge:options kind=decision -->\nThis request changes something that already exists.'), comment(BOT, 'Here is what I checked.')] });
  assert.deepEqual(seen.failed, []);
  assert.deepEqual(seen.removed, []);
});

test('step: an issue nobody accepted, with no comments at all, or with comments without a body, is left to the gate', async () => {
  for (const comments of [[], [comment(BOT, null)], [comment(null, 'x')], [{ body: undefined }]]) {
    const seen = await run({ comments });
    assert.deepEqual(seen.failed, []);
    assert.deepEqual(seen.removed, []);
  }
});

test('step: doubt about the comments never stops the gate by itself: the prompt has the rule too', async () => {
  const seen = await run({ list: async () => { throw new Error('HTTP 502'); } });
  assert.deepEqual(seen.failed, []);
  assert.equal(seen.warnings.length, 1);
  assert.match(seen.warnings[0], /Could not read the comments of #887: HTTP 502/);
  assert.equal(seen.thrown, undefined);
});

test('step: a label that is already gone is no error, and any other failure to remove it is a warning, not a reason to go on', async () => {
  const gone = await run({ comments: [RECORD], remove: async () => { throw Object.assign(new Error('Not Found'), { status: 404 }); } });
  assert.equal(gone.failed.length, 1, 'the gate stands down');
  assert.deepEqual(gone.warnings, []);
  const refused = await run({ comments: [RECORD], remove: async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); } });
  assert.equal(refused.failed.length, 1, 'the gate still stands down');
  assert.match(refused.warnings[0], /Could not remove issue-worker-ready from #887: Forbidden/);
});

test('step: the record counts wherever it is among many comments (the read is paginated)', async () => {
  const many = Array.from({ length: 250 }, (_, i) => comment({ login: `user${i}`, type: 'User' }, `comment ${i}`));
  many.splice(231, 0, RECORD);
  const seen = await run({ comments: many });
  assert.equal(seen.failed.length, 1);
});

// ------------------------------------------------------------------ the record is not something a reporter can write

test('the record is posted by the workflow token, so that only the bot can be its author', () => {
  const commands = fs.readFileSync(path.join(ROOT, 'scripts/commands.mjs'), 'utf8');
  assert.match(commands, /reply: \(n, body\) => json\('POST', `repos\/\$\{repo\}\/issues\/\$\{n\}\/comments`, \{ body \}\)/, 'reply uses the default token');
  assert.match(commands, /const json = \(method, path, body, token = env\.GH_TOKEN\)/, 'the default token is the workflow token');
});
