import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, SCHEMA, SETTINGS_PATH, parseSettings } from './issue-concierge-settings.mjs';
import { checkSettings } from './check-deployment.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a missing file, an empty file and a file of comments all mean the defaults, without a complaint', () => {
  for (const text of [undefined, null, '', '\n\n', '# only a comment\n   # and another\n']) {
    assert.deepEqual(parseSettings(text), { settings: DEFAULTS, problems: [] });
  }
  assert.deepEqual(DEFAULTS, { 'status-issue': true, commands: true, 'commands-need': 'triage', 'reporter-replies-days': 14, 'mention-after-days': 0 });
});

test('values are read as the type the setting has, in any case for words, with comments and quotes allowed', () => {
  const { settings, problems } = parseSettings(['# the status issue', 'status-issue: FALSE   # off for now', '', "reporter-replies-days: '30'", 'commands: False', 'commands-need: MAINTAIN', 'mention-after-days: 7'].join('\n'));
  assert.deepEqual(settings, { 'status-issue': false, commands: false, 'commands-need': 'maintain', 'reporter-replies-days': 30, 'mention-after-days': 7 });
  assert.deepEqual(problems, []);
});

test('a value that cannot be used is reported and the default stays', () => {
  const bad = (line) => parseSettings(line);
  assert.deepEqual(bad('status-issue: maybe').settings['status-issue'], true);
  assert.match(bad('status-issue: maybe').problems[0], /^settings\.yml line 1: status-issue must be true or false, not "maybe"; the default \(true\) is used$/);
  for (const value of ['0', '91', '-3', '1.5', 'many']) {
    const out = bad(`reporter-replies-days: ${value}`);
    assert.equal(out.settings['reporter-replies-days'], 14, value);
    assert.match(out.problems[0], /reporter-replies-days must (be from 1 to 90|be a whole number from 1 to 90)/, value);
  }
  assert.equal(bad('reporter-replies-days: 1').settings['reporter-replies-days'], 1);
  assert.equal(bad('reporter-replies-days: 90').settings['reporter-replies-days'], 90);
  for (const value of ['-1', '91', '1.5', 'weekly']) assert.match(bad(`mention-after-days: ${value}`).problems[0], /mention-after-days must (be from 0 to 90|be a whole number from 0 to 90)/, value);
  assert.equal(bad('mention-after-days: 0').settings['mention-after-days'], 0);
  assert.equal(bad('mention-after-days: 90').settings['mention-after-days'], 90);
});

test('the role must be one that can use commands: read and made-up roles are reported, and triage stays the default', () => {
  for (const value of ['read', 'owner', 'everyone', '3']) {
    const out = parseSettings(`commands-need: ${value}`);
    assert.equal(out.settings['commands-need'], 'triage', value);
    assert.match(out.problems[0], /commands-need must be one of triage, write, maintain, admin, not/, value);
  }
  for (const value of ['triage', 'write', 'maintain', 'admin']) assert.equal(parseSettings(`commands-need: ${value}`).settings['commands-need'], value);
});

test('an unknown setting, a repeated one and a line that is not "key: value" are each reported, and nothing else changes', () => {
  const text = ['status-issue: false', 'colour: red', 'status-issue: true', 'reporter-replies-days:', '  nested: 1', '- a list item'].join('\n');
  const { settings, problems } = parseSettings(text);
  assert.equal(settings['status-issue'], false, 'the first value stays');
  assert.deepEqual(problems.map((p) => p.replace(/^settings\.yml line (\d+):.*$/, 'line $1')), ['line 2', 'line 3', 'line 4', 'line 5', 'line 6']);
  assert.match(problems[0], /unknown setting "colour" \(ignored\)/);
  assert.match(problems[1], /"status-issue" is set twice; the first value stays/);
  assert.match(problems[3], /only flat "key: value" lines are supported/);
});

test('check-deployment turns the problems into warnings, and says nothing about a missing file', () => {
  assert.deepEqual(checkSettings(null), []);
  assert.deepEqual(checkSettings('status-issue: true\n'), []);
  assert.equal(checkSettings('status-issue: sometimes\ncolour: red\n').length, 2);
});

test('the starter file parses without a problem to exactly the defaults, and documents every setting', () => {
  const starter = fs.readFileSync(path.join(ROOT, 'shared/settings.yml'), 'utf8');
  assert.deepEqual(parseSettings(starter), { settings: DEFAULTS, problems: [] });
  for (const [key, spec] of Object.entries(SCHEMA)) {
    assert.match(starter, new RegExp(`^# ${key}: .*default: ${String(spec.default).replace(/[()]/g, '\\$&')}`, 'm'), `${key} has its documented line with the default`);
    assert.match(starter, new RegExp(`^${key}: ${spec.default}$`, 'm'), `${key} has its line with the default`);
    const doc = starter.split(new RegExp(`^# ${key}: .*$`, 'm'))[1].split(/^[a-z-]+: /m)[0];
    assert.ok(doc.split('\n').filter((l) => l.startsWith('#   ')).length >= 3, `${key} is explained in at least three lines`);
  }
});

test('the starter file says that the pause is not a setting, and how to pause', () => {
  const starter = fs.readFileSync(path.join(ROOT, 'shared/settings.yml'), 'utf8');
  assert.match(starter, /NOT HERE: the pause switch\. A gate must be able to check it without starting a run, and only a repository\n# variable can be read that way\./);
  assert.match(starter, /create the repository variable CONCIERGE_PAUSED with the\n# value true/);
  assert.ok(!('CONCIERGE_PAUSED' in SCHEMA) && !('paused' in SCHEMA));
});

test('the starter file explains what mention-after-days does, who it names, how often, and when it stays quiet', () => {
  const starter = fs.readFileSync(path.join(ROOT, 'shared/settings.yml'), 'utf8');
  const doc = starter.split(/^# mention-after-days: .*$/m)[1].split(/^mention-after-days: /m)[0];
  for (const phrase of ['people who have the maintain or admin role', 'a comment on the status issue', 'At most one such comment per this many days', 'the previous one is deleted', 'twenty people', 'titles in it are written so that they mention nobody', 'needs a token that may list', '0 turns it off', 'Nothing is mentioned while the Concierge is paused']) {
    assert.ok(doc.replace(/\n#\s+/g, ' ').includes(phrase), phrase);
  }
});

test('the starter file says where it goes, that it is optional and that it is read from the default branch', () => {
  const starter = fs.readFileSync(path.join(ROOT, 'shared/settings.yml'), 'utf8');
  assert.match(starter, /Copy this file to \.github\/issue-concierge\/settings\.yml\. It is optional/);
  assert.match(starter, /The Concierge reads the file from the default branch, so a change takes effect when it is merged/);
  assert.equal(SETTINGS_PATH, '.github/issue-concierge/settings.yml');
});
