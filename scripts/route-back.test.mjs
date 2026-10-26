import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LABEL_HANDOFF,
  LABEL_HOLD,
  MARKER,
  apply,
  canonicalComment,
  decide,
  markedOriginal,
  originalComment,
  planCommentUrl,
} from './route-back.mjs';

// frodo-lib#803, the canonical issue of frodo-cli#919 (2026-10-26): the plan said "Layer: not verified ... probably in
// frodo-cli" and a maintainer found that the Concierge has no way to move the work back. The plan gate tells a
// maintainer to "move or re-route" an issue and nothing did it, removing `related-repo` from the original starts
// nothing, and the closer leaves a canonical issue closed as not planned to a maintainer. These fakes stand for the two
// repositories; what is written is recorded in `calls`.

const THIS = 'rockcarver/frodo-lib';
const OTHER = 'rockcarver/frodo-cli';
const REF = `${THIS}#803`;
const OREF = `${OTHER}#919`;
const bot = (body, extra = {}) => ({ user: { login: 'github-actions[bot]', type: 'Bot' }, body, ...extra });
const person = (body) => ({ user: { login: 'vscheuber', type: 'User' }, body });
const label = (names) => names.map((name) => ({ name }));

const canonical = (extra = {}) => ({
  number: 803,
  state: 'open',
  user: { login: 'vscheuber', type: 'User' },
  labels: label(['original-in-related-repo', 'plan-approval-required', 'complexity/medium']),
  body: `The report.\n\nReported from ${OREF}`,
  ...extra,
});
const original = (extra = {}) => ({ number: 919, state: 'open', labels: label(['related-repo']), ...extra });
const planComment = bot('## Plan\n\n<!-- gh-aw-workflow-call-id: rockcarver/frodo-lib/plan-worker -->', {
  html_url: 'https://github.com/rockcarver/frodo-lib/issues/803#issuecomment-1',
});

/** A fake GET: what both repositories hold. */
function world({ c = canonical(), cComments = [planComment], o = original(), oComments = [bot(`This is being tracked in ${REF}. We will update this issue when that work is finished.`)] } = {}) {
  const pages = new Map([
    [`repos/${THIS}/issues/803/comments?per_page=100&page=1`, cComments],
    [`repos/${OTHER}/issues/919`, o],
    [`repos/${OTHER}/issues/919/comments?per_page=100&page=1`, oComments],
  ]);
  const api = (path) => (pages.has(path) ? { status: 200, data: pages.get(path) } : { status: 404, data: null });
  return { c, api, ctx: { thisRepo: THIS, relatedRepo: OTHER, api } };
}

/** Fake writes: every call is recorded in order. */
function recorder(extra = {}) {
  const calls = [];
  const ctx = {
    original: {
      addLabel: (repo, n, l) => calls.push(`${repo}#${n} +${l}`),
      removeLabel: (repo, n, l) => calls.push(`${repo}#${n} -${l}`),
      comment: (repo, n) => calls.push(`${repo}#${n} comment`),
    },
    canonical: {
      comment: (n) => calls.push(`${THIS}#${n} comment`),
      close: (n) => calls.push(`${THIS}#${n} closed as not planned`),
    },
    ...extra,
  };
  return { calls, ctx };
}

test('routes back: the original is held, told, unlinked and handed to the plan gate, and the canonical issue closes last', () => {
  const w = world();
  const verdict = decide(w.c, w.ctx);
  assert.equal(verdict.action, 'route');
  assert.equal(verdict.resumed, false);
  const { calls, ctx } = recorder();
  apply(verdict, w.c, { ...w.ctx, ...ctx });
  assert.deepEqual(calls, [
    `${OREF} +${LABEL_HOLD}`,
    `${OREF} comment`,
    `${REF} comment`,
    `${OREF} -related-repo`,
    `${OREF} +${LABEL_HANDOFF}`,
    `${REF} closed as not planned`,
  ]);
});

test('a hold and a hand-off that are there already are not added again', () => {
  const w = world({ o: original({ labels: label(['related-repo', LABEL_HOLD, LABEL_HANDOFF]) }) });
  const { calls, ctx } = recorder();
  apply(decide(w.c, w.ctx), w.c, { ...w.ctx, ...ctx });
  assert.deepEqual(calls, [`${OREF} comment`, `${REF} comment`, `${OREF} -related-repo`, `${REF} closed as not planned`]);
});

test('the comments are plain language, name each other, and the original gets the link to the plan written on the canonical issue', () => {
  const text = originalComment(REF, 'https://github.com/rockcarver/frodo-lib/issues/803#issuecomment-1');
  assert.ok(text.includes(`passed to ${REF}`));
  assert.match(text, /The plan written there, with what it found in the code, is at https:\/\/github\.com\/rockcarver\/frodo-lib\/issues\/803#issuecomment-1\./);
  assert.ok(text.includes(`${MARKER}original ${REF} -->`));
  assert.ok(canonicalComment(OREF).includes(`${MARKER}canonical ${OREF} -->`));
  assert.match(canonicalComment(OREF), /the work continues there and this issue is closed as not planned/);
  // The reporter reads these: no label, gate or workflow named.
  for (const t of [text, originalComment(REF), canonicalComment(OREF)]) assert.doesNotMatch(t.replace(/<!--.*?-->/gs, ''), /label|gate|workflow|harness|plan-approval|related-repo/i);
  assert.doesNotMatch(originalComment(REF), /is at http/, 'no plan, no link');
});

test('the plan is the latest comment of the plan worker of this repository, not a person quoting its marker or another repository\'s worker', () => {
  const older = bot('## Plan (older)\n<!-- gh-aw-workflow-call-id: rockcarver/frodo-lib/plan-worker -->', { html_url: 'u1' });
  const newer = bot('## Plan\n<!-- gh-aw-workflow-call-id: rockcarver/frodo-lib/plan-worker -->', { html_url: 'u2' });
  const quoted = { ...person('<!-- gh-aw-workflow-call-id: rockcarver/frodo-lib/plan-worker -->'), html_url: 'u3' };
  const foreign = bot('<!-- gh-aw-workflow-call-id: rockcarver/frodo-cli/plan-worker -->', { html_url: 'u4' });
  assert.equal(planCommentUrl([older, newer, quoted, foreign], THIS), 'u2');
  assert.equal(planCommentUrl([quoted, foreign], THIS), '');
});

test('leaves alone what is not an open canonical issue of a link', () => {
  const w = (extra, rest) => world({ c: canonical(extra), ...rest });
  const reason = (x) => decide(x.c, x.ctx).reason;
  assert.match(reason(w({ pull_request: {} })), /pull request/);
  assert.match(reason(w({ user: { login: 'dependabot[bot]', type: 'Bot' } })), /bot/);
  assert.match(reason(w({ labels: label(['no-auto-processing', 'original-in-related-repo']) })), /no-auto-processing/);
  assert.match(reason(w({ labels: label(['bug']) })), /not the canonical issue of a link/);
  assert.match(reason(w({ state: 'closed' })), /only an open canonical issue is routed back/);
});

test('an issue that was routed back already says so and is left alone', () => {
  const w = world({ c: canonical({ state: 'closed' }), cComments: [planComment, bot(canonicalComment(OREF))] });
  const v = decide(w.c, w.ctx);
  assert.equal(v.action, 'skip');
  assert.match(v.reason, new RegExp(`already routed back to ${OREF}`));
});

test('the proof of the link is the closer\'s: an original that does not carry the link label, is closed, is opted out or does not name this issue is not written to', () => {
  const why = (opts) => {
    const w = world(opts);
    return decide(w.c, w.ctx).reason;
  };
  assert.match(why({ o: original({ labels: label(['bug']) }) }), /does not carry related-repo/);
  assert.match(why({ o: original({ labels: label(['related-repo', 'no-auto-processing']) }) }), /no-auto-processing/);
  assert.match(why({ oComments: [person(`I think this is ${REF}`)] }), /no comment from the harness that names/);
  assert.match(why({ o: original({ state: 'closed' }) }), /is closed: there is nothing to route back to/);
  const noLink = world({ c: canonical({ body: 'The report, no link.' }) });
  assert.match(decide(noLink.c, noLink.ctx).reason, /no link to an original issue/);
  const unconfigured = world();
  assert.match(decide(unconfigured.c, { ...unconfigured.ctx, relatedRepo: '' }).reason, /no related repository/);
});

test('a run that stopped after the link label was removed is finished by the next one, and only the rest is done', () => {
  // The original lost related-repo, so the proof of the link is gone: the two comments of this script are the proof.
  const w = world({
    o: original({ labels: label([LABEL_HOLD]) }),
    oComments: [bot(`tracked in ${REF}`), person(originalComment(REF))],
    cComments: [planComment, bot(canonicalComment(OREF))],
  });
  const verdict = decide(w.c, w.ctx);
  assert.equal(verdict.action, 'route');
  assert.equal(verdict.resumed, true);
  const { calls, ctx } = recorder();
  apply(verdict, w.c, { ...w.ctx, ...ctx });
  assert.deepEqual(calls, [`${OREF} +${LABEL_HANDOFF}`, `${REF} closed as not planned`]);
});

test('a forged resume does not work: the comment must name this issue, the original must be in the related repository', () => {
  // no comment of this script on the original
  const none = world({ o: original({ labels: label([LABEL_HOLD]) }), cComments: [planComment, bot(canonicalComment(OREF))] });
  assert.equal(decide(none.c, none.ctx).action, 'skip');
  // the comment names another issue
  const other = world({ o: original({ labels: label([LABEL_HOLD]) }), oComments: [person(originalComment(`${THIS}#9`))], cComments: [bot(canonicalComment(OREF))] });
  assert.equal(decide(other.c, other.ctx).action, 'skip');
  // the canonical issue's comment names a repository that is not the related one
  const foreign = world({ cComments: [planComment, bot(canonicalComment('someone/else#1'))], o: original({ labels: label([LABEL_HOLD]) }) });
  assert.equal(decide(foreign.c, foreign.ctx).action, 'skip');
  assert.equal(markedOriginal([bot(canonicalComment('someone/else#1'))]), 'someone/else#1', 'the marker is read; the caller checks the repository');
  assert.equal(markedOriginal([person('no marker')]), null);
});

test('a dry run writes nothing and says what it would do', () => {
  const w = world({ o: original({ labels: label(['related-repo']) }) });
  const boom = () => {
    throw new Error('wrote in a dry run');
  };
  const ctx = { ...w.ctx, dryRun: true, original: { addLabel: boom, removeLabel: boom, comment: boom }, canonical: { comment: boom, close: boom } };
  const did = apply(decide(w.c, w.ctx), w.c, ctx);
  assert.equal(did.length, 6);
  assert.match(did.join(' | '), new RegExp(`closed ${REF} as not planned`));
});

test('running it twice does the work once: every step checks first', () => {
  const w = world();
  const first = recorder();
  apply(decide(w.c, w.ctx), w.c, { ...w.ctx, ...first.ctx });
  assert.equal(first.calls.length, 6);
  // the state after the first run, as the second would read it
  const after = world({
    c: canonical({ state: 'closed' }),
    cComments: [planComment, bot(canonicalComment(OREF))],
    o: original({ labels: label([LABEL_HOLD, LABEL_HANDOFF]) }),
    oComments: [person(originalComment(REF))],
  });
  assert.equal(decide(after.c, after.ctx).action, 'skip');
});
