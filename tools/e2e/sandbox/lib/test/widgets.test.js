import test from 'node:test';
import assert from 'node:assert/strict';
import { listWidgets } from '../src/widgets.js';

test('sorts by name, ignoring case', () => {
  const widgets = [{ name: 'beta' }, { name: 'Alpha' }, { name: 'gamma' }];
  assert.deepEqual(listWidgets(widgets).map((w) => w.name), ['Alpha', 'beta', 'gamma']);
});

test('does not change the input', () => {
  const widgets = [{ name: 'b' }, { name: 'a' }];
  listWidgets(widgets);
  assert.deepEqual(widgets.map((w) => w.name), ['b', 'a']);
});
