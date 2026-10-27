import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLines } from '../src/format.js';

test('prints one item per line with a final newline', () => {
  assert.equal(formatLines(['a', 'b']), 'a\nb\n');
});

test('prints nothing for an empty list', () => {
  assert.equal(formatLines([]), '');
});
