import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The Issue Worker cannot know the number of the issue it creates in a related repository, because
// safe outputs run after the agent finishes. gh-aw (v0.92.0, actions/setup/js/temporary_id.cjs) lets
// the agent name the new issue with a temporary id and replaces `#aw_<3-12 chars>` in later safe-output
// text with `owner/repo#N` (another repository) or `#N` (same repository).
//
// What went wrong on frodo-cli#694: the agent left `temporary_id` out (gh-aw registered a random one),
// then wrote an id of its own and a repository prefix in the comment: `rockcarver/frodo-lib#aw_lib694`.
// That id was never registered, so the placeholder stayed in the comment. This test pins the prompt
// contract that prevents it.
const md = fs.readFileSync(new URL('../workflows/issue-worker.md', import.meta.url), 'utf8');
const start = md.indexOf('## Related repositories (linked-issue flow)');
assert.ok(start > 0, 'linked-issue section not found in workflows/issue-worker.md');
const section = md.slice(start);
const ID = 'aw_canonical';

// Copy of gh-aw's pattern and of replaceTemporaryIdReferences (v0.92.0), reduced to what the test needs.
const TEMPORARY_ID_PATTERN = /#(aw_[A-Za-z0-9_]{3,12})\b/gi;
function replaceTemporaryIds(text, map, currentRepo) {
  return text.replace(TEMPORARY_ID_PATTERN, (match, id) => {
    const hit = map.get(id.toLowerCase());
    if (!hit) return match;
    return hit.repo === currentRepo ? `#${hit.number}` : `${hit.repo}#${hit.number}`;
  });
}
const registered = new Map([[ID, { repo: 'rockcarver/frodo-lib', number: 744 }]]);

test('the fixed temporary id is valid for gh-aw (aw_ plus 3 to 12 letters, digits or underscores)', () => {
  assert.match(ID, /^aw_[A-Za-z0-9_]{3,12}$/);
});

test('create-issue is told to set that id explicitly', () => {
  assert.ok(section.includes('Set `temporary_id` to exactly `' + ID + '`'), 'the temporary_id instruction is missing');
});

test('both "tracked in" comments refer to the new issue only by the bare token', () => {
  const lines = section.split('\n').filter((l) => l.includes('This is being tracked in'));
  assert.equal(lines.length, 2, 'expected the requires_consumer_release and the plain comment');
  for (const line of lines) {
    assert.match(line, new RegExp('tracked in #' + ID + '\\.'));
    assert.doesNotMatch(line, /\{owner\}|\{repo\}|\{number\}/);
  }
});

test('nothing in the section puts an owner, a repository or a made-up id in front of the token', () => {
  assert.doesNotMatch(section, /[\w.-]\/#aw_|\}#aw_|[A-Za-z0-9_.-]#aw_/);
  const others = [...section.matchAll(/#(aw_[A-Za-z0-9_]+)/g)].map((m) => m[1]).filter((id) => id !== ID);
  assert.deepEqual(others, [], 'only #' + ID + ' may be used as a placeholder');
  assert.match(section, /never another `#aw_` id/);
});

test('gh-aw turns the bare token into a clean cross-repository reference', () => {
  const out = replaceTemporaryIds('This is being tracked in #' + ID + '. We will update this issue when that work is finished.', registered, 'rockcarver/frodo-cli');
  assert.equal(out, 'This is being tracked in rockcarver/frodo-lib#744. We will update this issue when that work is finished.');
});

test('why the prefix is forbidden: gh-aw would double it, and an unregistered id is left as it is', () => {
  assert.equal(
    replaceTemporaryIds('tracked in rockcarver/frodo-lib#' + ID, registered, 'rockcarver/frodo-cli'),
    'tracked in rockcarver/frodo-librockcarver/frodo-lib#744'
  );
  assert.equal(
    replaceTemporaryIds('tracked in rockcarver/frodo-lib#aw_lib694', registered, 'rockcarver/frodo-cli'),
    'tracked in rockcarver/frodo-lib#aw_lib694'
  );
});
