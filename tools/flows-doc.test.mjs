import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenarios } from './e2e/run.mjs';

// docs/flows.md lists what the Concierge does: the flows, and the workflows that carry them out. docs/e2e.md numbers the live
// scenarios, and the README lists the flows and the files. A list that is written by hand goes stale (the README tree had lost
// three workflows, two scripts, five shared files and three documents), so these tests read the real files and make every
// list agree with them and with each other.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const files = (dir, keep = () => true) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => fs.statSync(path.join(ROOT, dir, f)).isFile() && keep(f)).sort();

const section = (md, heading) => {
  const at = md.indexOf(`\n## ${heading}\n`);
  assert.ok(at >= 0, `"${heading}" section not found`);
  return md.slice(at + 1).split(/\n## /)[0];
};
/** The rows of the first table of a section, as arrays of trimmed cells, without the header. */
const rowsOf = (md, heading) => {
  const lines = section(md, heading).split('\n').filter((l) => l.startsWith('|'));
  assert.ok(lines.length > 2, `no table in "${heading}"`);
  return lines.slice(2).map((l) => l.replace(/^\|\s*/, '').replace(/\s*\|\s*$/, '').split(/\s+\|\s+/).map((c) => c.trim()));
};
const numbers = (cell) => (/^none$/i.test(cell.trim()) ? [] : cell.split(',').map((n) => Number(n.trim())));
const codes = (cell) => (cell.trim() === 'all' ? 'all' : cell.split(',').map((c) => c.trim()));

const flowsMd = read('docs/flows.md');
const e2eMd = read('docs/e2e.md');
const readme = read('README.md');
const flows = rowsOf(flowsMd, 'Flows').map(([n, name, what, workflows, scenarios]) => ({ n: Number(n), name, what, workflows: codes(workflows), scenarios: numbers(scenarios) }));
const workflows = rowsOf(flowsMd, 'Workflows').map(([code, name, file, kind, when, flowCell]) => ({ code, name, file: file.replace(/`/g, ''), kind, when, flows: numbers(flowCell) }));
const scenarios = loadScenarios();

// ------------------------------------------------------------------ the flows

test('the flows are numbered 1, 2, 3 ... without gaps, each with a name and a description', () => {
  assert.deepEqual(flows.map((f) => f.n), flows.map((_, i) => i + 1));
  for (const f of flows) {
    assert.ok(f.name.length > 3 && f.what.length > 40, `flow ${f.n} needs a name and a description`);
    assert.doesNotMatch(f.what, /\bcurrently\b|\bnow\b|\blatest\b/i, `flow ${f.n}: write what stays true, not what is true today`);
  }
});

test('the README lists the same flows, in the same order, under "What it does"', () => {
  const listed = section(readme, 'What it does').split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\. /, ''));
  assert.deepEqual(listed, flows.map((f) => f.name));
  const numberedFrom1 = section(readme, 'What it does').split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => Number(l.match(/^(\d+)\./)[1]));
  assert.deepEqual(numberedFrom1, flows.map((f) => f.n), 'the README numbers are the flow numbers');
  assert.match(readme, /\(docs\/flows\.md\)/, 'the README links to the page');
});

// ------------------------------------------------------------------ the workflows

test('every workflow file has one row, with its own code and name, its kind, and in the order the workflows run', () => {
  const onDisk = files('workflows');
  assert.deepEqual(workflows.map((w) => w.file).sort(), onDisk, 'the table lists exactly the files of workflows/');
  for (const w of workflows) {
    const name = read(`workflows/${w.file}`).match(/^name: "?(.*?)"?\s*$/m)[1];
    assert.equal(`Concierge ${w.code} ${w.name}`.replace(' ▸ ', ' '), name.replace(' ▸ ', ' '), `${w.file}: code and name`);
    assert.equal(name.includes('▸'), /by hand/.test(w.when), `${w.file}: "▸" in the name means that it can be started by hand, and the row must say so`);
    assert.equal(w.kind, w.file.endsWith('.md') ? 'model' : 'plain', `${w.file}: kind`);
  }
  const order = workflows.map((w) => w.code);
  assert.deepEqual(order, [...order].sort(), 'rows are in run order');
  assert.equal(new Set(order).size, order.length, 'codes are unique');
});

test('flows and workflows name each other: a flow lists the workflows it uses and each of those lists the flow', () => {
  const byCode = new Map(workflows.map((w) => [w.code, w]));
  for (const f of flows) {
    if (f.workflows === 'all') continue;
    for (const c of f.workflows) {
      assert.ok(byCode.has(c), `flow ${f.n} names workflow ${c}, which does not exist`);
      assert.ok(byCode.get(c).flows.includes(f.n), `flow ${f.n} uses ${c}, but the row of ${c} does not list flow ${f.n}`);
    }
  }
  for (const w of workflows) {
    for (const n of w.flows) {
      const flow = flows.find((f) => f.n === n);
      assert.ok(flow, `${w.code} lists flow ${n}, which does not exist`);
      assert.notEqual(flow.workflows, 'all', `${w.code} lists flow ${n}, which is carried by every workflow and has no row`);
      assert.ok(flow.workflows.includes(w.code), `${w.code} lists flow ${n}, but flow ${n} does not list ${w.code}`);
    }
    assert.ok(w.flows.length > 0, `${w.code} serves no flow`);
  }
  assert.deepEqual(flows.filter((f) => f.workflows === 'all').map((f) => f.n), [8, 15], 'the opt-out and the pause are the cross-cutting flows');
});

// ------------------------------------------------------------------ the scenarios

test('every scenario number in the flows exists, and every scenario tests at least one flow', () => {
  const known = new Set(scenarios.map((s) => s.number));
  const tested = new Set();
  for (const f of flows) for (const n of f.scenarios) {
    assert.ok(known.has(n), `flow ${f.n} names scenario ${n}, which does not exist`);
    tested.add(n);
  }
  assert.deepEqual([...known].filter((n) => !tested.has(n)), [], 'a scenario that no flow names tests nothing the docs say');
});

test('docs/e2e.md numbers the scenarios as their files do, and names the same flows as docs/flows.md', () => {
  const rows = rowsOf(e2eMd, 'The scenarios').map(([n, name, flowCell]) => ({ n: Number(n), id: name.replace(/`/g, ''), flows: numbers(flowCell) }));
  assert.deepEqual(rows.map((r) => [r.n, r.id]), scenarios.map((s) => [s.number, s.id]), 'same numbers, same names, same order as tools/e2e/scenarios');
  for (const r of rows) {
    const fromFlows = flows.filter((f) => f.scenarios.includes(r.n)).map((f) => f.n);
    assert.deepEqual(r.flows, fromFlows, `scenario ${r.n}: the flows in e2e.md and the scenarios in flows.md disagree`);
  }
});

// ------------------------------------------------------------------ the README tree

test('the README structure lists every file of workflows/, scripts/, shared/ and docs/, and nothing that does not exist', () => {
  const tree = readme.split('\n## Structure\n')[1].split('\n## ')[0];
  const listed = new Set([...tree.matchAll(/[A-Za-z0-9._-]+\.(?:md|yml|mjs|json)/g)].map((m) => m[0]));
  const expected = [
    ...files('workflows'),
    ...files('scripts', (f) => !f.endsWith('.test.mjs')),
    ...files('shared'),
    ...files('docs', (f) => f.endsWith('.md')),
  ];
  assert.deepEqual(expected.filter((f) => !listed.has(f)), [], 'files on disk that the tree leaves out');
  const everything = new Set([...expected, 'README.md', 'AGENTS.md', 'CLAUDE.md', 'CHANGELOG.md', 'aw.yml', 'requirements.json']);
  assert.deepEqual([...listed].filter((f) => !everything.has(f)), [], 'files in the tree that do not exist');
});

// ------------------------------------------------------------------ links

test('the links of docs/flows.md point at files that exist', () => {
  const links = [...flowsMd.matchAll(/\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g)].map((m) => m[1]).filter((l) => !/^https?:/.test(l));
  assert.ok(links.length >= 8);
  for (const l of links) assert.ok(fs.existsSync(path.join(ROOT, 'docs', l)), `docs/flows.md links to ${l}, which does not exist`);
});
