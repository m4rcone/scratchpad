import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByDay, slugOf, snippetOf, titleOf, wordCount } from './model.ts';
import type { Draft } from '../storage/types.ts';

const draft = (over: Partial<Draft>): Draft => ({
  id: 'x',
  text: '',
  createdAt: 0,
  updatedAt: 0,
  schemaVersion: 1,
  ...over,
});

test('the title is the first non-empty line, without the marker', () => {
  assert.equal(titleOf('# a title\n\nbody'), 'a title');
  assert.equal(titleOf('\n\n  plain\n'), 'plain');
  assert.equal(titleOf('   \n'), '');
  assert.equal(titleOf('#'.repeat(3) + ' deep'), 'deep');
});

test('the title drops the block marker in front of the first line', () => {
  assert.equal(titleOf('> a quoted line'), 'a quoted line');
  assert.equal(titleOf('- a list item'), 'a list item');
  assert.equal(titleOf('3. third step'), 'third step');
  assert.equal(titleOf('- [ ] ship it'), 'ship it');
  assert.equal(titleOf('* [x] shipped'), 'shipped');
});

test('the title reads inline markup as the preview would show it', () => {
  assert.equal(titleOf('**Plan** for `parser`'), 'Plan for parser');
  assert.equal(titleOf('read [the docs](https://example.com)'), 'read the docs');
  assert.equal(titleOf('![diagram](https://example.com/a.png)'), 'diagram');
  assert.equal(titleOf('see <https://example.com>'), 'see https://example.com');
  assert.equal(titleOf('an *emphasised* word'), 'an emphasised word');
  assert.equal(titleOf('~~old~~ new'), 'old new');
});

test('the title leaves what only looks like markup alone', () => {
  assert.equal(titleOf('rename user_id to account_id'), 'rename user_id to account_id');
  assert.equal(titleOf('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(titleOf('#hashtag'), '#hashtag');
  assert.equal(titleOf('-not a list'), '-not a list');
});

test('the slug survives accents and punctuation', () => {
  assert.equal(
    slugOf('# Refatorar o parser de eventos'),
    'refatorar-o-parser-de-eventos',
  );
  assert.equal(slugOf('### ção/ão!!'), 'cao-ao');
  assert.equal(slugOf(''), 'draft');
});

test('the snippet centres on the match', () => {
  const text = 'a'.repeat(60) + ' needle ' + 'b'.repeat(60);
  const snippet = snippetOf(text, 'needle');
  assert.ok(snippet.includes('needle'));
  assert.ok(snippet.startsWith('…'));
});

test('with no query the snippet is the body, not the title again', () => {
  assert.equal(snippetOf('# Plan\n\nship the fix', ''), 'ship the fix');
  assert.equal(snippetOf('\n\n  only a title\n', ''), '');
  assert.equal(snippetOf('title\n## part two\nmore', ''), 'part two more');
});

test('word count ignores surrounding space', () => {
  assert.equal(wordCount('  one   two \n three '), 3);
  assert.equal(wordCount('   '), 0);
});

test('grouping drops empty buckets', () => {
  const now = new Date('2026-09-06T12:00:00').getTime();
  const groups = groupByDay(
    [
      draft({ id: 'a', updatedAt: now - 3600_000 }),
      draft({ id: 'b', updatedAt: now - 40 * 3600_000 }),
    ],
    now,
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    ['today', 'earlier'],
  );
});
