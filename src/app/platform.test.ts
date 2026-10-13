import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatChord, shortcutKey } from './platform.ts';

test("ByteMD's chords read like the app's own on a Mac", () => {
  assert.equal(formatChord('Cmd-B', true), '⌘B');
  assert.equal(formatChord('Cmd-Shift-C', true), '⌘⇧C');
  assert.equal(formatChord('Cmd-Alt-K', true), '⌘⌥K');
});

test('modifiers come in one order, whatever order they were written in', () => {
  assert.equal(formatChord('Shift-Cmd-K', true), '⌘⇧K');
  assert.equal(formatChord('Shift-Ctrl-K', false), 'Ctrl+Shift+K');
});

test('and elsewhere, with plus signs', () => {
  assert.equal(formatChord('Ctrl-Shift-C', false), 'Ctrl+Shift+C');
  assert.equal(formatChord('Mod-B', false), 'Ctrl+B');
});

test('a chord ending in a dash keeps it as the key', () => {
  assert.equal(formatChord('Cmd--', true), '⌘-');
});

test('a shortcut is the letter the layout prints, where it prints a Latin one', () => {
  assert.equal(shortcutKey({ key: 'F', code: 'KeyF' }), 'f');
  // AZERTY: the key in QWERTY's A place prints Q, and Q is what it means.
  assert.equal(shortcutKey({ key: 'q', code: 'KeyA' }), 'q');
});

test('on a layout with no Latin letters, the place on the board decides', () => {
  assert.equal(shortcutKey({ key: 'а', code: 'KeyF' }), 'f');
  assert.equal(shortcutKey({ key: 'ש', code: 'KeyA' }), 'a');
});

test('keys that are not letters pass through as they are', () => {
  assert.equal(shortcutKey({ key: '/', code: 'Slash' }), '/');
  assert.equal(shortcutKey({ key: 'Escape', code: 'Escape' }), 'escape');
});
