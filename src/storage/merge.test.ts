import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasNewerName, hasNewerText, mergeDraft, renamedLater } from './merge.ts';
import type { Draft } from './types.ts';

const draft = (over: Partial<Draft>): Draft => ({
  id: 'd',
  text: 'text',
  createdAt: 0,
  updatedAt: 0,
  schemaVersion: 1,
  ...over,
});

test('the text comes from the side asked for, the name from the later rename', () => {
  const here = draft({ text: 'typed here', updatedAt: 20, name: 'old', nameAt: 1 });
  const there = draft({ text: 'older text', updatedAt: 10, name: 'new', nameAt: 5 });

  const merged = mergeDraft(here, there, false);
  assert.equal(merged.text, 'typed here');
  assert.equal(merged.updatedAt, 20);
  assert.equal(merged.name, 'new');
  assert.equal(merged.nameAt, 5);
});

test('a name cleared later wins over a name given before', () => {
  const named = draft({ name: 'kept?', nameAt: 3 });
  const cleared = draft({ nameAt: 7 });

  const merged = mergeDraft(named, cleared, false);
  assert.equal(merged.name, undefined);
  assert.equal(merged.nameAt, 7, 'the clearing travels on, so others clear too');
});

test('neither copy renamed: no name appears out of nowhere', () => {
  const merged = mergeDraft(draft({}), draft({ text: 'newer', updatedAt: 2 }), true);
  assert.equal(merged.text, 'newer');
  assert.ok(!('name' in merged));
  assert.ok(!('nameAt' in merged));
});

test('the newer text keeps the name the older copy was given', () => {
  // One tab renames while the other types: both changes survive.
  const renamed = draft({ text: 'before', updatedAt: 1, name: 'Plan', nameAt: 9 });
  const typed = draft({ text: 'after', updatedAt: 8 });

  const merged = mergeDraft(renamed, typed, true);
  assert.equal(merged.text, 'after');
  assert.equal(merged.name, 'Plan');
});

test('neither copy is changed', () => {
  const base = draft({ name: 'a', nameAt: 1 });
  const incoming = draft({ text: 'b', updatedAt: 1, nameAt: 2 });
  mergeDraft(base, incoming, true);
  assert.equal(base.name, 'a');
  assert.equal(incoming.text, 'b');
});

test('renamedLater compares the rename clocks, a missing one as never', () => {
  assert.ok(renamedLater(draft({ nameAt: 2 }), draft({ nameAt: 1 })));
  assert.ok(renamedLater(draft({ nameAt: 1 }), draft({})));
  assert.ok(!renamedLater(draft({}), draft({})));
  assert.ok(!renamedLater(draft({ nameAt: 1 }), draft({ nameAt: 1 })));
});

test('newer text is later and different; a later copy of the same text is not', () => {
  const here = draft({ text: 'a', updatedAt: 1 });
  assert.ok(hasNewerText(here, draft({ text: 'b', updatedAt: 2 })));
  assert.ok(!hasNewerText(here, draft({ text: 'a', updatedAt: 2 })));
  assert.ok(!hasNewerText(here, draft({ text: 'b', updatedAt: 1 })));
});

test('a newer name is later and different, a clearing included', () => {
  const here = draft({ name: 'x', nameAt: 1 });
  assert.ok(hasNewerName(here, draft({ name: 'y', nameAt: 2 })));
  assert.ok(hasNewerName(here, draft({ nameAt: 2 })), 'cleared later');
  assert.ok(!hasNewerName(here, draft({ name: 'x', nameAt: 2 })), 'the same name');
  assert.ok(!hasNewerName(here, draft({ name: 'y', nameAt: 1 })), 'not later');
});
