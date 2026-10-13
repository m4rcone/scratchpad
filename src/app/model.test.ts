import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compactCount,
  fold,
  groupByDay,
  isArchive,
  isBackupFile,
  isTextFile,
  matches,
  slugOf,
  snippetOf,
  titleOf,
  tokenEstimate,
  wordCount,
} from './model.ts';
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

test('only markdown and plain text files are taken in a drop', () => {
  assert.ok(isTextFile('notes.md'));
  assert.ok(isTextFile('NOTES.MD'));
  assert.ok(isTextFile('spec.markdown'));
  assert.ok(isTextFile('log.txt'));
  assert.ok(!isTextFile('photo.png'));
  assert.ok(!isTextFile('md'));
  assert.ok(!isTextFile('archive.md.zip'));
});

test('tokens are estimated at four characters each, rounded up', () => {
  assert.equal(tokenEstimate(''), 0);
  assert.equal(tokenEstimate('   '), 0);
  assert.equal(tokenEstimate('abcde'), 2);
});

test('counts stay short enough for the footer', () => {
  assert.equal(compactCount(999), '999');
  assert.equal(compactCount(1000), '1k');
  assert.equal(compactCount(1949), '1.9k');
  assert.equal(compactCount(12400), '12k');
});

test('a backup is a .json file; a zip of notes opens as drafts', () => {
  assert.ok(isBackupFile('scratchpad-backup-2026-10-13.json'));
  assert.ok(!isBackupFile('notes.md'));
  assert.ok(isArchive('scratchpad-markdown-2026-10-12.zip'));
  assert.ok(isArchive('NOTES.ZIP'));
  assert.ok(!isArchive('notes.md'));
});

test('search ignores accents and case, both ways', () => {
  assert.ok(matches(draft({ text: 'Teste de título' }), 'titulo'));
  assert.ok(matches(draft({ text: 'teste de titulo' }), 'TÍTULO'));
  assert.ok(matches(draft({ text: 'ação e reação' }), 'acao'));
  assert.ok(!matches(draft({ text: 'título' }), 'titulos'));
});

test('folding keeps where each character came from', () => {
  const { text, at } = fold('Ação');
  assert.equal(text, 'acao');
  assert.deepEqual(at, [0, 1, 2, 3, 4]);
  // A decomposed accent is a character of its own in the original.
  assert.deepEqual(fold('éx'), { text: 'ex', at: [0, 2, 3] });
});

test('the snippet centres on an accented match too', () => {
  const text = 'a'.repeat(60) + ' título ' + 'b'.repeat(60);
  assert.ok(snippetOf(text, 'titulo').includes('título'));
});

test('the filter, the snippet and the marks fold a query the same way', () => {
  // Lowered whole, 'ΟΔΟΣ' ends in a final 'ς'; a character at a time, in 'σ'.
  const text = 'a'.repeat(90) + ' ΟΔΟΣ';
  assert.ok(matches(draft({ text }), 'ΟΔΟΣ'));
  assert.ok(snippetOf(text, 'ΟΔΟΣ').includes('ΟΔΟΣ'));
  // Spaces around a query are not part of it, here or in the marks.
  assert.ok(matches(draft({ text: 'foo.' }), 'foo '));
  assert.ok(snippetOf('b'.repeat(90) + ' foo.', 'foo ').includes('foo'));
});
