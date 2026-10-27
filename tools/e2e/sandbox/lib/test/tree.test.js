import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenTree } from '../src/tree.js';

test('lists a parent before its children, depth first', () => {
  const tree = { id: 'a', children: [{ id: 'b', children: [{ id: 'c' }] }, { id: 'd' }] };
  assert.deepEqual(flattenTree(tree), ['a', 'b', 'c', 'd']);
});

test('a node without children is listed alone', () => {
  assert.deepEqual(flattenTree({ id: 'a' }), ['a']);
});

test('a node under two parents is listed once, under the first', () => {
  const shared = { id: 's' };
  const tree = { id: 'a', children: [{ id: 'b', children: [shared] }, { id: 'c', children: [shared] }] };
  assert.deepEqual(flattenTree(tree), ['a', 'b', 's', 'c']);
});
