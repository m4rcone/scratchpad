import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backupName,
  backupLabel,
  draftsFromArchive,
  exportName,
  markdownEntries,
  readBackup,
  writeBackup,
} from './backup.ts';
import type { Draft } from '../storage/types.ts';

const draft = (over: Partial<Draft>): Draft => ({
  id: 'x',
  text: '',
  createdAt: 1,
  updatedAt: 2,
  schemaVersion: 1,
  ...over,
});

test('the backup line shows the date of the last one, never a warning', () => {
  const at = new Date(2026, 9, 13, 15).getTime();
  const drafts = [draft({ text: 'kept' })];
  const date = new Date(at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  assert.equal(backupLabel(at, drafts), `last backup ${date}`);
  assert.equal(backupLabel(null, drafts), 'no backup yet');
  assert.equal(backupLabel(null, [draft({ text: '  ' })]), null, 'nothing to back up');
});

test('files are named after the day', () => {
  const day = new Date(2026, 9, 2).getTime();
  assert.equal(backupName(day), 'scratchpad-backup-2026-10-02.json');
  assert.equal(exportName(day), 'scratchpad-markdown-2026-10-02.zip');
});

test('a backup comes back whole: ids, dates, caret and reading place', () => {
  const drafts = [
    draft({
      id: 'a',
      text: 'alpha',
      createdAt: 10,
      updatedAt: 20,
      caret: 3,
      scroll: 0.5,
    }),
    draft({ id: 'b', text: 'beta', createdAt: 30, updatedAt: 40 }),
  ];
  const backup = readBackup(writeBackup(drafts, 99));
  assert.equal(backup.createdAt, 99);
  assert.deepEqual(backup.drafts, drafts);
});

test('a date in the future is taken as the time of the restore', () => {
  const file = writeBackup([
    draft({ id: 'a', text: 'alpha', createdAt: 4102444800000, updatedAt: 4102444800000 }),
  ]);
  const [restored] = readBackup(file, 1000).drafts;
  assert.equal(restored?.updatedAt, 1000);
  assert.equal(restored?.createdAt, 1000);
});

test('empty drafts are left out of a backup', () => {
  const backup = readBackup(
    writeBackup([draft({ id: 'a', text: '  ' }), draft({ id: 'b', text: 'b' })]),
  );
  assert.deepEqual(
    backup.drafts.map((d) => d.id),
    ['b'],
  );
});

test('a file that is not a backup is refused, a broken draft skipped', () => {
  assert.throws(() => readBackup('not json'));
  assert.throws(() => readBackup('{"drafts": []}'));
  assert.throws(() => readBackup('[1, 2]'));
  const backup = readBackup(
    JSON.stringify({
      app: 'scratchpad',
      kind: 'backup',
      version: 1,
      createdAt: 1,
      drafts: [
        { id: 'ok', text: 't', createdAt: 1, updatedAt: 2 },
        { id: 'no text' },
        { id: '"><b>x</b>', text: 'markup in the id', createdAt: 1, updatedAt: 2 },
        null,
      ],
    }),
  );
  assert.deepEqual(
    backup.drafts.map((d) => d.id),
    ['ok'],
  );
});

test('the Markdown export names each file by its title and dates it', () => {
  const entries = markdownEntries([
    draft({ id: 'a', text: '# Plan\none', updatedAt: 5000 }),
    draft({ id: 'b', text: '# Plan\ntwo' }),
    draft({ id: 'c', text: '   ' }),
  ]);
  assert.deepEqual(
    entries.map((entry) => [entry.name, entry.modified]),
    [
      ['plan.md', 5000],
      ['plan-2.md', 2],
    ],
  );
});

test('a zip of notes opens its text files as drafts dated by each file', () => {
  const drafts = draftsFromArchive(
    [
      { name: 'notes/a.md', text: 'one\r\ntwo', modified: 100 },
      { name: 'b.txt', text: 'three', modified: 5000 },
      { name: 'photo.png', text: '…' },
      { name: 'blank.md', text: '\n' },
    ],
    1000,
  );
  assert.deepEqual(
    drafts.map((d) => [d.text, d.createdAt, d.updatedAt]),
    [
      ['one\ntwo', 100, 100],
      ['three', 1000, 1000],
    ],
    'a date in the future is taken as now',
  );
});
