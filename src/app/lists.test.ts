import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseRepeatedMarker, outdentEmptyItem } from './lists.ts';

test('a marker typed again after enter wrote it is folded back into one', () => {
  assert.equal(collapseRepeatedMarker('- - '), '- ');
  assert.equal(collapseRepeatedMarker('  * - '), '  * ');
  assert.equal(collapseRepeatedMarker('2. 2. '), '2. ');
  assert.equal(collapseRepeatedMarker('3) 1. '), '3) ');
  assert.equal(collapseRepeatedMarker('> - - '), '> - ');
});

test('a task box typed again keeps the one typed', () => {
  assert.equal(collapseRepeatedMarker('- [ ] - '), '- [ ] ');
  assert.equal(collapseRepeatedMarker('- [ ] [ ] '), '- [ ] ');
  assert.equal(collapseRepeatedMarker('- [ ] [x] '), '- [x] ');
});

test('anything with words in it is left as it is', () => {
  assert.equal(collapseRepeatedMarker('- - item'), null);
  assert.equal(collapseRepeatedMarker('- item - '), null);
  assert.equal(collapseRepeatedMarker('- '), null);
  assert.equal(collapseRepeatedMarker('2023. 1. '), '2023. ');
});

test('enter on an empty nested item steps out one level', () => {
  const lines = ['- one', '  - nested', '  - '];
  assert.equal(outdentEmptyItem(lines, 2), '- ');
});

test('a numbered parent gives the number after its own', () => {
  const lines = ['1. one', '2. two', '   - nested', '   - '];
  assert.equal(outdentEmptyItem(lines, 3), '3. ');
});

test('a task parent gives a fresh task box', () => {
  const lines = ['- [x] done', '  - [ ] sub', '  - [ ] '];
  assert.equal(outdentEmptyItem(lines, 2), '- [ ] ');
});

test('three levels step out to the middle one, not the top', () => {
  const lines = ['- a', '  - b', '    - c', '    - '];
  assert.equal(outdentEmptyItem(lines, 3), '  - ');
});

test('inside a quote the quote stays', () => {
  const lines = ['> - a', '>   - b', '>   - '];
  assert.equal(outdentEmptyItem(lines, 2), '> - ');
});

test('a top-level empty item, or one with no parent, is left to enter', () => {
  assert.equal(outdentEmptyItem(['- a', '- '], 1), null);
  assert.equal(outdentEmptyItem(['text', '  - '], 1), null);
  assert.equal(outdentEmptyItem(['- a', '  - b', '  - c'], 2), null);
});
