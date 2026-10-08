import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Draft, DraftStore, Prefs, PrefsStore } from '../storage/types.ts';

// `createStore` schedules its saves through `window.setTimeout`. Nothing here
// waits for one, so the stub only has to exist; the localStorage mirror is
// already wrapped in try/catch and simply no-ops outside a browser.
(globalThis as { window?: unknown }).window = globalThis;

// The mirror, on the other hand, is the point of some of what is below, so it
// gets a real enough stand-in for the browser's.
const mirrored = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => mirrored.get(key) ?? null,
  setItem: (key: string, value: string) => void mirrored.set(key, value),
  removeItem: (key: string) => void mirrored.delete(key),
};
const PENDING_KEY = 'scratchpad.pending.v1';
const pending = (): Draft[] => JSON.parse(mirrored.get(PENDING_KEY) ?? '[]') as Draft[];

const { createStore } = await import('./store.ts');

// The mirror outlives the tab it was written in — that is its whole job — so
// between tests it has to be swept, or one test's unsaved draft is adopted by
// the next one's boot.
beforeEach(() => mirrored.clear());

/** A disk that answers only when the test says so. */
function slowDisk(stored: Draft[]) {
  let release!: () => void;
  const answered = new Promise<void>((resolve) => (release = resolve));
  const disk: DraftStore = {
    async all() {
      await answered;
      return stored;
    },
    async put() {},
    async remove() {},
  };
  return { disk, release };
}

const noPrefs: PrefsStore = {
  async read(): Promise<Partial<Prefs>> {
    return {};
  },
  async write() {},
};

const draft = (over: Partial<Draft>): Draft => ({
  id: 'stored',
  text: 'what was on the disk',
  createdAt: 0,
  updatedAt: 0,
  schemaVersion: 1,
  ...over,
});

test('text written while the disk is still answering becomes its own draft', async () => {
  const { disk, release } = slowDisk([draft({})]);
  const store = createStore(disk, noPrefs, 'system');

  // The editor is empty when the load starts, and the writer types into it
  // while IndexedDB is still out. `write` has no active draft to put that in,
  // so the editor is the only place it lives — which is why `load` takes a
  // getter and reads it at the end rather than a string captured at the start.
  let inTheEditor = '';
  const loading = store.load(() => inTheEditor);
  inTheEditor = 'a first sentence';

  release();
  const active = await loading;

  assert.equal(active?.text, 'a first sentence');
  assert.equal(store.state.activeId, active?.id);
  assert.equal(store.state.drafts.length, 2, 'the stored draft is kept too');
  assert.ok(
    store.state.drafts.some((d) => d.text === 'what was on the disk'),
    'the disk is not thrown away either',
  );
});

test('an untouched editor opens the draft that was on the disk', async () => {
  const { disk, release } = slowDisk([draft({})]);
  const store = createStore(disk, noPrefs, 'system');

  const loading = store.load(() => '');
  release();
  const active = await loading;

  assert.equal(active?.id, 'stored');
  assert.equal(store.state.drafts.length, 1);
});

test('an empty disk and an empty editor still open one draft', async () => {
  const { disk, release } = slowDisk([]);
  const store = createStore(disk, noPrefs, 'system');

  const loading = store.load(() => '');
  release();
  const active = await loading;

  assert.equal(active?.text, '');
  assert.equal(store.state.drafts.length, 1);
});

/** A disk that answers at once, recording what it was asked to write. */
function disk(stored: Draft[], put: (draft: Draft) => Promise<void> = async () => {}) {
  const written: { id: string; text: string }[] = [];
  const store: DraftStore = {
    async all() {
      return stored;
    },
    async put(draft) {
      await put(draft);
      written.push({ id: draft.id, text: draft.text });
    },
    async remove() {},
  };
  return { store, written };
}

test('a draft left inside the debounce is still written', async () => {
  const { store: d, written } = disk([draft({})]);
  const store = createStore(d, noPrefs, 'system');
  await store.load(() => '');
  store.open('stored');

  store.write('a sentence worth keeping', 24);
  // Before the debounce is up, the writer presses the new-draft chord. That
  // schedules a save for a *different* draft; one pending slot meant this was
  // where the sentence above stopped existing.
  store.create();
  await store.flush();

  assert.ok(
    written.some((entry) => entry.text === 'a sentence worth keeping'),
    'the draft being left is written',
  );
  assert.equal(written.length, 2, 'and so is the one that replaced it');
  assert.deepEqual(pending(), [], 'nothing is left in the mirror');
});

test('a write that fails stays pending and is tried again', async () => {
  let failing = true;
  const { store: d, written } = disk([draft({})], async () => {
    if (failing) throw new Error('quota exceeded');
  });
  const store = createStore(d, noPrefs, 'system');
  await store.load(() => '');

  store.write('what the disk refused', 21);
  await store.flush();
  assert.equal(written.length, 0, 'nothing landed');
  assert.equal(pending()[0]?.text, 'what the disk refused', 'so the mirror holds on');

  failing = false;
  await store.flush();
  assert.equal(written[0]?.text, 'what the disk refused', 'the retry lands');
  assert.deepEqual(pending(), [], 'and only then is the mirror let go');
});

test('a keystroke during the write is not erased from the mirror', async () => {
  let release!: () => void;
  const inFlight = new Promise<void>((resolve) => (release = resolve));
  const { store: d } = disk([draft({})], () => inFlight);
  const store = createStore(d, noPrefs, 'system');
  await store.load(() => '');

  store.write('first', 5);
  const flushing = store.flush();
  // The put copied the draft as it was; this lands after that copy.
  store.write('first and second', 16);
  release();
  await flushing;

  assert.equal(
    pending()[0]?.text,
    'first and second',
    'the newer text survives the older write finishing',
  );
});

test('a mirror written in the older single-draft shape is still recovered', async () => {
  mirrored.set(
    PENDING_KEY,
    JSON.stringify(
      draft({ id: 'stored', text: 'typed just before the upgrade', updatedAt: 9 }),
    ),
  );
  const { store: d } = disk([draft({ updatedAt: 1 })]);
  const store = createStore(d, noPrefs, 'system');

  const active = await store.load(() => '');

  assert.equal(active?.text, 'typed just before the upgrade');
  assert.equal(store.state.drafts.length, 1, 'it replaces the older copy, not joins it');
});

test('each view button switches back to writing, or straight to its view', async () => {
  const { disk, release } = slowDisk([draft({})]);
  const store = createStore(disk, noPrefs, 'system');
  release();
  await store.load(() => '');

  store.toggleMode('read');
  assert.equal(store.state.mode, 'read');
  store.toggleMode('split');
  assert.equal(store.state.mode, 'split');
  store.toggleMode('split');
  assert.equal(store.state.mode, 'write');
  store.toggleMode('read');
  store.toggleMode('read');
  assert.equal(store.state.mode, 'write');
});

test('the footer can say "saved" only once the text has landed', async () => {
  const { store: d } = disk([draft({})]);
  const store = createStore(d, noPrefs, 'system');
  await store.load(() => '');

  store.moveCaret(3);
  assert.equal(store.state.saving, false, 'a caret move is not unsaved text');

  store.write('something new', 13);
  assert.equal(store.state.saving, true);
  await store.flush();
  assert.equal(store.state.saving, false);
});

test('a deleted draft comes back where it was, and the disk gets it again', async () => {
  const removed: string[] = [];
  const { store: d, written } = disk([
    draft({ id: 'newer', text: 'newer', updatedAt: 2 }),
    draft({ id: 'older', text: 'older', updatedAt: 1 }),
  ]);
  d.remove = async (id) => void removed.push(id);
  const store = createStore(d, noPrefs, 'system');
  await store.load(() => '');

  await store.remove();
  assert.deepEqual(removed, ['newer']);
  assert.equal(store.state.activeId, 'older');
  assert.equal(store.state.deleted, true);

  assert.equal(store.undoRemove(), true);
  assert.equal(store.state.activeId, 'newer');
  assert.deepEqual(
    store.state.drafts.map((d) => d.id),
    ['newer', 'older'],
  );
  assert.equal(store.state.deleted, false);
  await store.flush();
  assert.ok(written.some((entry) => entry.id === 'newer'));
  assert.equal(store.undoRemove(), false, 'and only once');
});

test('undoing the only draft drops the empty one that replaced it', async () => {
  const { store: d } = disk([draft({ text: 'the only one' })]);
  const store = createStore(d, noPrefs, 'system');
  await store.load(() => '');

  await store.remove();
  assert.equal(store.state.drafts.length, 1);
  assert.notEqual(store.state.activeId, 'stored');

  store.undoRemove();
  assert.deepEqual(
    store.state.drafts.map((d) => d.id),
    ['stored'],
  );
});

test('an empty draft is deleted without an offer to bring it back', async () => {
  const { store: d } = disk([draft({ text: '  \n' })]);
  const store = createStore(d, noPrefs, 'system');
  await store.load(() => '');

  await store.remove();
  assert.equal(store.state.deleted, false);
  assert.equal(store.undoRemove(), false);
});

test('deleting a draft with text asks first, and can still be undone after', async () => {
  const { store: d } = disk([draft({ text: 'worth keeping' })]);
  const store = createStore(d, noPrefs, 'system');
  await store.load(() => '');

  assert.equal(store.requestDelete(), 'confirm');
  assert.equal(store.state.pendingDelete, true);
  assert.equal(store.state.drafts[0]?.id, 'stored', 'nothing is gone yet');

  store.cancelDelete();
  assert.equal(store.state.pendingDelete, false);

  store.requestDelete();
  assert.equal(store.requestDelete(), 'deleted');
  assert.equal(store.state.pendingDelete, false);
  assert.equal(store.state.deleted, true);
  assert.ok(!store.state.drafts.some((d) => d.id === 'stored'));
});
