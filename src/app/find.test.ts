import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAll, matchFrom, step } from './find.ts';

test('any case by default; match case asks for the exact one', () => {
  assert.deepEqual(findAll('Todo todo TODO', 'todo'), [
    { from: 0, to: 4 },
    { from: 5, to: 9 },
    { from: 10, to: 14 },
  ]);
  assert.deepEqual(findAll('Todo todo TODO', 'TODO'), findAll('Todo todo TODO', 'todo'));
  assert.deepEqual(findAll('Todo todo TODO', 'TODO', true), [{ from: 10, to: 14 }]);
});

test('matches do not overlap, and an empty query finds nothing', () => {
  assert.deepEqual(findAll('aaaa', 'aa'), [
    { from: 0, to: 2 },
    { from: 2, to: 4 },
  ]);
  assert.deepEqual(findAll('abc', ''), []);
});

test('a character that grows when lowered does not shift the offsets', () => {
  // 'İ' lowers to two code units; folding the text would move 'x' by one.
  const text = 'İ x';
  const [match] = findAll(text, 'x');
  assert.equal(text.slice(match!.from, match!.to), 'x');
});

test('a character that grows when lowered does not make the search case-sensitive', () => {
  const text = 'İstanbul, Foo and foo';
  const found = findAll(text, 'foo').map((match) => text.slice(match.from, match.to));
  assert.deepEqual(found, ['Foo', 'foo']);
  // A match is always whole characters of the original, never half of one.
  const [dotted] = findAll(text, 'i');
  assert.equal(text.slice(dotted!.from, dotted!.to), 'İ');
});

test('find stands on the first match at or after the caret, wrapping', () => {
  const matches = findAll('a b a b a', 'a');
  assert.equal(matchFrom(matches, 0), 0);
  assert.equal(matchFrom(matches, 1), 1);
  assert.equal(matchFrom(matches, 9), 0);
  assert.equal(matchFrom([], 0), -1);
});

test('stepping wraps at both ends', () => {
  assert.equal(step(2, 1, 3), 0);
  assert.equal(step(0, -1, 3), 2);
  assert.equal(step(0, 1, 0), -1);
});
