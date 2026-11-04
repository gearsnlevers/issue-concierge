import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// On 2026-11-04 the plan worker of frodo-cli#591 read the repository with chained shell commands. The coding agent's
// shell approves only what it can classify as read-only, and in a workflow nobody can approve the rest: the third
// command, a chain with sed and a quoted regex, was refused ("Denied, no one to approve"). The worker did not try
// another tool and wrote "I could not read the decision records", although it had read one of them and the directory
// listing. The GitHub file tool worked in the same runs. A plan triage run on frodo-lib had been refused the same way
// for a python3 one-liner over a tool result, and recovered by itself. The prompts of both gates now say how to read
// (docs/multi-phase-design.md, "Decision records", "How the gates read").
const REPO = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, REPO), 'utf8');
const prompt = (name) => read(`workflows/${name}.md`).replace(/<!--[\s\S]*?-->/g, '');
const section = (text, heading) => text.split(`\n## ${heading}\n`)[1].split('\n## ')[0];

const GATES = ['plan-worker', 'plan-triage'];

test('the plan worker and plan triage carry the same "Reading files" section, word for word', () => {
  const sections = GATES.map((name) => section(prompt(name), 'Reading files').trim());
  assert.equal(sections[0], sections[1]);
});

test('files are read with the GitHub file tool or the viewer, one call each, never with shell commands or scripts', () => {
  for (const name of GATES) {
    const reading = section(prompt(name), 'Reading files');
    assert.match(reading, /Read repository files with the GitHub file tool \(`get_file_contents`, with no `ref` argument, which reads the default branch\) or with the file viewer and the search tools, one file or one search per call\./, name);
    assert.match(reading, /Do not read, list or filter files with shell commands, do not chain commands, and do not run scripts \(`python3`, `node`\) on a tool result: the sandbox refuses a command it cannot approve as read-only, and nobody is there to approve it\./, name);
    assert.match(reading, /A long tool result that was saved to a file is read with the file viewer or the search tools\./, name);
  }
});

test('a refused or failed read is retried with the other tool, and "could not read" needs both to have failed', () => {
  for (const name of GATES) {
    const reading = section(prompt(name), 'Reading files');
    assert.match(reading, /A refused or failed read is not a missing file\. Try once more with the other tool: the GitHub file tool if you used the viewer, the viewer if you used the GitHub tool\./, name);
    assert.match(reading, /Say that you could not read a file only when both failed, and name the file and what failed\./, name);
    assert.match(reading, /If you read some of a set of files, say which ones you read; never write that the set could not be read\./, name);
  }
});

test('plan worker: an unreadable record is reported in one line under "Decisions that apply", with the records that were read', () => {
  const records = section(prompt('plan-worker'), 'Decision records');
  assert.match(records, /If you cannot read the index or a record even after the retry in "Reading files", write one line under the heading "Decisions that apply": "I could not read the decision records: <what failed>", and name the records you did read\. Do not leave the heading out for this\./);
});

test('plan worker: the section sits after the plan contents, so the "Already planned" check stays first', () => {
  const headings = [...prompt('plan-worker').matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.equal(headings[0], 'Already planned');
  assert.equal(headings[1], 'Plan contents');
  assert.equal(headings[2], 'Reading files');
});

test('the rule enables no shell and touches no gate: bash stays off and the section names no label', () => {
  for (const name of GATES) {
    const source = read(`workflows/${name}.md`);
    assert.match(source.split('\n---\n')[0], /\n {2}bash: false\n/, `${name}: bash: false`);
    assert.doesNotMatch(section(prompt(name), 'Reading files'), /plan-approval-required|plan-triage-handoff|issue-triage-handoff|plan-worker-ready|complexity\/|risk\//, name);
  }
});
