import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markMatches, withKey } from './html.ts';

test('every match is marked, in any case, and the rest is escaped', () => {
  assert.equal(
    markMatches('Mermaid <b> and mermaid', 'mermaid'),
    '<mark>Mermaid</mark> &lt;b&gt; and <mark>mermaid</mark>',
  );
});

test('a query that would need escaping is matched as text', () => {
  assert.equal(markMatches('a < b', '<'), 'a <mark>&lt;</mark> b');
});

test('no query, no marks', () => {
  assert.equal(markMatches('a & b', '  '), 'a &amp; b');
});

test('a key goes in front of the words it stands for, or is left out', () => {
  assert.equal(
    withKey('esc', 'close'),
    '<span class="key-hint"><kbd>esc</kbd>close</span>',
  );
  assert.equal(withKey('', 'close'), 'close');
});

test('a match is marked in the original text, accents and all', () => {
  assert.equal(markMatches('Teste de Título', 'titulo'), 'Teste de <mark>Título</mark>');
  assert.equal(markMatches('ação, acao', 'ação'), '<mark>ação</mark>, <mark>acao</mark>');
});
