import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// On frodo-lib 5.0.0-12 the Release closer checked the wrong release: it called get_latest_release, which skips
// prereleases and returns the newest STABLE release (v4.12.0), concluded that nothing it was waiting for was
// included, and changed no labels. The prompt only said "Triggered when a release is published" and never
// said which release. On 5.0.0-11 the model happened to recover with list_releases / get_release_by_tag.
// This test pins the prompt contract that removes the dependence on luck.
const md = fs.readFileSync(new URL('../workflows/release-closer.md', import.meta.url), 'utf8');
const frontmatter = md.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
const body = md.slice(md.indexOf('\n---\n', 4) + 5);
const start = body.indexOf('## Which release');
const section = start >= 0 ? body.slice(start, body.indexOf('\n## ', start + 5)) : '';

test('the closer runs for prereleases as well as published releases', () => {
  assert.match(frontmatter, /release:\n\s+types: \[published, prereleased\]/);
});

test('the prompt names the triggering release by its tag expression', () => {
  assert.ok(section, 'the "Which release" section is missing from workflows/release-closer.md');
  assert.ok(section.includes('${{ github.event.release.tag_name }}'), 'the triggering tag is not passed into the prompt');
});

test('the model must read that release with get_release_by_tag', () => {
  assert.match(section, /`get_release_by_tag`/);
  assert.match(section, /exactly that tag/);
});

test('get_latest_release is forbidden, and the reason is given', () => {
  assert.match(section, /Never use `get_latest_release`/);
  assert.match(section, /skips prereleases/);
});

test('a prerelease counts as a release', () => {
  assert.match(section, /A prerelease is a release/);
});

test('the section comes before the instructions that use "this release"', () => {
  const which = body.indexOf('## Which release');
  const owns = body.indexOf('## This repository owns the fix');
  assert.ok(which >= 0 && owns > which, '"Which release" must come before the fix instructions');
});
