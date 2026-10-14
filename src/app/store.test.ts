import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  Draft,
  DraftEvent,
  DraftStore,
  DraftSync,
  Prefs,
  PrefsStore,
} from '../storage/types.ts';

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

test('a disk that cannot be read still opens a draft, and keeps what is typed', async () => {
  let back = false;
  const broken: DraftStore = {
    async all() {
      throw new Error('disk gone');
    },
    async put() {
      if (!back) throw new Error('disk gone');
    },
    async remove() {},
  };
  const store = createStore(broken, noPrefs, 'system');

  const active = await store.load(() => 'typed while it failed');
  assert.equal(store.state.loaded, true);
  assert.equal(store.state.loadFailed, true);
  assert.equal(active?.text, 'typed while it failed');

  // With an active draft, the next keystroke has somewhere to go: the mirror.
  store.write('typed while it failed, and more', 31);
  assert.equal(pending()[0]?.text, 'typed while it failed, and more');

  // Once the disk answers again, the retry gets it there.
  back = true;
  await store.flush();
  assert.deepEqual(pending(), []);
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
  assert.equal(store.state.saveFailed, true, 'and the footer says so until it lands');

  failing = false;
  await store.flush();
  assert.equal(written[0]?.text, 'what the disk refused', 'the retry lands');
  assert.equal(store.state.saveFailed, false);
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

test("an update's news waits until settings is opened, then goes when it closes", async () => {
  const written: Partial<Prefs>[] = [];
  const prefs: PrefsStore = {
    async read() {
      return { whatsNew: '1.1.0' };
    },
    async write(change) {
      written.push(change);
    },
  };
  const { store: d } = disk([draft({})]);
  const store = createStore(d, prefs, 'system');
  await store.load(() => '');

  assert.equal(store.state.whatsNew, '1.1.0');
  assert.deepEqual(written, [], 'kept on the disk until it is seen');

  store.setSettings(true);
  assert.deepEqual(written, [{ whatsNew: null }], 'cleared on the disk once seen');
  assert.equal(store.state.whatsNew, '1.1.0', 'still marked while the panel is open');

  store.setSettings(false);
  assert.equal(store.state.whatsNew, null);
});

/** A channel between two stores in the same test, as two tabs would share. */
function channel() {
  const handlers: ((event: DraftEvent) => void)[] = [];
  return (): DraftSync => {
    let mine: ((event: DraftEvent) => void) | null = null;
    return {
      publish(event) {
        // Cloned, as `postMessage` does, and never echoed to the sender.
        const copy = structuredClone(event);
        for (const handler of handlers) if (handler !== mine) handler(copy);
      },
      subscribe(handler) {
        mine = handler;
        handlers.push(handler);
      },
    };
  };
}

test("another tab's newer text replaces the open draft, keeping this caret", async () => {
  const tab = channel();
  const a = createStore(disk([draft({ text: 'old' })]).store, noPrefs, 'system', tab());
  const b = createStore(disk([draft({ text: 'old' })]).store, noPrefs, 'system', tab());
  await a.load(() => '');
  await b.load(() => '');
  b.moveCaret(2);
  const before = b.state.replaced;

  a.write('new text', 8);
  await a.flush();

  assert.equal(b.active()?.text, 'new text');
  assert.equal(b.active()?.caret, 2);
  assert.equal(b.state.replaced, before + 1, 'the editor is told to reload');
});

test('a stale copy from another tab does not overwrite newer text here', async () => {
  const tab = channel();
  const a = createStore(disk([draft({})]).store, noPrefs, 'system', tab());
  const b = createStore(disk([draft({})]).store, noPrefs, 'system', tab());
  await a.load(() => '');
  await b.load(() => '');

  a.write('from a', 6);
  b.write('from b, later', 13);
  b.active()!.updatedAt = a.active()!.updatedAt + 1;
  await a.flush();

  assert.equal(b.active()?.text, 'from b, later');
});

test('a draft deleted or created in another tab follows here', async () => {
  const tab = channel();
  const stored = () => [
    draft({ id: 'one', text: 'one', updatedAt: 2 }),
    draft({ id: 'two', text: 'two', updatedAt: 1 }),
  ];
  const a = createStore(disk(stored()).store, noPrefs, 'system', tab());
  const b = createStore(disk(stored()).store, noPrefs, 'system', tab());
  await a.load(() => '');
  await b.load(() => '');

  await a.remove();
  assert.deepEqual(
    b.state.drafts.map((d) => d.id),
    ['two'],
  );
  assert.equal(b.state.activeId, 'two');

  a.create('three');
  await a.flush();
  assert.ok(b.state.drafts.some((d) => d.text === 'three'));
});

test('what another tab says before this one has loaded is applied after', async () => {
  const tab = channel();
  const a = createStore(disk([draft({ text: 'old' })]).store, noPrefs, 'system', tab());
  await a.load(() => '');
  const { disk: slow, release } = slowDisk([draft({ text: 'old' })]);
  const b = createStore(slow, noPrefs, 'system', tab());
  const loading = b.load(() => '');

  a.write('new', 3);
  await a.flush();
  release();
  await loading;

  assert.equal(b.active()?.text, 'new');
});

test('restoring adds what is new, updates what is newer, and skips the rest', async () => {
  const { store: d, written } = disk([
    draft({ id: 'a', text: 'alpha', updatedAt: 10 }),
    draft({ id: 'b', text: 'beta', updatedAt: 10 }),
  ]);
  const store = createStore(d, noPrefs, 'system');
  await store.load(() => '');

  const outcome = store.importDrafts([
    draft({ id: 'a', text: 'alpha, older', updatedAt: 5 }),
    draft({ id: 'b', text: 'beta, newer', updatedAt: 20 }),
    draft({ id: 'c', text: 'gamma', updatedAt: 1 }),
    draft({ id: 'd', text: 'alpha', updatedAt: 1 }),
  ]);

  assert.deepEqual(outcome, { added: 1, updated: 1, same: 2 });
  assert.equal(store.state.drafts.find((x) => x.id === 'a')?.text, 'alpha');
  assert.equal(store.state.drafts.find((x) => x.id === 'b')?.text, 'beta, newer');
  assert.ok(!store.state.drafts.some((x) => x.id === 'd'), 'same text, not again');
  await store.flush();
  assert.deepEqual(written.map((x) => x.id).sort(), ['b', 'c']);
});

test('the find bar closes on the way into the reading view', async () => {
  const store = createStore(disk([draft({})]).store, noPrefs, 'system');
  await store.load(() => '');
  store.setFind(true);
  store.setMode('split');
  assert.equal(store.state.findOpen, true);
  store.setMode('read');
  assert.equal(store.state.findOpen, false);
});

test('a restore is previewed first, then applied, and keeps the blank draft', async () => {
  // Newest first, as the disk answers: the blank draft is the open one, the
  // way a fresh install opens.
  const { store: d, written } = disk([
    draft({ id: 'blank', text: '', updatedAt: 20 }),
    draft({ id: 'a', text: 'alpha', updatedAt: 10 }),
  ]);
  const removed: string[] = [];
  d.remove = async (id) => void removed.push(id);
  const store = createStore(d, noPrefs, 'system');
  await store.load(() => '');
  const backup = [
    draft({ id: 'a', text: 'alpha, newer', updatedAt: 30 }),
    draft({ id: 'b', text: 'beta', createdAt: 5, updatedAt: 6 }),
    draft({ id: 'c', text: 'alpha, newer' }),
  ];

  // The backup holds the same text twice: the preview counts it once, as the
  // restore will.
  assert.deepEqual(store.previewImport(backup), { added: 1, updated: 1, same: 1 });
  assert.equal(store.state.drafts.length, 2, 'a preview changes nothing');

  assert.deepEqual(store.importDrafts(backup), { added: 1, updated: 1, same: 1 });
  assert.deepEqual(
    store.state.drafts.map((x) => [x.id, x.updatedAt]),
    [
      ['a', 30],
      ['blank', 20],
      ['b', 6],
    ],
    'dates come back as they were, and the blank draft stays',
  );
  assert.deepEqual(removed, []);
  assert.equal(store.state.activeId, 'blank');
  await store.flush();
  assert.deepEqual(written.map((x) => x.id).sort(), ['a', 'b']);
});

test('a dropped file comes in dated by the file, never in the future', async () => {
  const store = createStore(disk([draft({})]).store, noPrefs, 'system');
  await store.load(() => '');
  store.create('from last week', 1000);
  assert.equal(store.active()?.updatedAt, 1000);
  store.create('from the future', Date.now() + 1e9);
  assert.ok(store.active()!.updatedAt <= Date.now());
});

test('settings and search take turns over the editor', async () => {
  const store = createStore(disk([draft({})]).store, noPrefs, 'system');
  await store.load(() => '');
  store.setSettings(true);
  store.setSearch(true);
  assert.equal(store.state.settingsOpen, false);
  store.setSettings(true);
  assert.equal(store.state.searchOpen, false);
});

test('a new draft is made each time, blank page or not', async () => {
  const store = createStore(disk([draft({})]).store, noPrefs, 'system');
  await store.load(() => '');
  store.create();
  store.create();
  store.create();
  assert.equal(store.state.drafts.length, 4, 'three blank pages');
  assert.equal(store.state.activeId, store.state.drafts[0]!.id);
});

test('leaving an empty draft keeps it', async () => {
  const removed: string[] = [];
  const { store: d } = disk([draft({})]);
  d.remove = async (id) => void removed.push(id);
  const store = createStore(d, noPrefs, 'system');
  await store.load(() => '');
  store.create();
  const blank = store.state.activeId!;
  store.open('stored');
  assert.deepEqual(store.state.drafts.map((x) => x.id).sort(), [blank, 'stored'].sort());
  await Promise.resolve();
  assert.deepEqual(removed, []);

  // A file dropped while a blank draft is open leaves that one where it is.
  store.open(blank);
  store.create('# from a file');
  assert.equal(store.state.drafts.length, 3);
});

test('the draft being written moves to the top of the rail', async () => {
  const store = createStore(
    disk([draft({ id: 'new', updatedAt: 20 }), draft({ id: 'old', updatedAt: 10 })])
      .store,
    noPrefs,
    'system',
  );
  await store.load(() => '');
  store.open('old');
  store.write('edited just now', 15);
  assert.deepEqual(
    store.state.drafts.map((x) => x.id),
    ['old', 'new'],
  );
});

test('empty drafts on the disk are all still there after a reload', async () => {
  const removed: string[] = [];
  const { store: d } = disk([
    draft({ id: 'blank-open', text: '', updatedAt: 30 }),
    draft({ id: 'blank-old', text: '  \n', updatedAt: 20 }),
    draft({ id: 'kept', text: 'words', updatedAt: 10 }),
  ]);
  d.remove = async (id) => void removed.push(id);
  const store = createStore(d, noPrefs, 'system');
  await store.load(() => '');
  assert.deepEqual(
    store.state.drafts.map((x) => x.id),
    ['blank-open', 'blank-old', 'kept'],
  );
  assert.deepEqual(removed, []);
});

test('when another tab deletes the last draft, its blank replaces the one here', async () => {
  const tab = channel();
  const stored = () => [draft({ id: 'only', text: 'only', updatedAt: 1 })];
  const a = createStore(disk(stored()).store, noPrefs, 'system', tab());
  const b = createStore(disk(stored()).store, noPrefs, 'system', tab());
  await a.load(() => '');
  await b.load(() => '');

  await a.remove();
  await a.flush();

  assert.deepEqual(
    b.state.drafts.map((d) => d.id),
    [a.state.activeId],
  );
  assert.equal(b.state.activeId, a.state.activeId);
});

test('a blank draft can be asked for on a blank page', async () => {
  const store = createStore(disk([]).store, noPrefs, 'system');
  await store.load(() => '');
  store.create();
  store.create('text');
  assert.deepEqual(
    store.state.drafts.map((d) => d.text),
    ['text', '', ''],
  );
});

test('an edit is newer than its draft even when the draft is dated ahead', async () => {
  const ahead = Date.now() + 86400000;
  const store = createStore(disk([draft({ updatedAt: ahead })]).store, noPrefs, 'system');
  await store.load(() => '');
  store.write('edited', 6);
  assert.ok(store.active()!.updatedAt > ahead);
});
