import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// What went wrong on frodo-lib#803 (2026-10-24), the canonical issue of frodo-cli#919, which never reached issue
// triage although the Issue Worker had run on it twice:
//
// 1. The run on `opened` (40105076286) used all ten turns on reading and searching the code, and ended on
//    "429 Maximum LLM invocations exceeded (10 / 10)" before it posted a comment or a label.
// 2. A maintainer's comment started the worker again (40117228304). It posted its analysis and asked for
//    `issue-worker-ready` with confidence MEDIUM. gh-aw's issue intent holds a label below HIGH as a suggestion
//    ("Successfully added 0 labels ... Suggested 1 labels"), so no label event started issue triage. The same
//    thing happened on frodo-lib#802 in the same minute; of 14 requests for the label in the last 100 runs of two
//    repositories, 11 were HIGH and applied, the two MEDIUM ones were held.
// 3. A maintainer then removed the hold and `plan-approval-resume` rightly skipped the issue: plan triage had not
//    classified it, so there was nothing to approve.
//
// The same restart posted a second analysis on frodo-lib#802 ("Thanks for the follow-up"): the worker had no rule
// for an event that adds nothing to an analysis it had already posted.
//
// The hand-off labels are applied, not suggested, in every gate. The issue worker is the one gate that keeps the
// intent mechanism, because decision 0009 gives `related-repo` a rationale and a confidence (HIGH needs the quote);
// there the prompt makes `issue-worker-ready` a signal that is always HIGH, and the stalled-issue sweep
// (tools/stalled-issue-sweep.test.mjs) is the backstop in code. Docs: docs/multi-phase-design.md, "Gate labels are
// applied, not suggested".

const REPO = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, REPO), 'utf8');
const parts = (md) => {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'frontmatter not found');
  return { frontmatter: m[1], body: m[2] };
};
/** What the agent sees: the body with HTML comments removed, as gh-aw renders it. */
const rendered = (md) => parts(md).body.replace(/<!--[\s\S]*?-->/g, '');
/** The `add-labels:` block of the safe outputs: its lines up to the next key of the same level. */
const addLabels = (name) => {
  const fm = parts(read(`workflows/${name}.md`)).frontmatter;
  const m = fm.match(/^ {2}add-labels:\n((?: {4}.*\n?)+)/m);
  assert.ok(m, `${name}: add-labels not found`);
  return m[1];
};

test('plan worker, issue triage, plan triage and PR triage apply their hand-off labels, they do not suggest them', () => {
  for (const name of ['plan-worker', 'issue-triage', 'plan-triage', 'pr-triage']) {
    assert.match(addLabels(name), /^ {4}issue-intent: false$/m, `${name}: add-labels keeps the issue intent on`);
  }
});

test('the PR worker sends the assignment without issue intent', () => {
  assert.match(parts(read('workflows/pr-worker.md')).frontmatter, /^ {4}issue-intent: false$/m);
});

test('issue worker: keeps the issue intent, `related-repo` needs its rationale and confidence (decision 0009)', () => {
  assert.doesNotMatch(addLabels('issue-worker'), /issue-intent/);
  assert.match(addLabels('issue-worker'), /^ {6}- issue-worker-ready\n {6}- related-repo\n/m, 'the allowed labels are unchanged (decision 0007)');
});

test('issue worker: `issue-worker-ready` is a signal that is always HIGH, confidence decides only `related-repo`', () => {
  const signaling = rendered(read('workflows/issue-worker.md')).split('\n## Signaling (internal)\n')[1];
  assert.ok(signaling, 'Signaling section not found');
  assert.match(signaling, /`issue-worker-ready` is a signal, not a judgement: give it `confidence: HIGH`/);
  assert.match(signaling, /A label below HIGH is held back as a suggestion, the issue never reaches issue triage, and nobody is told\./);
  assert.match(signaling, /Confidence decides only `related-repo`/);
});

test('plan worker: the hand-off label is applied as a plain string', () => {
  assert.match(rendered(read('workflows/plan-worker.md')), /Apply the label as a plain string, with no rationale, no confidence and no suggestion: it is the hand-off to plan triage and must be applied, not suggested\./);
});

test('issue worker: 14 turns, at most ten of them for checking, so the comment and the labels always fit', () => {
  const worker = read('workflows/issue-worker.md');
  assert.match(parts(worker).frontmatter, /^max-turns: 14$/m);
  assert.match(rendered(worker), /Spend at most ten turns reading and searching\. The comment and the labels are tool calls too, and a run that reaches its turn limit before it has posted leaves the issue unanswered and outside the pipeline\./);
  assert.match(rendered(worker), /If a check is still open when you get there, post what you verified and say what you did not check\./);
});

test('issue worker: an event that adds nothing to an analysis it already posted gets no second analysis, but the signal', () => {
  const text = rendered(read('workflows/issue-worker.md'));
  const analysed = text.split('\n### Already analysed\n')[1]?.split('\n### ')[0];
  assert.ok(analysed, 'Already analysed section not found');
  assert.match(analysed, /A comment of yours has a footer that names `Issue Concierge 1a ▸ Issue Worker`\./);
  assert.match(analysed, /Post no comment then, and signal as usual \(see "Signaling"\)\./);
  assert.match(analysed, /Write a new comment only when something changed that a reporter would want an answer to: the report was edited with new facts, someone answered a question you asked, or someone asked a new one\./);
  assert.match(analysed, /Say only what is new and do not repeat the earlier analysis\./);
});
