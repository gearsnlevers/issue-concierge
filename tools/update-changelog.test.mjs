import test from 'node:test';
import assert from 'node:assert/strict';
import { addRelease, demoteHeadings } from './update-changelog.mjs';

const args = (tag, notes = '- a change') => ({ tag, date: '2026-10-22', notes });

test('creates the file with a title when there is no changelog yet', () => {
  assert.equal(addRelease('', args('v1.0.0')), '# Changelog\n\n## [v1.0.0] - 2026-10-22\n\n- a change\n');
});

test('puts the newest release first, below the title', () => {
  const first = addRelease('', args('v1.0.0', '- one'));
  const second = addRelease(first, args('v1.1.0', '- two'));
  assert.ok(second.indexOf('## [v1.1.0]') < second.indexOf('## [v1.0.0]'));
  assert.ok(second.startsWith('# Changelog\n'));
  assert.equal((second.match(/^## \[/gm) || []).length, 2);
});

test('keeps a preamble between the title and the first release', () => {
  const text = '# Changelog\n\nAll notable changes.\n\n## [v1.0.0] - 2026-01-01\n\n- old\n';
  const out = addRelease(text, args('v1.1.0', '- new'));
  assert.ok(out.includes('All notable changes.'));
  assert.ok(out.indexOf('All notable changes.') < out.indexOf('## [v1.1.0]'));
  assert.ok(out.indexOf('## [v1.1.0]') < out.indexOf('## [v1.0.0]'));
});

test('refuses to add the same tag twice', () => {
  const once = addRelease('', args('v1.0.0'));
  assert.throws(() => addRelease(once, args('v1.0.0')), /already has a section for v1\.0\.0/);
});

test('a file without a title gets one', () => {
  const out = addRelease('some text\n', args('v1.0.0'));
  assert.ok(out.startsWith('# Changelog\n'));
  assert.ok(out.includes('some text'));
});

test('headings in the notes move one level below the release heading', () => {
  const notes = "## What's Changed\n* a thing\n\n## New Contributors\n* someone\n\n**Full Changelog**: https://example.com";
  const out = addRelease('', args('v1.0.0', notes));
  assert.ok(out.includes("## [v1.0.0] - 2026-10-22\n\n### What's Changed\n"));
  assert.ok(out.includes('\n### New Contributors\n'));
  assert.equal((out.match(/^## /gm) || []).length, 1); // only the release heading is level two
  assert.ok(out.includes('**Full Changelog**: https://example.com'));
});

test('demoteHeadings leaves code fences, non-headings and deep levels alone', () => {
  const text = '# A\n##### E\n###### F\n#hashtag\n```\n# not a heading\n```\n~~~\n## also code\n~~~\n## B';
  assert.equal(demoteHeadings(text), '## A\n###### E\n###### F\n#hashtag\n```\n# not a heading\n```\n~~~\n## also code\n~~~\n### B');
});
